const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const { pick, buildInsert, buildUpdate, list } = require('../core/crud');
const ledger = require('../core/ledger');

const FIELDS = ['name', 'phone', 'email', 'address', 'type', 'balance', 'credit_limit', 'notes', 'is_active'];

function normalize(data) {
  const out = pick(data, FIELDS);
  if ('balance' in out) out.balance = Number(out.balance) || 0;
  if ('credit_limit' in out) out.credit_limit = Number(out.credit_limit) || 0;
  if ('is_active' in out) out.is_active = out.is_active ? 1 : 0;
  return out;
}

module.exports = {
  register(router) {
    router.get('/api/customers', (ctx) => {
      const { search, type, page = 1, page_size = 50 } = ctx.query;
      const where = ['is_active = 1'];
      const params = [];
      if (type) {
        where.push('type = ?');
        params.push(type);
      }
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const result = list('customers', {
        where, params, order: 'name ASC', limit, offset,
        search, searchCols: ['name', 'phone', 'email', 'address'],
      });
      const totals = db.get('SELECT COALESCE(SUM(balance), 0) AS debtors FROM customers WHERE balance > 0');
      sendJson(ctx.res, 200, { ...result, debtors_total: totals.debtors });
    });

    router.get('/api/customers/:id', (ctx) => {
      const customer = db.get('SELECT * FROM customers WHERE id = ?', [ctx.params.id]);
      if (!customer) throw new HttpError(404, 'العميل غير موجود');
      const invoices = db.all(
        'SELECT * FROM invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 50', [ctx.params.id]
      );
      const installments = db.all(
        'SELECT * FROM installments WHERE customer_id = ? ORDER BY id DESC', [ctx.params.id]
      );
      sendJson(ctx.res, 200, { customer, invoices, installments });
    });

    router.post('/api/customers', (ctx) => {
      if (!ctx.can('customers.write')) throw new HttpError(403, 'لا تملك صلاحية الإضافة');
      const data = normalize(ctx.body || {});
      if (!data.name) throw new HttpError(400, 'اسم العميل مطلوب');
      const { sql, values } = buildInsert('customers', data);
      const res = db.run(sql, values);
      db.logActivity(ctx.user.id, 'create', 'customers', res.lastInsertRowid, { name: data.name });
      sendJson(ctx.res, 201, { customer: db.get('SELECT * FROM customers WHERE id = ?', [res.lastInsertRowid]) });
    });

    router.put('/api/customers/:id', (ctx) => {
      if (!ctx.can('customers.write')) throw new HttpError(403, 'لا تملك صلاحية التعديل');
      const existing = db.get('SELECT * FROM customers WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'العميل غير موجود');
      const data = normalize(ctx.body || {});
      const { sql, values } = buildUpdate('customers', existing.id, data);
      db.run(sql, values);
      db.logActivity(ctx.user.id, 'update', 'customers', existing.id);
      sendJson(ctx.res, 200, { customer: db.get('SELECT * FROM customers WHERE id = ?', [existing.id]) });
    });

    router.post('/api/customers/:id/payment', (ctx) => {
      if (!ctx.can('accounting.write') && !ctx.can('customers.write')) throw new HttpError(403, 'لا تملك صلاحية');
      const customer = db.get('SELECT * FROM customers WHERE id = ?', [ctx.params.id]);
      if (!customer) throw new HttpError(404, 'العميل غير موجود');
      const amount = Number((ctx.body || {}).amount);
      if (!amount || amount <= 0) throw new HttpError(400, 'المبلغ غير صحيح');
      const method = (ctx.body || {}).payment_method || 'cash';
      db.tx(() => {
        db.run('UPDATE customers SET balance = balance - ? WHERE id = ?', [amount, customer.id]);
        if (method === 'cash') {
          ledger.addTreasury({
            direction: 'in', amount, source: 'customer_payment', refTable: 'customers',
            refId: customer.id, description: `سداد من العميل ${customer.name}`, userId: ctx.user.id,
          });
          ledger.addAccountEntry({
            code: '1100', direction: 'debit', amount, refTable: 'customers', refId: customer.id,
            description: `سداد من العميل ${customer.name}`,
          });
          ledger.addAccountEntry({
            code: '1300', direction: 'credit', amount, refTable: 'customers', refId: customer.id,
            description: `سداد من العميل ${customer.name}`,
          });
        }
      });
      db.logActivity(ctx.user.id, 'customer_payment', 'customers', customer.id, { amount, method });
      sendJson(ctx.res, 200, { customer: db.get('SELECT * FROM customers WHERE id = ?', [customer.id]) });
    });

    router.delete('/api/customers/:id', (ctx) => {
      if (!ctx.can('customers.write')) throw new HttpError(403, 'لا تملك صلاحية الحذف');
      const customer = db.get('SELECT * FROM customers WHERE id = ?', [ctx.params.id]);
      if (!customer) throw new HttpError(404, 'العميل غير موجود');
      db.run('UPDATE customers SET is_active = 0 WHERE id = ?', [customer.id]);
      db.logActivity(ctx.user.id, 'archive', 'customers', customer.id);
      sendJson(ctx.res, 200, { ok: true });
    });
  },
};
