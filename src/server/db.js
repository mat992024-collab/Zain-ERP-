const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { SCHEMA, DEFAULT_SETTINGS, SYSTEM_ACCOUNTS } = require('./schema');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.ZAIN_DB || path.join(DATA_DIR, 'zain.db');
const IMAGES_DIR = path.join(path.dirname(DB_PATH), 'images');

let db = null;

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), useSalt, 64).toString('hex');
  return { hash, salt: useSalt };
}

function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function init() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec(SCHEMA);
  migrate();
  bootstrap();
  return db;
}

function migrate() {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const ensure = (table, col, ddl) => {
    if (!cols(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  ensure('invoices', 'installment_plan', 'installment_plan TEXT');
  ensure('invoices', 'tax_inclusive', 'tax_inclusive INTEGER NOT NULL DEFAULT 0');
  ensure('settings', 'category', "category TEXT NOT NULL DEFAULT 'general'");
  ensure('products', 'units', "units TEXT NOT NULL DEFAULT '[]'");
  ensure('products', 'package_size', 'package_size TEXT');
  ensure('products', 'profit_margin_pct', 'profit_margin_pct REAL NOT NULL DEFAULT 0');
  ensure('products', 'wholesale_min_qty', 'wholesale_min_qty REAL NOT NULL DEFAULT 1');
  ensure('products', 'shelf_location', 'shelf_location TEXT');
  ensure('users', 'permissions', "permissions TEXT NOT NULL DEFAULT '[]'");
  ensure('invoices', 'currency', 'currency TEXT');
  ensure('invoices', 'exchange_rate', 'exchange_rate REAL NOT NULL DEFAULT 1');
  ensure('invoices', 'total_original', 'total_original REAL');
  ensure('invoices', 'paid_original', 'paid_original REAL');
  ensure('expenses', 'currency', 'currency TEXT');
  ensure('expenses', 'exchange_rate', 'exchange_rate REAL NOT NULL DEFAULT 1');
  ensure('expenses', 'amount_original', 'amount_original REAL');
  ensure('vouchers', 'currency', 'currency TEXT');
  ensure('vouchers', 'exchange_rate', 'exchange_rate REAL NOT NULL DEFAULT 1');
  ensure('vouchers', 'amount_original', 'amount_original REAL');
  ensure('invoices', 'payments', 'payments TEXT');
  ensure('shifts', 'total_wallet', 'total_wallet REAL NOT NULL DEFAULT 0');
  ensure('shifts', 'total_vodafone_cash', 'total_vodafone_cash REAL NOT NULL DEFAULT 0');
  ensure('users', 'branch', "branch TEXT DEFAULT 'الفرع الرئيسي'");
  ensure('invoices', 'branch', "branch TEXT DEFAULT 'الفرع الرئيسي'");
  ensure('invoices', 'order_type', "order_type TEXT DEFAULT 'direct'");
  ensure('invoices', 'delivery_status', "delivery_status TEXT DEFAULT 'completed'");
  ensure('invoices', 'delivery_notes', 'delivery_notes TEXT');
  ensure('invoice_items', 'dimensions', 'dimensions TEXT');
  ensure('products', 'is_meter_unit', 'is_meter_unit INTEGER NOT NULL DEFAULT 0');
  ensure('products', 'meter_length', 'meter_length REAL DEFAULT 0');
  ensure('products', 'meter_width', 'meter_width REAL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      branch TEXT NOT NULL DEFAULT 'الفرع الرئيسي',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
  `);
}

function bootstrap() {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value, category) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING'
  );
  for (const [key, value, category] of DEFAULT_SETTINGS) upsert.run(key, value, category);

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const { hash, salt } = hashPassword('admin');
    db.prepare(
      `INSERT INTO users (username, full_name, password_hash, password_salt, role, permissions)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('admin', 'مدير النظام', hash, salt, 'admin', JSON.stringify(['*']));
  }

  const insert = db.prepare(
    'INSERT INTO accounts (code, name, type, parent_id, is_system) VALUES (?, ?, ?, ?, ?)'
  );
  const existingCodes = new Set(db.prepare('SELECT code FROM accounts').all().map((r) => r.code));
  const byCode = {};
  for (const row of db.prepare('SELECT id, code FROM accounts').all()) byCode[row.code] = row.id;
  for (const [code, name, type, parentCode, isSystem] of SYSTEM_ACCOUNTS) {
    if (existingCodes.has(code)) continue;
    const parentId = parentCode ? byCode[parentCode] || null : null;
    const res = insert.run(code, name, type, parentId, isSystem);
    byCode[code] = Number(res.lastInsertRowid);
  }

  const baseCode = getSetting('base_currency', 'IQD');
  const baseSymbol = getSetting('currency_symbol', 'د.ع');
  const baseExists = db.prepare('SELECT code FROM currencies WHERE code = ?').get(baseCode);
  if (!baseExists) {
    db.prepare(
      'INSERT INTO currencies (code, name, symbol, rate, decimals, is_active, is_base) VALUES (?, ?, ?, 1, 0, 1, 1)'
    ).run(baseCode, 'العملة الأساسية', baseSymbol);
  } else {
    db.prepare('UPDATE currencies SET is_base = 1, is_active = 1 WHERE code = ?').run(baseCode);
  }
}

const conn = () => db || init();

function all(sql, params = []) {
  return conn().prepare(sql).all(...params);
}

function get(sql, params = []) {
  return conn().prepare(sql).get(...params);
}

function run(sql, params = []) {
  return conn().prepare(sql).run(...params);
}

function tx(fn) {
  const c = conn();
  c.exec('BEGIN');
  try {
    const result = fn();
    c.exec('COMMIT');
    return result;
  } catch (err) {
    c.exec('ROLLBACK');
    throw err;
  }
}

function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

function setSetting(key, value, category = 'general') {
  run(
    `INSERT INTO settings (key, value, category, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category,
     updated_at = datetime('now','localtime')`,
    [key, value == null ? null : String(value), category]
  );
}

function getSettings() {
  const rows = all('SELECT key, value, category FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function logActivity(userId, action, entity, entityId, details) {
  run(
    'INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId || null, action, entity || null, entityId || null, details ? JSON.stringify(details) : null]
  );
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  init,
  close,
  conn,
  all,
  get,
  run,
  tx,
  getSetting,
  setSetting,
  getSettings,
  hashPassword,
  verifyPassword,
  logActivity,
  DB_PATH,
  DATA_DIR,
  IMAGES_DIR,
};
