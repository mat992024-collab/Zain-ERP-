const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const ledger = require('../core/ledger');
const currency = require('./currency.routes');
const { pick, buildInsert, buildUpdate, list } = require('../core/crud');

const EXPENSE_FIELDS = ['category', 'description', 'amount', 'payment_method', 'date', 'currency', 'exchange_rate', 'amount_original'];
const ACCOUNT_FIELDS = ['code', 'name', 'type', 'parent_id'];

function buildIncomeStatement(query = {}) {
  const from = query.from || "date('now','localtime','-29 days')";
  const to = query.to || "date('now','localtime')";
  const useFrom = query.from ? 'date(?)' : from;
  const useTo = query.to ? 'date(?)' : to;
  const params = [];
  if (query.from) params.push(query.from);
  if (query.to) params.push(query.to);
  const range = `date(created_at) BETWEEN ${useFrom} AND ${useTo}`;
  const invRange = range.replace(/created_at/g, 'i.created_at');

  const sales = db.get(
    `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM invoices WHERE type='sale' AND ${range}`, params
  );
  const returns = db.get(
    `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM invoices WHERE type='return_sale' AND ${range}`, params
  );
  const cogs = db.get(
    `SELECT COALESCE(SUM(it.cost_price * it.qty),0) AS total FROM invoice_items it
     JOIN invoices i ON i.id = it.invoice_id WHERE i.type='sale' AND ${invRange}`, params
  );
  const cogsReturns = db.get(
    `SELECT COALESCE(SUM(it.cost_price * it.qty),0) AS total FROM invoice_items it
     JOIN invoices i ON i.id = it.invoice_id WHERE i.type='return_sale' AND ${invRange}`, params
  );
  const expenses = db.get(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE ${range}`, params);
  const expensesByCategory = db.all(
    `SELECT category, COALESCE(SUM(amount),0) AS amount, COUNT(*) AS count FROM expenses
     WHERE ${range} GROUP BY category ORDER BY amount DESC`, params
  );
  const otherIncome = db.get(
    `SELECT COALESCE(SUM(amount),0) AS total FROM treasury WHERE direction='in'
     AND source NOT IN ('sale_cash','sale_card','customer_payment','installment_payment')
     AND ${range}`, params
  );
  const otherExpense = db.get(
    `SELECT COALESCE(SUM(amount),0) AS total FROM treasury WHERE direction='out'
     AND source NOT IN ('purchase','sale_cash','sale_card','expense','supplier_payment','return_sale')
     AND ${range}`, params
  );
  const purchases = db.get(
    `SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE type='purchase' AND ${range}`, params
  );
  const purchaseReturns = db.get(
    `SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE type='return_purchase' AND ${range}`, params
  );

  const revenue = Number(sales.total) - Number(returns.total);
  const netCogs = Number(cogs.total) - Number(cogsReturns.total);
  const grossProfit = revenue - netCogs;
  const totalExpenses = Number(expenses.total) + Number(otherExpense.total);
  const netProfit = grossProfit - totalExpenses + Number(otherIncome.total);
  const salesCount = Number(sales.count) || 0;

  const byPayment = db.all(
    `SELECT payment_method, COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM invoices
     WHERE type='sale' AND ${range} GROUP BY payment_method`, params
  );
  const daily = db.all(
    `SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total, COUNT(*) AS count
     FROM invoices WHERE type='sale' AND ${range} GROUP BY day ORDER BY day`, params
  );
  const topProducts = db.all(
    `SELECT it.name, COALESCE(SUM(it.qty),0) AS qty,
            COALESCE(SUM(it.total),0) AS revenue,
            COALESCE(SUM(it.cost_price * it.qty),0) AS cost
     FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
     WHERE i.type='sale' AND ${invRange}
     GROUP BY it.name ORDER BY revenue DESC LIMIT 10`, params
  ).map((p) => ({
    ...p,
    profit: Math.round((p.revenue - p.cost) * 100) / 100,
    margin_pct: p.revenue ? Math.round(((p.revenue - p.cost) / p.revenue) * 10000) / 100 : 0,
  }));

  return {
    period: { from: query.from || null, to: query.to || null },
    sales_total: Number(sales.total),
    sales_count: salesCount,
    returns_total: Number(returns.total),
    revenue,
    cogs: netCogs,
    gross_profit: grossProfit,
    gross_margin: revenue ? Math.round((grossProfit / revenue) * 10000) / 100 : 0,
    expenses_total: totalExpenses,
    expenses_by_category: expensesByCategory,
    other_income: Number(otherIncome.total),
    other_expense: Number(otherExpense.total),
    purchases_total: Number(purchases.total),
    purchase_returns_total: Number(purchaseReturns.total),
    net_profit: netProfit,
    net_margin: revenue ? Math.round((netProfit / revenue) * 10000) / 100 : 0,
    avg_ticket: salesCount ? Math.round((revenue / salesCount) * 100) / 100 : 0,
    by_payment: byPayment,
    daily,
    top_products: topProducts,
  };
}

module.exports = {
  buildIncomeStatement,
  register(router) {
    router.get('/api/accounts', (ctx) => {
      const rows = db.all('SELECT * FROM accounts ORDER BY code');
      for (const row of rows) row.computed_balance = ledger.accountBalance(row.id);
      const byParent = {};
      for (const row of rows) {
        const key = row.parent_id || 0;
        (byParent[key] = byParent[key] || []).push(row);
      }
      const build = (parentId) => (byParent[parentId] || []).map((r) => ({ ...r, children: build(r.id) }));
      sendJson(ctx.res, 200, { accounts: rows, tree: build(0) });
    });

    router.post('/api/accounts', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الإضافة');
      const data = pick(ctx.body || {}, ACCOUNT_FIELDS);
      if (!data.code || !data.name) throw new HttpError(400, 'رمز واسم الحساب مطلوبان');
      const { sql, values } = buildInsert('accounts', data);
      const res = db.run(sql, values);
      sendJson(ctx.res, 201, { account: db.get('SELECT * FROM accounts WHERE id = ?', [res.lastInsertRowid]) });
    });

    router.put('/api/accounts/:id', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية التعديل');
      const existing = db.get('SELECT * FROM accounts WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'الحساب غير موجود');
      const data = pick(ctx.body || {}, ACCOUNT_FIELDS);
      const { sql, values } = buildUpdate('accounts', existing.id, data);
      db.run(sql, values);
      sendJson(ctx.res, 200, { account: db.get('SELECT * FROM accounts WHERE id = ?', [existing.id]) });
    });

    router.delete('/api/accounts/:id', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الحذف');
      const account = db.get('SELECT * FROM accounts WHERE id = ?', [ctx.params.id]);
      if (!account) throw new HttpError(404, 'الحساب غير موجود');
      if (account.is_system) throw new HttpError(400, 'لا يمكن حذف حساب نظامي');
      const used = db.get('SELECT COUNT(*) AS c FROM account_entries WHERE account_id = ?', [account.id]).c;
      if (used) throw new HttpError(400, 'الحساب مستخدم في قيود');
      db.run('DELETE FROM accounts WHERE id = ?', [account.id]);
      sendJson(ctx.res, 200, { ok: true });
    });

    router.get('/api/accounts/:id/entries', (ctx) => {
      const rows = db.all(
        `SELECT * FROM account_entries WHERE account_id = ? ORDER BY id DESC LIMIT 500`, [ctx.params.id]
      );
      sendJson(ctx.res, 200, { entries: rows, balance: ledger.accountBalance(ctx.params.id) });
    });

    router.get('/api/expenses', (ctx) => {
      const { from, to, category, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];
      if (from) { where.push('date(created_at) >= date(?)'); params.push(from); }
      if (to) { where.push('date(created_at) <= date(?)'); params.push(to); }
      if (category) { where.push('category = ?'); params.push(category); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const rows = db.all(
        `SELECT e.*, u.full_name AS user_name FROM expenses e LEFT JOIN users u ON u.id = e.user_id
         ${whereSql} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const total = db.get(`SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS sum_amount FROM expenses ${whereSql}`, params);
      const byCategory = db.all(
        `SELECT category, COALESCE(SUM(amount),0) AS amount FROM expenses ${whereSql} GROUP BY category ORDER BY amount DESC`,
        params
      );
      sendJson(ctx.res, 200, { rows, total: total.c, sum_amount: total.sum_amount, by_category: byCategory });
    });

    router.post('/api/expenses', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الإضافة');
      const body = ctx.body || {};
      const data = pick(body, EXPENSE_FIELDS);
      const cur = currency.currencyOf(body.currency);
      const rate = Number(cur.rate) || 1;
      data.amount = Number(data.amount) || 0;
      if (!data.amount) throw new HttpError(400, 'المبلغ مطلوب');
      data.currency = cur.code;
      data.exchange_rate = rate;
      data.amount_original = cur.is_base ? data.amount : currency.roundTo(data.amount / rate, cur.decimals);
      data.user_id = ctx.user.id;
      const { sql, values } = buildInsert('expenses', data);
      let id;
      db.tx(() => {
        const res = db.run(sql, values);
        id = Number(res.lastInsertRowid);
        if ((data.payment_method || 'cash') === 'cash') {
          ledger.addTreasury({
            direction: 'out', amount: data.amount, source: 'expense', refTable: 'expenses',
            refId: id, description: `مصروف: ${data.category} - ${data.description || ''}`, userId: ctx.user.id,
          });
        }
        ledger.addAccountEntry({ code: '5200', direction: 'debit', amount: data.amount, refTable: 'expenses', refId: id, description: data.description || data.category });
        if ((data.payment_method || 'cash') === 'cash') {
          ledger.addAccountEntry({ code: '1100', direction: 'credit', amount: data.amount, refTable: 'expenses', refId: id, description: data.description || data.category });
        }
      });
      db.logActivity(ctx.user.id, 'create', 'expenses', id, { amount: data.amount });
      sendJson(ctx.res, 201, { expense: db.get('SELECT * FROM expenses WHERE id = ?', [id]) });
    });

    router.delete('/api/expenses/:id', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الحذف');
      const expense = db.get('SELECT * FROM expenses WHERE id = ?', [ctx.params.id]);
      if (!expense) throw new HttpError(404, 'المصروف غير موجود');
      db.tx(() => {
        db.run('DELETE FROM expenses WHERE id = ?', [expense.id]);
        if ((expense.payment_method || 'cash') === 'cash') {
          ledger.addTreasury({
            direction: 'in', amount: expense.amount, source: 'expense_reversal', refTable: 'expenses',
            refId: expense.id, description: `إلغاء مصروف #${expense.id}`, userId: ctx.user.id,
          });
        }
      });
      db.logActivity(ctx.user.id, 'delete', 'expenses', expense.id);
      sendJson(ctx.res, 200, { ok: true });
    });

    router.get('/api/treasury', (ctx) => {
      const { from, to, direction, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];
      if (from) { where.push('date(created_at) >= date(?)'); params.push(from); }
      if (to) { where.push('date(created_at) <= date(?)'); params.push(to); }
      if (direction) { where.push('direction = ?'); params.push(direction); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const rows = db.all(
        `SELECT t.*, u.full_name AS user_name FROM treasury t LEFT JOIN users u ON u.id = t.user_id
         ${whereSql} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const totals = db.get(
        `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS total_in,
                COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS total_out
         FROM treasury ${whereSql}`, params
      );
      sendJson(ctx.res, 200, { rows, total_in: totals.total_in, total_out: totals.total_out, balance: ledger.currentTreasuryBalance() });
    });

    router.post('/api/treasury', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الإضافة');
      const { direction = 'in', amount, description, source = 'manual' } = ctx.body || {};
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new HttpError(400, 'المبلغ غير صحيح');
      let balance;
      db.tx(() => {
        balance = ledger.addTreasury({
          direction: direction === 'out' ? 'out' : 'in', amount: amt, source,
          description: description || 'حركة يدوية', userId: ctx.user.id,
        });
        ledger.addAccountEntry({
          code: '1100', direction: direction === 'out' ? 'credit' : 'debit',
          amount: amt, refTable: 'treasury', description: description || 'حركة يدوية',
        });
      });
      db.logActivity(ctx.user.id, 'treasury_' + direction, 'treasury', null, { amount: amt });
      sendJson(ctx.res, 201, { ok: true, balance });
    });

    router.get('/api/installments', (ctx) => {
      const { status, customer_id, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];
      if (status) { where.push('i.status = ?'); params.push(status); }
      if (customer_id) { where.push('i.customer_id = ?'); params.push(customer_id); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const rows = db.all(
        `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone FROM installments i
         LEFT JOIN customers c ON c.id = i.customer_id ${whereSql} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const totals = db.get(
        `SELECT COUNT(*) AS c, COALESCE(SUM(remaining),0) AS remaining_total FROM installments ${whereSql}`, params
      );
      sendJson(ctx.res, 200, { rows, total: totals.c, remaining_total: totals.remaining_total });
    });

    router.post('/api/installments/:id/pay', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية');
      const inst = db.get('SELECT * FROM installments WHERE id = ?', [ctx.params.id]);
      if (!inst) throw new HttpError(404, 'القسط غير موجود');
      const amount = Number((ctx.body || {}).amount);
      if (!amount || amount <= 0) throw new HttpError(400, 'المبلغ غير صحيح');
      if (amount > inst.remaining + 0.001) throw new HttpError(400, 'المبلغ يتجاوز المتبقي');
      const newPaid = Number(inst.paid_amount) + amount;
      const newRemaining = Number(inst.total) - newPaid;
      db.tx(() => {
        db.run(
          `UPDATE installments SET paid_amount = ?, remaining = ?, status = ? WHERE id = ?`,
          [newPaid, newRemaining, newRemaining <= 0.001 ? 'completed' : 'active', inst.id]
        );
        db.run('INSERT INTO installment_payments (installment_id, amount, user_id, notes) VALUES (?, ?, ?, ?)',
          [inst.id, amount, ctx.user.id, (ctx.body || {}).notes || null]);
        db.run('UPDATE customers SET balance = balance - ? WHERE id = ?', [amount, inst.customer_id]);
        ledger.addTreasury({
          direction: 'in', amount, source: 'installment_payment', refTable: 'installments',
          refId: inst.id, description: `قسط فاتورة #${inst.invoice_id || inst.id}`, userId: ctx.user.id,
        });
        ledger.addAccountEntry({ code: '1100', direction: 'debit', amount, refTable: 'installments', refId: inst.id, description: 'تحصيل قسط' });
        ledger.addAccountEntry({ code: '1300', direction: 'credit', amount, refTable: 'installments', refId: inst.id, description: 'تحصيل قسط' });
      });
      db.logActivity(ctx.user.id, 'installment_pay', 'installments', inst.id, { amount });
      sendJson(ctx.res, 200, { installment: db.get('SELECT * FROM installments WHERE id = ?', [inst.id]) });
    });

    router.get('/api/reports/summary', (ctx) => {
      const from = ctx.query.from || "date('now','localtime','-29 days')";
      const to = ctx.query.to || "date('now','localtime')";
      const useRaw = ctx.query.from ? 'date(?)' : from;
      const useRawTo = ctx.query.to ? 'date(?)' : to;
      const params = [];
      let range = `date(created_at) BETWEEN ${useRaw} AND ${useRawTo}`;
      if (ctx.query.from) params.push(ctx.query.from);
      if (ctx.query.to) params.push(ctx.query.to);

      const sales = db.get(
        `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM invoices WHERE type='sale' AND ${range}`, params
      );
      const returns = db.get(
        `SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE type='return_sale' AND ${range}`, params
      );
      const purchases = db.get(
        `SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE type='purchase' AND ${range}`, params
      );
      const cogs = db.get(
        `SELECT COALESCE(SUM(it.cost_price * it.qty),0) AS total FROM invoice_items it
         JOIN invoices i ON i.id = it.invoice_id WHERE i.type='sale' AND ${range.replace(/created_at/g, 'i.created_at')}`,
        params
      );
      const expenses = db.get(
        `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE ${range}`, params
      );
      const revenue = Number(sales.total) - Number(returns.total);
      const grossProfit = revenue - Number(cogs.total);
      const netProfit = grossProfit - Number(expenses.total);
      const daily = db.all(
        `SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total, COUNT(*) AS count
         FROM invoices WHERE type='sale' AND ${range} GROUP BY day ORDER BY day`, params
      );
      const byPayment = db.all(
        `SELECT payment_method, COALESCE(SUM(total),0) AS total FROM invoices WHERE type='sale' AND ${range} GROUP BY payment_method`,
        params
      );
      sendJson(ctx.res, 200, {
        sales: sales.total, sales_count: sales.count, returns: returns.total, purchases: purchases.total,
        cogs: cogs.total, expenses: expenses.total, revenue, gross_profit: grossProfit, net_profit: netProfit,
        daily, by_payment: byPayment,
      });
    });

    router.get('/api/reports/income-statement', (ctx) => {
      sendJson(ctx.res, 200, buildIncomeStatement(ctx.query));
    });

    router.get('/api/reports/trial-balance', (ctx) => {
      const rows = db.all(
        `SELECT a.code, a.name, a.type,
           COALESCE(SUM(CASE WHEN e.direction='debit' THEN e.amount ELSE 0 END),0) AS debit,
           COALESCE(SUM(CASE WHEN e.direction='credit' THEN e.amount ELSE 0 END),0) AS credit
         FROM accounts a LEFT JOIN account_entries e ON e.account_id = a.id
         GROUP BY a.id ORDER BY a.code`
      );
      const totals = rows.reduce((acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }), { debit: 0, credit: 0 });
      sendJson(ctx.res, 200, { rows, totals });
    });
  },
};
