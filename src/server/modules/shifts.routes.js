const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const ledger = require('../core/ledger');

function shiftSummary(shift) {
  const sales = db.get(
    `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM invoices
     WHERE shift_id = ? AND type='sale'`, [shift.id]
  );
  const cash = db.get(
    `SELECT COALESCE(SUM(amount),0) AS total FROM treasury
     WHERE shift_id = ? AND direction='in' AND source NOT IN ('sale_card','sale_wallet')`, [shift.id]
  );
  const refunds = db.get(
    `SELECT COALESCE(SUM(amount),0) AS total FROM treasury
     WHERE shift_id = ? AND direction='out' AND source = 'return_sale'`, [shift.id]
  );
  const expenses = db.get(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE shift_id = ?`, [shift.id]
  );
  const expected = Number(shift.opening_balance) + Number(cash.total) - Number(refunds.total) - Number(expenses.total);
  return {
    ...shift,
    live_sales_total: sales.total,
    live_sales_count: sales.count,
    live_cash_in: cash.total,
    live_refunds: refunds.total,
    live_expenses: expenses.total,
    expected_cash: expected,
  };
}

module.exports = {
  register(router) {
    router.get('/api/shifts', (ctx) => {
      const { from, to, status, user_id, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];
      if (status) { where.push('s.status = ?'); params.push(status); }
      if (user_id) { where.push('s.user_id = ?'); params.push(user_id); }
      if (from) { where.push('date(s.opened_at) >= date(?)'); params.push(from); }
      if (to) { where.push('date(s.opened_at) <= date(?)'); params.push(to); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const rows = db.all(
        `SELECT s.*, u.full_name AS user_name FROM shifts s LEFT JOIN users u ON u.id = s.user_id
         ${whereSql} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      sendJson(ctx.res, 200, { rows: rows.map((r) => (r.status === 'open' ? shiftSummary(r) : r)) });
    });

    router.get('/api/shifts/current', (ctx) => {
      const shift = db.get(
        `SELECT * FROM shifts WHERE status = 'open' AND user_id = ? ORDER BY id DESC LIMIT 1`, [ctx.user.id]
      );
      sendJson(ctx.res, 200, { shift: shift ? shiftSummary(shift) : null });
    });

    router.get('/api/shifts/:id', (ctx) => {
      const shift = db.get(
        `SELECT s.*, u.full_name AS user_name FROM shifts s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
        [ctx.params.id]
      );
      if (!shift) throw new HttpError(404, 'الوردية غير موجودة');
      sendJson(ctx.res, 200, { shift: shiftSummary(shift) });
    });

    router.post('/api/shifts/open', (ctx) => {
      if (!ctx.can('pos.shift')) throw new HttpError(403, 'لا تملك صلاحية الورديات');
      const existing = db.get(`SELECT id FROM shifts WHERE status='open' AND user_id = ?`, [ctx.user.id]);
      if (existing) throw new HttpError(400, 'لديك وردية مفتوحة بالفعل');
      const opening = Number((ctx.body || {}).opening_balance) || 0;
      const res = db.run(
        `INSERT INTO shifts (user_id, opening_balance, branch, notes) VALUES (?, ?, ?, ?)`,
        [ctx.user.id, opening, (ctx.body || {}).branch || 'main', (ctx.body || {}).notes || null]
      );
      if (opening > 0) {
        ledger.addTreasury({
          direction: 'in', amount: opening, source: 'shift_open', refTable: 'shifts',
          refId: res.lastInsertRowid, description: 'رصيد افتتاحي للوردية', userId: ctx.user.id,
        });
      }
      db.logActivity(ctx.user.id, 'shift_open', 'shifts', res.lastInsertRowid, { opening });
      sendJson(ctx.res, 201, { shift: shiftSummary(db.get('SELECT * FROM shifts WHERE id = ?', [res.lastInsertRowid])) });
    });

    router.post('/api/shifts/:id/close', (ctx) => {
      if (!ctx.can('pos.shift')) throw new HttpError(403, 'لا تملك صلاحية الورديات');
      const shift = db.get('SELECT * FROM shifts WHERE id = ?', [ctx.params.id]);
      if (!shift) throw new HttpError(404, 'الوردية غير موجودة');
      if (shift.status !== 'open') throw new HttpError(400, 'الوردية مغلقة بالفعل');
      const summary = shiftSummary(shift);
      const closing = Number((ctx.body || {}).closing_balance);
      const closingBalance = Number.isFinite(closing) ? closing : summary.expected_cash;
      db.run(
        `UPDATE shifts SET status='closed', closed_at=datetime('now','localtime'),
           closing_balance=?, expected_cash=?, notes = COALESCE(?, notes) WHERE id = ?`,
        [closingBalance, summary.expected_cash, (ctx.body || {}).notes || null, shift.id]
      );
      db.logActivity(ctx.user.id, 'shift_close', 'shifts', shift.id, { closingBalance, expected: summary.expected_cash });
      sendJson(ctx.res, 200, { shift: shiftSummary(db.get('SELECT * FROM shifts WHERE id = ?', [shift.id])) });
    });
  },
};
