const db = require('../db');
const { sendJson } = require('../core/http');
const ledger = require('../core/ledger');

module.exports = {
  register(router) {
    router.get('/api/dashboard/overview', (ctx) => {
      const selectedBranch = ctx.query.branch || '';
      const isAll = !selectedBranch || selectedBranch === 'all' || selectedBranch === 'الكل';
      const branchClause = isAll ? '' : 'AND branch = ?';
      const branchParams = isAll ? [] : [selectedBranch];

      const today = "date('now','localtime')";
      const month = "date('now','localtime','start of month')";

      const salesToday = db.get(
        `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count 
         FROM invoices 
         WHERE type='sale' AND date(created_at) = ${today} ${branchClause}`,
        branchParams
      );

      const salesMonth = db.get(
        `SELECT COALESCE(SUM(total),0) AS total 
         FROM invoices 
         WHERE type='sale' AND date(created_at) >= ${month} ${branchClause}`,
        branchParams
      );

      const profitToday = db.get(
        `SELECT COALESCE(SUM(ii.total - (ii.qty * ii.cost_price)), 0) AS profit
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         WHERE i.type='sale' AND date(i.created_at) = ${today} ${isAll ? '' : 'AND i.branch = ?'}`,
        branchParams
      ).profit;

      const low = db.get('SELECT COUNT(*) AS c FROM products WHERE quantity <= reorder_level AND is_active = 1').c;
      const customers = db.get('SELECT COUNT(*) AS c FROM customers WHERE is_active = 1').c;
      const suppliers = db.get('SELECT COUNT(*) AS c FROM suppliers WHERE is_active = 1').c;
      const stockValue = db.get('SELECT COALESCE(SUM(quantity * cost_price),0) AS value FROM products WHERE is_active = 1').value;
      const debtors = db.get('SELECT COALESCE(SUM(balance),0) AS total FROM customers WHERE balance > 0').total;
      const creditors = db.get('SELECT COALESCE(SUM(balance),0) AS total FROM suppliers WHERE balance > 0').total;

      const expenses = db.get(
        `SELECT COALESCE(SUM(amount),0) AS total 
         FROM expenses 
         WHERE date(created_at) = ${today}`
      ).total;

      const cashBalance = ledger.currentTreasuryBalance();

      const recent = db.all(
        `SELECT i.id, i.invoice_no, i.total, i.type, i.payment_method, i.created_at, i.branch, c.name AS customer_name
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
         ${isAll ? '' : 'WHERE i.branch = ?'}
         ORDER BY i.id DESC LIMIT 10`,
        branchParams
      );

      const charts = db.all(
        `SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total 
         FROM invoices
         WHERE type='sale' AND date(created_at) >= date('now','localtime','-6 days') ${branchClause}
         GROUP BY day ORDER BY day`,
        branchParams
      );

      const allBranches = db.all('SELECT * FROM branches WHERE is_active = 1 ORDER BY id ASC');

      const branchesSummary = allBranches.map((b) => {
        const bSalesToday = db.get(
          `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count 
           FROM invoices WHERE type='sale' AND date(created_at) = ${today} AND branch = ?`,
          [b.name]
        );
        const bProfitToday = db.get(
          `SELECT COALESCE(SUM(ii.total - (ii.qty * ii.cost_price)), 0) AS profit
           FROM invoice_items ii
           JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.type='sale' AND date(i.created_at) = ${today} AND i.branch = ?`,
          [b.name]
        ).profit;
        const bSalesMonth = db.get(
          `SELECT COALESCE(SUM(total),0) AS total 
           FROM invoices WHERE type='sale' AND date(created_at) >= ${month} AND branch = ?`,
          [b.name]
        ).total;
        const bWorkOrders = db.get(
          `SELECT 
             COUNT(*) AS total,
             SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
             SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) AS ready,
             SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered
           FROM work_orders WHERE branch_name = ?`,
          [b.name]
        );
        const topProducts = db.all(
          `SELECT ii.name, SUM(ii.qty) AS total_qty, SUM(ii.total) AS total_sales
           FROM invoice_items ii
           JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.type='sale' AND i.branch = ?
           GROUP BY ii.name
           ORDER BY total_sales DESC LIMIT 5`,
          [b.name]
        );

        return {
          id: b.id,
          code: b.code,
          name: b.name,
          sales_today: bSalesToday.total,
          sales_today_count: bSalesToday.count,
          profit_today: bProfitToday,
          sales_month: bSalesMonth,
          work_orders: bWorkOrders,
          top_products: topProducts
        };
      });

      const woSummary = db.get(
        `SELECT 
           COUNT(*) AS total,
           SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) AS ready,
           SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
           SUM(CASE WHEN priority IN ('urgent','high') AND status IN ('in_progress','ready') THEN 1 ELSE 0 END) AS urgent
         FROM work_orders ${isAll ? '' : 'WHERE branch_name = ?'}`,
        branchParams
      );

      sendJson(ctx.res, 200, {
        sales_today: salesToday.total,
        sales_today_count: salesToday.count,
        sales_month: salesMonth.total,
        profit_today: profitToday,
        low_stock: low,
        customers,
        suppliers,
        stock_value: stockValue,
        debtors,
        creditors,
        expenses_today: expenses,
        cash_balance: cashBalance,
        recent,
        charts,
        branches: branchesSummary,
        work_orders_summary: woSummary,
        selected_branch: selectedBranch || 'all'
      });
    });
  },
};
