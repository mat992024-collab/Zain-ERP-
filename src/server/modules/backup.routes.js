const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const { requirePerm } = require('../core/csv');
const { createZip, readZip, isZip } = require('../core/zip');

const BACKUP_DIR = path.join(db.DATA_DIR, 'backups', path.basename(db.DB_PATH).replace(/\.db$/, ''));
const MAGIC = 'SQLite format 3';
const AUTO_PREFIX = 'zain-auto-';

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function autoState() {
  const enabled = db.getSetting('auto_backup', '0') === '1';
  const time = db.getSetting('auto_backup_time', '02:00');
  const keep = Math.max(1, Math.min(Number(db.getSetting('auto_backup_keep', '7')) || 7, 90));
  const last = db.getSetting('auto_backup_last', '');
  const now = new Date();
  const [hh, mm] = String(time).split(':').map((n) => Number(n) || 0);
  const nextRun = new Date(now);
  nextRun.setHours(hh || 0, mm || 0, 0, 0);
  if (nextRun.getTime() <= now.getTime()) nextRun.setDate(nextRun.getDate() + 1);
  return {
    enabled,
    time,
    keep,
    last,
    today: localDate(now),
    next: nextRun.toISOString(),
    auto_count: listBackups().filter((b) => b.name.startsWith(AUTO_PREFIX)).length,
  };
}

function pruneAuto(keep) {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(AUTO_PREFIX) && (f.endsWith('.zip') || f.endsWith('.db'))).sort();
  const extra = files.length - keep;
  for (let i = 0; i < extra; i++) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, files[i])); } catch { }
  }
}

function imageEntries() {
  if (!fs.existsSync(db.IMAGES_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(db.IMAGES_DIR)) {
    const p = path.join(db.IMAGES_DIR, f);
    if (!fs.statSync(p).isFile()) continue;
    out.push({ name: `images/${f}`, data: fs.readFileSync(p) });
  }
  return out;
}

function externalState() {
  const enabled = db.getSetting('backup_external_enabled', '0') === '1';
  const dir = String(db.getSetting('backup_external_dir', '') || '').trim();
  const keep = Math.max(1, Math.min(Number(db.getSetting('backup_external_keep', '5')) || 5, 90));
  let exists = false;
  let writable = false;
  let count = 0;
  if (dir) {
    exists = fs.existsSync(dir);
    if (exists) {
      try {
        fs.accessSync(dir, fs.constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
      try {
        count = fs.readdirSync(dir).filter((f) => /^zain-(backup|auto)-[0-9A-Za-z-]+\.zip$/.test(f)).length;
      } catch {
        count = 0;
      }
    }
  }
  return {
    enabled,
    dir,
    keep,
    exists,
    writable,
    count,
    last: db.getSetting('backup_external_last', ''),
    error: db.getSetting('backup_external_error', ''),
  };
}

function pruneExternal(dir, keep) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^zain-(backup|auto)-[0-9A-Za-z-]+\.zip$/.test(f)).sort();
  } catch {
    return 0;
  }
  const extra = files.length - keep;
  for (let i = 0; i < extra; i++) {
    try { fs.unlinkSync(path.join(dir, files[i])); } catch { }
  }
  return Math.max(0, files.length - extra);
}

function copyExternal(file) {
  const state = externalState();
  if (!state.enabled || !state.dir) return { copied: false, reason: 'disabled' };
  try {
    fs.mkdirSync(state.dir, { recursive: true });
    const target = path.join(state.dir, path.basename(file));
    fs.copyFileSync(file, target);
    pruneExternal(state.dir, state.keep);
    db.setSetting('backup_external_last', new Date().toISOString(), 'backup');
    db.setSetting('backup_external_error', '', 'backup');
    return { copied: true, path: target };
  } catch (err) {
    db.setSetting('backup_external_error', String(err.message || err), 'backup');
    return { copied: false, reason: String(err.message || err) };
  }
}

function buildSnapshot(prefix) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tag = stamp();
  const tmp = path.join(BACKUP_DIR, `tmp-${tag}.db`);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  db.conn().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  let dbBuffer;
  try {
    dbBuffer = fs.readFileSync(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch { }
  }
  const zip = createZip([{ name: 'zain.db', data: dbBuffer }, ...imageEntries()]);
  const name = `${prefix}${tag}.zip`;
  const file = path.join(BACKUP_DIR, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.writeFileSync(file, zip);
  const stat = fs.statSync(file);
  const external = copyExternal(file);
  return { name, size: stat.size, created_at: stat.mtime.toISOString(), external };
}

function createAutoSnapshot() {
  const keep = autoState().keep;
  const info = buildSnapshot(AUTO_PREFIX);
  db.setSetting('auto_backup_last', localDate(), 'backup');
  pruneAuto(keep);
  db.logActivity(null, 'backup_auto', 'system', null, { name: info.name, size: info.size });
  return info;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.zip') || f.endsWith('.db'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function safeName(name) {
  const clean = path.basename(String(name || ''));
  if (!/^zain-(backup|auto)-[0-9A-Za-z-]+\.(zip|db)$/.test(clean)) throw new HttpError(400, 'اسم النسخة الاحتياطية غير صالح');
  return clean;
}

function createSnapshot() {
  return buildSnapshot('zain-backup-');
}

function validateFile(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('latin1', 0, 15) !== MAGIC) throw new HttpError(400, 'الملف ليس قاعدة بيانات SQLite صالحة');
  let probe;
  try {
    probe = new DatabaseSync(file, { readOnly: true });
    const result = probe.prepare('PRAGMA integrity_check').get();
    const value = Object.values(result || {})[0];
    if (String(value).toLowerCase() !== 'ok') throw new HttpError(400, 'النسخة الاحتياطية تالفة');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'تعذر قراءة النسخة الاحتياطية');
  } finally {
    if (probe) probe.close();
  }
}

function applyRestore(sourceFile) {
  const buffer = fs.readFileSync(sourceFile);
  let dbBuffer = buffer;
  let hasImages = false;
  let imageFiles = [];
  if (isZip(buffer)) {
    let entries;
    try {
      entries = readZip(buffer);
    } catch {
      throw new HttpError(400, 'ملف النسخة الاحتياطية تالف');
    }
    const dbEntry = entries.find((e) => !e.name.includes('/') && e.name.toLowerCase().endsWith('.db'));
    if (!dbEntry) throw new HttpError(400, 'الملف لا يحتوي على قاعدة بيانات');
    dbBuffer = dbEntry.data;
    hasImages = entries.some((e) => e.name === 'images/' || e.name.startsWith('images/'));
    imageFiles = entries.filter((e) => e.name.startsWith('images/') && !e.name.endsWith('/'));
  }
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  const tmp = path.join(db.DATA_DIR, `restore-${Date.now()}.db`);
  fs.writeFileSync(tmp, dbBuffer);
  try {
    validateFile(tmp);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { }
    throw err;
  }
  const target = db.DB_PATH;
  db.close();
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(target + suffix); } catch { }
  }
  fs.copyFileSync(tmp, target);
  try { fs.unlinkSync(tmp); } catch { }
  db.init();
  if (hasImages) {
    fs.mkdirSync(db.IMAGES_DIR, { recursive: true });
    for (const f of fs.readdirSync(db.IMAGES_DIR)) {
      try { fs.unlinkSync(path.join(db.IMAGES_DIR, f)); } catch { }
    }
    for (const entry of imageFiles) {
      const file = path.basename(entry.name);
      if (!file) continue;
      fs.writeFileSync(path.join(db.IMAGES_DIR, file), entry.data);
    }
  }
}

module.exports = {
  autoState,
  createAutoSnapshot,
  localDate,
  register(router) {
    router.get('/api/backup', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      sendJson(ctx.res, 200, {
        backups: listBackups(),
        db_path: db.DB_PATH,
        db_size: fs.existsSync(db.DB_PATH) ? fs.statSync(db.DB_PATH).size : 0,
        auto: autoState(),
        external: externalState(),
      });
    });

    router.put('/api/backup/external', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const body = ctx.body || {};
      if (body.enabled !== undefined) db.setSetting('backup_external_enabled', body.enabled ? '1' : '0', 'backup');
      if (body.dir !== undefined) {
        const dir = String(body.dir || '').trim();
        if (dir) {
          try {
            fs.mkdirSync(dir, { recursive: true });
            fs.accessSync(dir, fs.constants.W_OK);
          } catch (err) {
            throw new HttpError(400, 'تعذر استخدام المسار: ' + String(err.message || err));
          }
        }
        db.setSetting('backup_external_dir', dir, 'backup');
      }
      if (body.keep !== undefined) {
        const keep = Number(body.keep);
        if (!Number.isInteger(keep) || keep < 1 || keep > 90) throw new HttpError(400, 'عدد النسخ المحفوظة يجب أن يكون بين 1 و 90');
        db.setSetting('backup_external_keep', keep, 'backup');
      }
      db.logActivity(ctx.user.id, 'update', 'backup_external', null, { enabled: body.enabled, dir: body.dir, keep: body.keep });
      sendJson(ctx.res, 200, { ok: true, external: externalState(), backups: listBackups() });
    });

    router.post('/api/backup/external/run', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const state = externalState();
      if (!state.enabled) throw new HttpError(400, 'النسخ إلى المسار الخارجي غير مفعّل');
      if (!state.dir) throw new HttpError(400, 'لم يتم تحديد مسار خارجي');
      const backups = listBackups();
      if (!backups.length) throw new HttpError(400, 'لا توجد نسخة احتياطية لنقلها');
      const file = path.join(BACKUP_DIR, backups[0].name);
      const result = copyExternal(file);
      if (!result.copied) throw new HttpError(400, 'تعذر النسخ: ' + result.reason);
      db.logActivity(ctx.user.id, 'backup_external', 'system', null, { name: backups[0].name, path: result.path });
      sendJson(ctx.res, 201, { ok: true, external: externalState(), backup: backups[0] });
    });

    router.put('/api/backup/auto', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const body = ctx.body || {};
      if (body.enabled !== undefined) db.setSetting('auto_backup', body.enabled ? '1' : '0', 'backup');
      if (body.time !== undefined) {
        const time = String(body.time || '').trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'وقت النسخ التلقائي يجب أن يكون HH:MM');
        db.setSetting('auto_backup_time', time, 'backup');
      }
      if (body.keep !== undefined) {
        const keep = Number(body.keep);
        if (!Number.isInteger(keep) || keep < 1 || keep > 90) throw new HttpError(400, 'عدد النسخ المحفوظة يجب أن يكون بين 1 و 90');
        db.setSetting('auto_backup_keep', keep, 'backup');
      }
      db.logActivity(ctx.user.id, 'update', 'backup_auto', null, { enabled: body.enabled, time: body.time, keep: body.keep });
      sendJson(ctx.res, 200, { ok: true, auto: autoState(), backups: listBackups() });
    });

    router.post('/api/backup/auto/run', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const info = createAutoSnapshot();
      sendJson(ctx.res, 201, { ok: true, backup: info, auto: autoState(), backups: listBackups() });
    });

    router.post('/api/backup', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const info = createSnapshot();
      db.logActivity(ctx.user.id, 'backup', 'system', null, { name: info.name, size: info.size });
      sendJson(ctx.res, 201, { ok: true, backup: info, backups: listBackups() });
    });

    router.get('/api/backup/:name/download', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const name = safeName(ctx.params.name);
      const file = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(file)) throw new HttpError(404, 'النسخة الاحتياطية غير موجودة');
      const stat = fs.statSync(file);
      ctx.res.writeHead(200, {
        'Content-Type': name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(ctx.res);
    });

    router.post('/api/backup/upload/restore', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const payload = ctx.body || {};
      if (!payload.data) throw new HttpError(400, 'لم يتم إرسال ملف');
      let buffer;
      try {
        buffer = Buffer.from(String(payload.data), 'base64');
      } catch {
        throw new HttpError(400, 'ملف غير صالح');
      }
      if (buffer.length < 100) throw new HttpError(400, 'الملف فارغ أو غير صالح');
      fs.mkdirSync(db.DATA_DIR, { recursive: true });
      const tmp = path.join(db.DATA_DIR, `upload-${Date.now()}${isZip(buffer) ? '.zip' : '.db'}`);
      fs.writeFileSync(tmp, buffer);
      try {
        applyRestore(tmp);
      } finally {
        try { fs.unlinkSync(tmp); } catch { }
      }
      db.logActivity(ctx.user.id, 'restore', 'system', null, { source: 'upload' });
      sendJson(ctx.res, 200, { ok: true, restored: 'uploaded-file' });
    });

    router.post('/api/backup/:name/restore', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const name = safeName(ctx.params.name);
      const file = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(file)) throw new HttpError(404, 'النسخة الاحتياطية غير موجودة');
      applyRestore(file);
      db.logActivity(ctx.user.id, 'restore', 'system', null, { name });
      sendJson(ctx.res, 200, { ok: true, restored: name });
    });

    router.delete('/api/backup/:name', (ctx) => {
      requirePerm(ctx, 'backup.manage');
      const name = safeName(ctx.params.name);
      const file = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(file)) throw new HttpError(404, 'النسخة الاحتياطية غير موجودة');
      fs.unlinkSync(file);
      sendJson(ctx.res, 200, { ok: true, backups: listBackups() });
    });
  },
};
