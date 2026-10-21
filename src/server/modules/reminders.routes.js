const db = require('../db');
const { sendJson, sendText, HttpError } = require('../core/http');
const { requirePerm } = require('../core/csv');

const KINDS = ['expiry', 'low_stock', 'debts', 'sales', 'custom'];
const REPEATS = ['daily', 'weekly', 'monthly', 'once'];

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function money(v) {
  return (Number(v) || 0).toLocaleString('ar-IQ');
}

function expiringItems(days) {
  return db.all(
    `SELECT id, name, quantity, unit, expiry_date FROM products
     WHERE is_active = 1 AND track_expiry = 1 AND expiry_date IS NOT NULL AND expiry_date <> ''
       AND date(expiry_date) <= date('now','localtime','+' || ? || ' days')
     ORDER BY expiry_date ASC`,
    [days]
  );
}

function lowStockItems() {
  return db.all(
    `SELECT id, name, sku, quantity, reorder_level, unit FROM products
     WHERE is_active = 1 AND quantity <= reorder_level AND quantity > 0
     ORDER BY (quantity - reorder_level) ASC, name LIMIT 60`
  );
}

function debts() {
  return db.all(
    `SELECT c.id, c.name, c.phone, c.balance,
            (SELECT COALESCE(SUM(ip.remaining), 0) FROM installments ip WHERE ip.customer_id = c.id AND ip.status = 'active') AS installments
     FROM customers c
     WHERE c.is_active = 1 AND (
        c.balance > 0
        OR (SELECT COALESCE(SUM(ip.remaining), 0) FROM installments ip WHERE ip.customer_id = c.id AND ip.status = 'active') > 0
     )
     ORDER BY c.balance DESC, installments DESC LIMIT 60`
  );
}

function salesSummary() {
  const row = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid
     FROM invoices WHERE type = 'sale' AND date(created_at) = date('now','localtime','-1 day')`
  );
  const profit = db.get(
    `SELECT COALESCE(SUM(it.total - it.cost_price * it.qty),0) AS profit
     FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
     WHERE i.type = 'sale' AND date(i.created_at) = date('now','localtime','-1 day')`
  );
  return {
    count: Number(row.count) || 0,
    total: Number(row.total) || 0,
    paid: Number(row.paid) || 0,
    profit: Number(profit.profit) || 0,
  };
}

function buildDigest() {
  const s = db.getSettings();
  const expiryDays = Number(s.reminder_expiry_days) || 30;
  const sections = [];

  if (s.reminder_expiry !== '0') {
    const rows = expiringItems(expiryDays);
    if (rows.length) {
      sections.push({
        key: 'expiry',
        title: `صلاحيات تنتهي خلال ${expiryDays} يوم`,
        items: rows.map((r) => `${r.name} — الكمية ${r.quantity} ${r.unit || ''} — ينتهي ${r.expiry_date}`),
      });
    }
  }
  if (s.reminder_low_stock !== '0') {
    const rows = lowStockItems();
    if (rows.length) {
      sections.push({
        key: 'low_stock',
        title: 'أصناف على وشك النفاد',
        items: rows.map((r) => `${r.name} — المتوفر ${r.quantity} ${r.unit || ''} — حد الطلب ${r.reorder_level}`),
      });
    }
  }
  if (s.reminder_debts !== '0') {
    const rows = debts();
    if (rows.length) {
      sections.push({
        key: 'debts',
        title: 'ذمم وتحصيلات',
        items: rows.map((r) => `${r.name}${r.phone ? ' - ' + r.phone : ''} — الرصيد ${money(r.balance)}${r.installments ? ` — أقساط ${money(r.installments)}` : ''}`),
      });
    }
  }
  if (s.reminder_sales_summary !== '0') {
    const row = salesSummary();
    if (row.count) {
      sections.push({
        key: 'sales',
        title: 'ملخص مبيعات الأمس',
        items: [`عدد الفواتير ${row.count} — المبيعات ${money(row.total)} — المحصّل ${money(row.paid)} — الربح ${money(row.profit)}`],
      });
    }
  }

  const company = s.company_name || 'Zain';
  const lines = [`*${company} — تذكير ${localDate()}*`];
  if (!sections.length) lines.push('لا توجد تنبيهات اليوم.');
  sections.forEach((sec) => {
    lines.push('');
    lines.push(`*${sec.title}*`);
    sec.items.forEach((it) => lines.push(`• ${it}`));
  });
  if (s.reminder_signature) {
    lines.push('');
    lines.push(s.reminder_signature);
  }

  const counts = {};
  sections.forEach((sec) => { counts[sec.key] = sec.items.length; });
  return { date: localDate(), sections, text: lines.join('\n'), counts };
}

function nextRunFor(row, from = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const [hh, mm] = String(row.time_of_day || '09:00').split(':').map((n) => Number(n) || 0);
  const base = new Date(from);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0);
  const repeat = row.repeat_type || 'daily';
  const interval = Math.max(1, Number(row.repeat_interval) || 1);
  if (repeat === 'once') return null;
  const stamp = (x) => `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`;
  if (d > base) {
    if (repeat === 'weekly') {
      const target = Number(row.day_of_week) || 0;
      const diff = (target - base.getDay() + 7) % 7;
      const next = new Date(base.getTime());
      next.setDate(base.getDate() + (diff === 0 ? 7 : diff));
      next.setHours(hh, mm, 0, 0);
      return stamp(next);
    }
    if (repeat === 'monthly') {
      const next = new Date(base.getFullYear(), base.getMonth() + 1, 1, hh, mm, 0, 0);
      const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.max(1, Math.min(Number(row.day_of_month) || 1, last)));
      return stamp(next);
    }
    return stamp(d);
  }
  const next = new Date(base.getTime());
  if (repeat === 'weekly') next.setDate(base.getDate() + interval * 7);
  else next.setMonth(base.getMonth() + interval);
  next.setHours(hh, mm, 0, 0);
  return stamp(next);
}

function rowToJson(r) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    kind: r.kind,
    repeat_type: r.repeat_type,
    repeat_interval: r.repeat_interval,
    time_of_day: r.time_of_day,
    day_of_week: r.day_of_week,
    day_of_month: r.day_of_month,
    next_run: r.next_run,
    last_run: r.last_run,
    active: !!r.active,
    created_at: r.created_at,
  };
}

function register(router) {
  router.get('/api/reminders', (ctx) => {
    requirePerm(ctx, 'reminders.view');
    const rows = db.all('SELECT * FROM reminders ORDER BY active DESC, next_run ASC, id DESC');
    sendJson(ctx.res, 200, { rows: rows.map(rowToJson) });
  });

  router.post('/api/reminders', (ctx) => {
    requirePerm(ctx, 'reminders.write');
    const b = ctx.body || {};
    if (!b.title || !String(b.title).trim()) throw new HttpError(400, 'العنوان مطلوب');
    if (b.kind && !KINDS.includes(b.kind)) throw new HttpError(400, 'نوع التذكير غير صحيح');
    if (b.repeat_type && !REPEATS.includes(b.repeat_type)) throw new HttpError(400, 'نوع التكرار غير صحيح');
    const repeat = b.repeat_type || 'daily';
    const timeOfDay = String(b.time_of_day || '09:00').slice(0, 5);
    const info = db.run(
      `INSERT INTO reminders (title, body, kind, repeat_type, repeat_interval, time_of_day, day_of_week, day_of_month, next_run, active, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
      [
        String(b.title).trim(),
        String(b.body || ''),
        b.kind || 'custom',
        repeat,
        Math.max(1, Number(b.repeat_interval) || 1),
        timeOfDay,
        Number(b.day_of_week) || 0,
        Number(b.day_of_month) || 1,
        repeat === 'once' ? null : nextRunFor({ time_of_day: timeOfDay, repeat_type: repeat, repeat_interval: b.repeat_interval, day_of_week: b.day_of_week, day_of_month: b.day_of_month }),
        b.active === 0 ? 0 : 1,
        ctx.user ? ctx.user.id : null,
      ]
    );
    const row = db.get('SELECT * FROM reminders WHERE id = ?', [info.lastInsertRowid]);
    db.logActivity(ctx.user ? ctx.user.id : null, 'reminder_create', 'reminders', row.id, { title: row.title });
    sendJson(ctx.res, 201, { reminder: rowToJson(row) });
  });

  router.put('/api/reminders/:id', (ctx) => {
    requirePerm(ctx, 'reminders.write');
    const row = db.get('SELECT * FROM reminders WHERE id = ?', [ctx.params.id]);
    if (!row) throw new HttpError(404, 'التذكير غير موجود');
    const b = ctx.body || {};
    if (b.kind && !KINDS.includes(b.kind)) throw new HttpError(400, 'نوع التذكير غير صحيح');
    if (b.repeat_type && !REPEATS.includes(b.repeat_type)) throw new HttpError(400, 'نوع التكرار غير صحيح');
    const repeat = b.repeat_type || row.repeat_type;
    const timeOfDay = String(b.time_of_day || row.time_of_day).slice(0, 5);
    const next = repeat === 'once' ? null : nextRunFor({
      time_of_day: timeOfDay,
      repeat_type: repeat,
      repeat_interval: b.repeat_interval || row.repeat_interval,
      day_of_week: b.day_of_week || row.day_of_week,
      day_of_month: b.day_of_month || row.day_of_month,
    });
    db.run(
      `UPDATE reminders SET title = ?, body = ?, kind = ?, repeat_type = ?, repeat_interval = ?, time_of_day = ?,
              day_of_week = ?, day_of_month = ?, next_run = ?, active = ? WHERE id = ?`,
      [
        String(b.title || row.title).trim(),
        String(b.body === undefined ? row.body : b.body),
        b.kind || row.kind,
        repeat,
        Math.max(1, Number(b.repeat_interval) || row.repeat_interval || 1),
        timeOfDay,
        Number(b.day_of_week || row.day_of_week) || 0,
        Number(b.day_of_month || row.day_of_month) || 1,
        next,
        b.active === undefined ? row.active : (b.active ? 1 : 0),
        ctx.params.id,
      ]
    );
    sendJson(ctx.res, 200, { reminder: rowToJson(db.get('SELECT * FROM reminders WHERE id = ?', [ctx.params.id])) });
  });

  router.delete('/api/reminders/:id', (ctx) => {
    requirePerm(ctx, 'reminders.write');
    const row = db.get('SELECT * FROM reminders WHERE id = ?', [ctx.params.id]);
    if (!row) throw new HttpError(404, 'التذكير غير موجود');
    db.run('DELETE FROM reminders WHERE id = ?', [ctx.params.id]);
    db.logActivity(ctx.user ? ctx.user.id : null, 'reminder_delete', 'reminders', row.id, { title: row.title });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.post('/api/reminders/:id/run', (ctx) => {
    requirePerm(ctx, 'reminders.write');
    const row = db.get('SELECT * FROM reminders WHERE id = ?', [ctx.params.id]);
    if (!row) throw new HttpError(404, 'التذكير غير موجود');
    db.run("UPDATE reminders SET last_run = datetime('now','localtime'), next_run = ? WHERE id = ?", [
      row.repeat_type === 'once' ? null : nextRunFor(row),
      ctx.params.id,
    ]);
    sendJson(ctx.res, 200, { reminder: rowToJson(db.get('SELECT * FROM reminders WHERE id = ?', [ctx.params.id])) });
  });

  router.get('/api/reminders/due', (ctx) => {
    requirePerm(ctx, 'reminders.view');
    const rows = db.all(
      `SELECT * FROM reminders WHERE active = 1 AND next_run IS NOT NULL AND next_run <= datetime('now','localtime')
       ORDER BY next_run ASC`
    );
    sendJson(ctx.res, 200, { rows: rows.map(rowToJson) });
  });

  router.get('/api/reminders/daily', (ctx) => {
    requirePerm(ctx, 'reminders.view');
    const digest = buildDigest();
    const custom = db.all('SELECT * FROM reminders WHERE active = 1 ORDER BY next_run ASC');
    sendJson(ctx.res, 200, {
      date: digest.date,
      text: digest.text,
      sections: digest.sections,
      counts: digest.counts,
      custom: custom.map(rowToJson),
      last_digest: db.getSetting('reminder_last_digest') || '',
      last_digest_at: db.getSetting('reminder_last_digest_at') || '',
    });
  });

  router.get('/api/reminders/digest.txt', (ctx) => {
    requirePerm(ctx, 'reminders.view');
    sendText(ctx.res, 200, buildDigest().text, 'text/plain; charset=utf-8');
  });
}

module.exports = { register, buildDigest, nextRunFor, localDate };
