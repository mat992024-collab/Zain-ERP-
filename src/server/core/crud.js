const db = require('../db');
const { HttpError } = require('./http');

function parseJsonFields(row, fields) {
  if (!row) return row;
  const out = { ...row };
  for (const f of fields) {
    try {
      out[f] = JSON.parse(out[f] || '[]');
    } catch {
      out[f] = [];
    }
  }
  return out;
}

function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

function buildInsert(table, data) {
  const cols = Object.keys(data);
  if (!cols.length) throw new HttpError(400, 'لا توجد بيانات للحفظ');
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  return { sql, values: cols.map((c) => normalize(data[c])) };
}

function buildUpdate(table, id, data) {
  const cols = Object.keys(data);
  if (!cols.length) throw new HttpError(400, 'لا توجد بيانات للتحديث');
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return { sql, values: [...cols.map((c) => normalize(data[c])), id] };
}

function normalize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function list(table, { where = [], params = [], order = 'id DESC', limit, offset, search, searchCols = [] } = {}) {
  const clauses = [...where];
  const values = [...params];
  if (search && searchCols.length) {
    clauses.push(`(${searchCols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
    for (const _ of searchCols) values.push(`%${search}%`);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  let sql = `SELECT * FROM ${table} ${whereSql} ORDER BY ${order}`;
  if (limit) {
    sql += ' LIMIT ?';
    values.push(limit);
    if (offset) {
      sql += ' OFFSET ?';
      values.push(offset);
    }
  }
  const total = db.get(`SELECT COUNT(*) AS c FROM ${table} ${whereSql}`, values.slice(0, values.length - (limit ? (offset ? 2 : 1) : 0)));
  return { rows: db.all(sql, values), total: total ? total.c : 0 };
}

function find(table, id) {
  return db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
}

function requireRow(table, id, label) {
  const row = find(table, id);
  if (!row) throw new HttpError(404, `${label || 'السجل'} غير موجود`);
  return row;
}

function remove(table, id) {
  requireRow(table, id);
  return db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

module.exports = {
  parseJsonFields,
  toBool,
  pick,
  buildInsert,
  buildUpdate,
  normalize,
  list,
  find,
  requireRow,
  remove,
};
