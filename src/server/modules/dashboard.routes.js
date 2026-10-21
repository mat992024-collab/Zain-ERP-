const db = require('../db');
const { sendJson } = require('../core/http');
const ledger = require('../core/ledger');

module.exports = {
  register(router) {
    router.get('/api/dashboard/overview', (ctx) => {
      const today = "date('now','localtime')";
      const month = "date('now','localtime','start of month')";
      const salesToday = db.get(
        `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM invoices WHERE type='sale' AND date(created_at) = ${today}`
      );
      const salesMonth = db.get(
        `SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE type='sale' AND date(created_at) >= ${month}`
      );
      const low = db.get('SELECT COUNT(*) AS c FROM products WHERE quantity <= reorder_level AND is_active = 1').c;
      const customers = db.get('SELECT COUNT(*) AS c FROM customers WHERE is_active = 1').c;
      const suppliers = db.get('SELECT COUNT(*) AS c FROM suppliers WHERE is_active = 1').c;
      const stockValue = db.get(
        `SELECT COALESCE(SUM(quantity * cost_price),0) AS value FROM products WHERE is_active = 1`
      );
      const debtors = db.get('SELECT COALESCE(SUM(balance),0) AS total FROM customers WHERE balance > 0').total;
      const creditors = db.get('SELECT COALESCE(SUM(balance),0) AS total FROM suppliers WHERE balance > 0').total;
      const expenses = db.get(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date(created_at) = ${today}`).total;
      const cashBalance = ledger.currentTreasuryBalance();
      const recent = db.all(
        `SELECT i.id, i.invoice_no, i.total, i.type, i.payment_method, i.created_at, c.name AS customer_name
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
         ORDER BY i.id DESC LIMIT 10`
      );
      const charts = db.all(
        `SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total FROM invoices
         WHERE type='sale' AND date(created_at) >= date('now','localtime','-6 days')
         GROUP BY day ORDER BY day`
      );
      sendJson(ctx.res, 200, {
        sales_today: salesToday.total, sales_today_count: salesToday.count,
        sales_month: salesMonth.total, low_stock: low, customers, suppliers,
        stock_value: stockValue.value, debtors, creditors, expenses_today: expenses,
        cash_balance: cashBalance, recent, charts,
      });
    });
  },
};
