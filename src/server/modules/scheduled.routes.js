const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const sales = require('./sales.routes');

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
const TYPES = ['sale', 'purchase'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function nextRun(from, frequency) {
  const d = new Date(String(from || '').replace(' ', 'T'));
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  if (frequency === 'daily') base.setDate(base.getDate() + 1);
  else if (frequency === 'weekly') base.setDate(base.getDate() + 7);
  else if (frequency === 'yearly') base.setFullYear(base.getFullYear() + 1);
  else base.setMonth(base.getMonth() + 1);
  return formatLocal(base);
}

function parseItems(raw) {
  let items = raw;
  if (typeof raw === 'string') {
    try { items = JSON.parse(raw); } catch { items = []; }
  }
  const normalized = sales.normalizeItems(Array.isArray(items) ? items : []);
  return normalized.map((i) => ({
    product_id: i.product_id,
    name: i.name,
    qty: i.qty,
    unit: i.unit,
    unit_price: i.unit_price,
    cost_price: i.cost_price,
    discount: i.discount,
    tax_rate: i.tax_rate,
    total: i.total,
  }));
}

function pick(src, existing, key, def) {
  if (src[key] !== undefined) return src[key];
  if (existing) return existing[key];
  return def;
}

function normalizeSchedule(body, existing) {
  const src = body || {};
  const isNew = !existing;
  const out = {};

  const title = String(pick(src, existing, 'title', '') || '').trim();
  if (!title) throw new HttpError(400, 'عنوان الجدولة مطلوب');
  if (isNew || 'title' in src) out.title = title;

  const type = pick(src, existing, 'type', 'sale');
  if (!TYPES.includes(type)) throw new HttpError(400, 'نوع الفاتورة غير صحيح');
  if (isNew || 'type' in src) out.type = type;

  const frequency = pick(src, existing, 'frequency', 'monthly');
  if (!FREQUENCIES.includes(frequency)) throw new HttpError(400, 'تكرار الجدولة غير صحيح');
  if (isNew || 'frequency' in src) out.frequency = frequency;

  const items = parseItems(pick(src, existing, 'items', []));
  if (!items.length) throw new HttpError(400, 'الجدولة تحتاج صنفاً واحداً على الأقل');
  if (isNew || 'items' in src) out.items = JSON.stringify(items);

  const rawNext = pick(src, existing, 'next_run', '');
  const when = new Date(String(rawNext || '').replace(' ', 'T'));
  if (Number.isNaN(when.getTime())) throw new HttpError(400, 'تاريخ التشغيل القادم غير صحيح');
  if (isNew || 'next_run' in src) out.next_run = formatLocal(when);

  const customerId = pick(src, existing, 'customer_id', null);
  const supplierId = pick(src, existing, 'supplier_id', null);
  const method = pick(src, existing, 'payment_method', 'credit') === 'cash' ? 'cash' : 'credit';
  const discount = Number(pick(src, existing, 'discount', 0)) || 0;
  if (discount < 0) throw new HttpError(400, 'الخصم غير صحيح');
  const notes = pick(src, existing, 'notes', null);
  const active = pick(src, existing, 'active', 1) ? 1 : 0;

  if (isNew || 'customer_id' in src) out.customer_id = customerId ? Number(customerId) : null;
  if (isNew || 'supplier_id' in src) out.supplier_id = supplierId ? Number(supplierId) : null;
  if (isNew || 'payment_method' in src) out.payment_method = method;
  if (isNew || 'discount' in src) out.discount = discount;
  if (isNew || 'notes' in src) out.notes = notes ? (String(notes).trim() || null) : null;
  if (isNew || 'active' in src) out.active = active;

  if (type === 'sale' && !customerId && method === 'credit') throw new HttpError(400, 'البيع الآجل في الجدولة يتطلب اختيار عميل');
  if (type === 'purchase' && !supplierId) throw new HttpError(400, 'جدولة الشراء تتطلب اختيار مورد');
  return out;
}

function listScheduled() {
  return db.all(
    `SELECT s.*, c.name AS customer_name, sp.name AS supplier_name
     FROM scheduled_invoices s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN suppliers sp ON sp.id = s.supplier_id
     ORDER BY s.active DESC, s.next_run ASC, s.id ASC`
  );
}

function runOne(row, userId) {
  const items = parseItems(row.items);
  const type = row.type === 'purchase' ? 'purchase' : 'sale';
  const result = sales.persistInvoice({
    type,
    posMode: 'fast',
    customerId: row.customer_id,
    supplierId: row.supplier_id,
    userId: userId || row.user_id || null,
    items,
    discount: Number(row.discount) || 0,
    tax: 0,
    taxInclusive: false,
    paymentMethod: row.payment_method === 'cash' ? 'cash' : 'credit',
    notes: row.notes || `فاتورة مجدولة: ${row.title}`,
  });
  const now = db.get("SELECT datetime('now','localtime') AS t").t;
  db.run(
    `UPDATE scheduled_invoices SET last_run = ?, next_run = ?, runs_count = runs_count + 1,
       last_invoice_id = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [now, nextRun(now, row.frequency), Number(result.id), row.id]
  );
  db.logActivity(userId || row.user_id || null, 'scheduled_invoice', 'invoices', Number(result.id), {
    schedule_id: row.id, title: row.title,
  });
  return result;
}

function runDue(userId) {
  const rows = db.all(
    `SELECT * FROM scheduled_invoices WHERE active = 1 AND datetime(next_run) <= datetime('now','localtime') ORDER BY next_run ASC, id ASC`
  );
  const created = [];
  for (const row of rows) {
    try {
      const result = runOne(row, userId);
      created.push({ schedule_id: row.id, invoice_id: Number(result.id) });
    } catch (err) {
      console.error('[zain] scheduled invoice failed:', row.id, err.message);
    }
  }
  return created;
}

module.exports = {
  nextRun,
  runDue,
  runOne,
  register(router) {
    router.get('/api/scheduled', (ctx) => {
      sendJson(ctx.res, 200, { rows: listScheduled() });
    });

    router.post('/api/scheduled', (ctx) => {
      if (!ctx.can('sales.write') && !ctx.can('purchases.write')) throw new HttpError(403, 'لا تملك صلاحية الجدولة');
      const data = normalizeSchedule(ctx.body || {}, null);
      data.user_id = ctx.user.id;
      const cols = Object.keys(data);
      const res = db.run(
        `INSERT INTO scheduled_invoices (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => data[c])
      );
      db.logActivity(ctx.user.id, 'create', 'scheduled_invoices', Number(res.lastInsertRowid), { title: data.title });
      const row = db.get('SELECT * FROM scheduled_invoices WHERE id = ?', [Number(res.lastInsertRowid)]);
      sendJson(ctx.res, 201, { schedule: row, rows: listScheduled() });
    });

    router.put('/api/scheduled/:id', (ctx) => {
      if (!ctx.can('sales.write') && !ctx.can('purchases.write')) throw new HttpError(403, 'لا تملك صلاحية الجدولة');
      const existing = db.get('SELECT * FROM scheduled_invoices WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'الجدولة غير موجودة');
      const data = normalizeSchedule(ctx.body || {}, existing);
      data.updated_at = db.get("SELECT datetime('now','localtime') AS t").t;
      const cols = Object.keys(data);
      db.run(
        `UPDATE scheduled_invoices SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...cols.map((c) => data[c]), existing.id]
      );
      db.logActivity(ctx.user.id, 'update', 'scheduled_invoices', existing.id, { title: data.title || existing.title });
      sendJson(ctx.res, 200, { rows: listScheduled() });
    });

    router.delete('/api/scheduled/:id', (ctx) => {
      if (!ctx.can('sales.write') && !ctx.can('purchases.write')) throw new HttpError(403, 'لا تملك صلاحية الجدولة');
      const existing = db.get('SELECT * FROM scheduled_invoices WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'الجدولة غير موجودة');
      db.run('DELETE FROM scheduled_invoices WHERE id = ?', [existing.id]);
      db.logActivity(ctx.user.id, 'delete', 'scheduled_invoices', existing.id, { title: existing.title });
      sendJson(ctx.res, 200, { rows: listScheduled() });
    });

    router.post('/api/scheduled/run-due', (ctx) => {
      if (!ctx.can('sales.write') && !ctx.can('purchases.write')) throw new HttpError(403, 'لا تملك صلاحية الجدولة');
      const created = runDue(ctx.user.id);
      sendJson(ctx.res, 200, { created, rows: listScheduled() });
    });

    router.post('/api/scheduled/:id/run', (ctx) => {
      if (!ctx.can('sales.write') && !ctx.can('purchases.write')) throw new HttpError(403, 'لا تملك صلاحية الجدولة');
      const existing = db.get('SELECT * FROM scheduled_invoices WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'الجدولة غير موجودة');
      const result = runOne(existing, ctx.user.id);
      sendJson(ctx.res, 201, {
        invoice: db.get('SELECT * FROM invoices WHERE id = ?', [Number(result.id)]),
        rows: listScheduled(),
      });
    });
  },
};
