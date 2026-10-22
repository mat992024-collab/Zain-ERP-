const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.ZAIN_DB || path.join(DATA_DIR, 'zain.db');
const IMAGES_DIR = path.join(path.dirname(DB_PATH), 'images');
const BACKUPS_DIR = path.join(path.dirname(DB_PATH), 'backups');
const PORT = Number(process.env.ZAIN_PORT) || 4180;

const results = [];
function report(level, label, detail = '') {
  results.push({ level, label, detail });
  const tag = level === 'ok' ? 'OK  ' : level === 'warn' ? 'WARN' : 'FAIL';
  console.log(`${tag}  ${label}${detail ? '  — ' + detail : ''}`);
}

function bytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

(async () => {
  console.log('Zain ERP — فحص النظام\n');

  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  if (major > 22 || (major === 22 && minor >= 5)) report('ok', 'إصدار Node.js', process.versions.node);
  else report('fail', 'إصدار Node.js', `${process.versions.node} — يتطلب 22.5 أو أحدث لـ node:sqlite`);

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, `.doctor-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    report('ok', 'مجلد البيانات قابل للكتابة', DATA_DIR);
  } catch (err) {
    report('fail', 'مجلد البيانات غير قابل للكتابة', `${DATA_DIR} — ${err.message}`);
  }

  if (!fs.existsSync(DB_PATH)) {
    report('warn', 'قاعدة البيانات', 'غير موجودة بعد — ستُنشأ عند أول تشغيل');
  } else {
    let conn = null;
    try {
      conn = new DatabaseSync(DB_PATH, { readOnly: true });
    } catch {
      try { conn = new DatabaseSync(DB_PATH); } catch (err) {
        report('fail', 'فتح قاعدة البيانات', err.message);
        conn = null;
      }
    }
    if (conn) {
      try {
        const size = fs.statSync(DB_PATH).size;
        report('ok', 'ملف قاعدة البيانات', `${DB_PATH} (${bytes(size)})`);
        const integrity = conn.prepare('PRAGMA integrity_check').get();
        const value = integrity ? Object.values(integrity)[0] : 'unknown';
        report(value === 'ok' ? 'ok' : 'fail', 'سلامة قاعدة البيانات (integrity_check)', String(value));
        const mode = conn.prepare('PRAGMA journal_mode').get();
        report('ok', 'وضع السجل', String(mode ? Object.values(mode)[0] : 'unknown'));
        const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
        const required = ['users', 'settings', 'products', 'invoices', 'invoice_items', 'customers', 'suppliers', 'treasury', 'accounts', 'installments', 'scheduled_invoices'];
        const missing = required.filter((t) => !tables.includes(t));
        report(missing.length ? 'warn' : 'ok', 'جداول قاعدة البيانات', missing.length ? `ناقصة: ${missing.join(', ')} (تُنشأ عند التشغيل)` : `${tables.length} جدولاً`);
        const counts = {};
        for (const t of ['products', 'customers', 'suppliers', 'invoices', 'users']) {
          if (!tables.includes(t)) continue;
          counts[t] = conn.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
        }
        report('ok', 'سجلات النظام', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' · '));
        if (tables.includes('settings')) {
          const rows = conn.prepare("SELECT key, value FROM settings WHERE key IN ('company_name','currency','language','printer_type','backup_auto_enabled','backup_external_enabled')").all();
          const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
          report('ok', 'الإعدادات الأساسية', `company=${map.company_name || '-'} · currency=${map.currency || '-'} · printer=${map.printer_type || '-'}`);
          if (map.backup_auto_enabled === '1') report('ok', 'النسخ التلقائي اليومي', 'مفعّل');
          else report('warn', 'النسخ التلقائي اليومي', 'غير مفعّل — يُنصح بتفعيله من الإدارة');
          if (map.backup_external_enabled === '1') report('ok', 'النسخ الخارجي', 'مفعّل');
          else report('warn', 'النسخ الخارجي', 'غير مفعّل — يُنصح بنسخ احتياطي على قرص/فلاش');
        }
        if (tables.includes('installments')) {
          const late = conn.prepare(
            `SELECT COUNT(*) AS c FROM installments
             WHERE status IN ('active','overdue') AND remaining > 0.001 AND due_date IS NOT NULL AND date(due_date) < date('now','localtime')`
          ).get().c;
          report(late ? 'warn' : 'ok', 'أقساط متأخرة', late ? `${late} قسط — راجع شاشة الأقساط` : 'لا يوجد');
        }
        if (tables.includes('scheduled_invoices')) {
          const due = conn.prepare(
            `SELECT COUNT(*) AS c FROM scheduled_invoices WHERE active = 1 AND datetime(next_run) <= datetime('now','localtime')`
          ).get().c;
          report(due ? 'warn' : 'ok', 'فواتير مجدولة مستحقة', due ? `${due} جدولة بانتظار التشغيل` : 'لا يوجد');
        }
        if (tables.includes('products')) {
          const low = conn.prepare(
            `SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND reorder_level > 0 AND quantity <= reorder_level`
          ).get().c;
          report(low ? 'warn' : 'ok', 'أصناف تحت حد الطلب', low ? `${low} صنف` : 'لا يوجد');
        }
      } catch (err) {
        report('fail', 'قراءة قاعدة البيانات', err.message);
      } finally {
        try { conn.close(); } catch {}
      }
    }
  }

  try {
    if (fs.existsSync(IMAGES_DIR)) {
      const files = fs.readdirSync(IMAGES_DIR);
      const total = files.reduce((s, f) => {
        try { return s + fs.statSync(path.join(IMAGES_DIR, f)).size; } catch { return s; }
      }, 0);
      report('ok', 'صور الأصناف', `${files.length} ملفاً (${bytes(total)})`);
    } else {
      report('ok', 'صور الأصناف', 'لا توجد صور بعد');
    }
  } catch (err) {
    report('warn', 'صور الأصناف', err.message);
  }

  try {
    if (fs.existsSync(BACKUPS_DIR)) {
      const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.zip')).sort();
      if (files.length) {
        const last = files[files.length - 1];
        const age = Math.round((Date.now() - fs.statSync(path.join(BACKUPS_DIR, last)).mtimeMs) / 86400000);
        report(age > 7 ? 'warn' : 'ok', 'النسخ الاحتياطي المحلي', `${files.length} نسخة · آخرها ${last} (منذ ${age} يوم)`);
      } else {
        report('warn', 'النسخ الاحتياطي المحلي', 'لا توجد نسخ — أنشئ نسخة من الإدارة');
      }
    } else {
      report('warn', 'النسخ الاحتياطي المحلي', 'المجلد غير موجود — لم تُنشأ نسخة بعد');
    }
  } catch (err) {
    report('warn', 'النسخ الاحتياطي المحلي', err.message);
  }

  try {
    const s = DB_PATH && fs.existsSync(DB_PATH)
      ? (() => {
        const c = new DatabaseSync(DB_PATH, { readOnly: true });
        try {
          const rows = c.prepare("SELECT key, value FROM settings WHERE key IN ('backup_external_enabled','backup_external_dir','backup_external_keep','backup_external_last','backup_external_error')").all();
          return Object.fromEntries(rows.map((r) => [r.key, r.value]));
        } finally { c.close(); }
      })()
      : {};
    if (s.backup_external_enabled !== '1') {
      report('warn', 'وجهة النسخ الخارجي', 'غير مفعّلة');
    } else if (!s.backup_external_dir) {
      report('warn', 'وجهة النسخ الخارجي', 'مفعّلة بدون مسار');
    } else if (!fs.existsSync(s.backup_external_dir)) {
      report('fail', 'وجهة النسخ الخارجي', `المسار غير موجود: ${s.backup_external_dir}`);
    } else {
      fs.accessSync(s.backup_external_dir, fs.constants.W_OK);
      const count = fs.readdirSync(s.backup_external_dir).filter((f) => f.endsWith('.zip')).length;
      report('ok', 'وجهة النسخ الخارجي', `${s.backup_external_dir} (${count} نسخة · احتفاظ ${s.backup_external_keep || '-'})`);
      if (s.backup_external_error) report('warn', 'آخر خطأ في النسخ الخارجي', s.backup_external_error);
    }
  } catch (err) {
    report('fail', 'وجهة النسخ الخارجي', err.message);
  }

  try {
    const stat = fs.statfsSync(DATA_DIR);
    const free = stat.bavail * stat.bsize;
    report(free < 512 * 1024 * 1024 ? 'warn' : 'ok', 'المساحة الحرة', bytes(free));
  } catch (err) {
    report('warn', 'المساحة الحرة', err.message);
  }

  const assets = [
    ['src/web/index.html', 'واجهة التطبيق'],
    ['src/web/assets/app.css', 'ملف الأنماط المبني (app.css)'],
    ['src/web/assets/vendor/cairo.css', 'خط Cairo المحلي'],
    ['src/web/assets/vendor/bootstrap-icons.min.css', 'أيقونات Bootstrap'],
    ['src/web/styles.css', 'مصدر الأنماط'],
  ];
  for (const [rel, label] of assets) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) report('ok', label, bytes(fs.statSync(full).size));
    else report('fail', label, `مفقود: ${rel} — شغّل npm run build:css`);
  }

  try {
    const free = await portFree(PORT);
    report(free ? 'ok' : 'warn', `المنفذ ${PORT}`, free ? 'متاح' : 'مستخدم حالياً — قد يكون التطبيق يعمل بالفعل');
  } catch (err) {
    report('warn', `المنفذ ${PORT}`, err.message);
  }

  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  console.log(`\nالنتيجة: ${results.length - fails - warns} سليم · ${warns} تحذير · ${fails} خطأ`);
  if (fails) console.log('راجع الأخطاء أعلاه قبل التشغيل، ثم شغّل: npm run doctor');
  process.exit(fails ? 1 : 0);
})().catch((err) => {
  console.error('FAIL  فحص النظام', err.message);
  process.exit(1);
});
