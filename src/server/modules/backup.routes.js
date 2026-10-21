const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const { requirePerm } = require('../core/csv');

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
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(AUTO_PREFIX) && f.endsWith('.db')).sort();
  const extra = files.length - keep;
  for (let i = 0; i < extra; i++) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, files[i])); } catch { }
  }
}

function createAutoSnapshot() {
  const keep = autoState().keep;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `${AUTO_PREFIX}${stamp()}.db`;
  const file = path.join(BACKUP_DIR, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.conn().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const stat = fs.statSync(file);
  db.setSetting('auto_backup_last', localDate(), 'backup');
  pruneAuto(keep);
  db.logActivity(null, 'backup_auto', 'system', null, { name, size: stat.size });
  return { name, size: stat.size, created_at: stat.mtime.toISOString() };
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function safeName(name) {
  const clean = path.basename(String(name || ''));
  if (!/^zain-(backup|auto)-[0-9A-Za-z-]+\.db$/.test(clean)) throw new HttpError(400, 'اسم النسخة الاحتياطية غير صالح');
  return clean;
}

function createSnapshot() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `zain-backup-${stamp()}.db`;
  const file = path.join(BACKUP_DIR, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.conn().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const stat = fs.statSync(file);
  return { name, size: stat.size, created_at: stat.mtime.toISOString() };
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
  validateFile(sourceFile);
  const target = db.DB_PATH;
  db.close();
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(target + suffix); } catch { }
  }
  fs.copyFileSync(sourceFile, target);
  db.init();
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
      });
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
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(ctx.res);
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
      const tmp = path.join(db.DATA_DIR, `upload-${Date.now()}.db`);
      fs.writeFileSync(tmp, buffer);
      try {
        applyRestore(tmp);
      } finally {
        try { fs.unlinkSync(tmp); } catch { }
      }
      db.logActivity(ctx.user.id, 'restore', 'system', null, { source: 'upload' });
      sendJson(ctx.res, 200, { ok: true, restored: 'uploaded-file' });
    });
  },
};
