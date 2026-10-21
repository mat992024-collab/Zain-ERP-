const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const { pick, buildInsert, buildUpdate, list } = require('../core/crud');
const ledger = require('../core/ledger');

const FIELDS = ['name', 'phone', 'email', 'address', 'company', 'balance', 'notes', 'is_active'];

function normalize(data) {
  const out = pick(data, FIELDS);
  if ('balance' in out) out.balance = Number(out.balance) || 0;
  if ('is_active' in out) out.is_active = out.is_active ? 1 : 0;
  return out;
}

module.exports = {
  register(router) {
    router.get('/api/suppliers', (ctx) => {
      const { search, page = 1, page_size = 100 } = ctx.query;
      const limit = Math.min(Number(page_size) || 100, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const result = list('suppliers', {
        where: ['is_active = 1'], params: [], order: 'name ASC', limit, offset,
        search, searchCols: ['name', 'phone', 'email', 'company'],
      });
      const totals = db.get('SELECT COALESCE(SUM(balance), 0) AS creditors FROM suppliers WHERE balance > 0');
      sendJson(ctx.res, 200, { ...result, creditors_total: totals.creditors });
    });

    router.get('/api/suppliers/:id', (ctx) => {
      const supplier = db.get('SELECT * FROM suppliers WHERE id = ?', [ctx.params.id]);
      if (!supplier) throw new HttpError(404, 'المورد غير موجود');
      const invoices = db.all('SELECT * FROM invoices WHERE supplier_id = ? ORDER BY id DESC LIMIT 50', [ctx.params.id]);
      const products = db.all('SELECT id, name, quantity, cost_price FROM products WHERE supplier_id = ? LIMIT 100', [ctx.params.id]);
      sendJson(ctx.res, 200, { supplier, invoices, products });
    });

    router.post('/api/suppliers', (ctx) => {
      if (!ctx.can('suppliers.write')) throw new HttpError(403, 'لا تملك صلاحية الإضافة');
      const data = normalize(ctx.body || {});
      if (!data.name) throw new HttpError(400, 'اسم المورد مطلوب');
      const { sql, values } = buildInsert('suppliers', data);
      const res = db.run(sql, values);
      db.logActivity(ctx.user.id, 'create', 'suppliers', res.lastInsertRowid, { name: data.name });
      sendJson(ctx.res, 201, { supplier: db.get('SELECT * FROM suppliers WHERE id = ?', [res.lastInsertRowid]) });
    });

    router.put('/api/suppliers/:id', (ctx) => {
      if (!ctx.can('suppliers.write')) throw new HttpError(403, 'لا تملك صلاحية التعديل');
      const existing = db.get('SELECT * FROM suppliers WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'المورد غير موجود');
      const data = normalize(ctx.body || {});
      const { sql, values } = buildUpdate('suppliers', existing.id, data);
      db.run(sql, values);
      db.logActivity(ctx.user.id, 'update', 'suppliers', existing.id);
      sendJson(ctx.res, 200, { supplier: db.get('SELECT * FROM suppliers WHERE id = ?', [existing.id]) });
    });

    router.post('/api/suppliers/:id/payment', (ctx) => {
      if (!ctx.can('accounting.write') && !ctx.can('suppliers.write')) throw new HttpError(403, 'لا تملك صلاحية');
      const supplier = db.get('SELECT * FROM suppliers WHERE id = ?', [ctx.params.id]);
      if (!supplier) throw new HttpError(404, 'المورد غير موجود');
      const amount = Number((ctx.body || {}).amount);
      if (!amount || amount <= 0) throw new HttpError(400, 'المبلغ غير صحيح');
      db.tx(() => {
        db.run('UPDATE suppliers SET balance = balance - ? WHERE id = ?', [amount, supplier.id]);
        ledger.addTreasury({
          direction: 'out', amount, source: 'supplier_payment', refTable: 'suppliers',
          refId: supplier.id, description: `دفعة للمورد ${supplier.name}`, userId: ctx.user.id,
        });
        ledger.addAccountEntry({ code: '2100', direction: 'debit', amount, refTable: 'suppliers', refId: supplier.id, description: 'سداد مورد' });
        ledger.addAccountEntry({ code: '1100', direction: 'credit', amount, refTable: 'suppliers', refId: supplier.id, description: 'سداد مورد' });
      });
      db.logActivity(ctx.user.id, 'supplier_payment', 'suppliers', supplier.id, { amount });
      sendJson(ctx.res, 200, { supplier: db.get('SELECT * FROM suppliers WHERE id = ?', [supplier.id]) });
    });

    router.delete('/api/suppliers/:id', (ctx) => {
      if (!ctx.can('suppliers.write')) throw new HttpError(403, 'لا تملك صلاحية الحذف');
      const supplier = db.get('SELECT * FROM suppliers WHERE id = ?', [ctx.params.id]);
      if (!supplier) throw new HttpError(404, 'المورد غير موجود');
      db.run('UPDATE suppliers SET is_active = 0 WHERE id = ?', [supplier.id]);
      db.logActivity(ctx.user.id, 'archive', 'suppliers', supplier.id);
      sendJson(ctx.res, 200, { ok: true });
    });
  },
};
