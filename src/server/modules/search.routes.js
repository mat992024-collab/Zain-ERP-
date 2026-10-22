const db = require('../db');
const { sendJson } = require('../core/http');

module.exports = {
  register(router) {
    router.get('/api/search', (ctx) => {
      const q = String(ctx.query.q || '').trim();
      if (!q) {
        sendJson(ctx.res, 200, { query: '', products: [], customers: [], suppliers: [], invoices: [], total: 0 });
        return;
      }
      const like = `%${q}%`;
      const products = db.all(
        `SELECT id, name, sku, barcode, category, unit, sale_price, cost_price, quantity
         FROM products
         WHERE is_active = 1 AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ? OR category LIKE ?)
         ORDER BY name LIMIT 6`,
        [like, like, like, like]
      );
      const customers = db.all(
        `SELECT id, name, phone, balance FROM customers
         WHERE name LIKE ? OR phone LIKE ? OR notes LIKE ?
         ORDER BY name LIMIT 6`,
        [like, like, like]
      );
      const suppliers = db.all(
        `SELECT id, name, phone, balance FROM suppliers
         WHERE name LIKE ? OR phone LIKE ? OR notes LIKE ?
         ORDER BY name LIMIT 6`,
        [like, like, like]
      );
      const invoices = db.all(
        `SELECT i.id, i.invoice_no, i.type, i.total, i.due, i.created_at,
                COALESCE(c.name, s.name, 'عميل نقدي') AS partner
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN suppliers s ON s.id = i.supplier_id
         WHERE i.invoice_no LIKE ? OR i.notes LIKE ?
         ORDER BY i.id DESC LIMIT 6`,
        [like, like]
      );
      sendJson(ctx.res, 200, {
        query: q,
        products,
        customers,
        suppliers,
        invoices,
        total: products.length + customers.length + suppliers.length + invoices.length,
      });
    });
  },
};
