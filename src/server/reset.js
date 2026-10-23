const db = require('./db');
const fs = require('node:fs');
const path = require('node:path');
db.init();
db.conn().exec(`
  DELETE FROM invoice_items;
  DELETE FROM invoice_payments;
  DELETE FROM invoices;
  DELETE FROM stock_movements;
  DELETE FROM expenses;
  DELETE FROM treasury;
  DELETE FROM installments;
  DELETE FROM installment_payments;
  DELETE FROM scheduled_invoices;
  DELETE FROM account_entries;
  DELETE FROM ai_predictions;
  DELETE FROM ai_insights;
  DELETE FROM activity_log;
  DELETE FROM shifts;
`);
db.conn().exec(`DELETE FROM products; DELETE FROM customers; DELETE FROM suppliers; DELETE FROM partners;`);
if (fs.existsSync(db.IMAGES_DIR)) {
  for (const f of fs.readdirSync(db.IMAGES_DIR)) {
    try { fs.unlinkSync(path.join(db.IMAGES_DIR, f)); } catch { }
  }
}
console.log('Reset done');
process.exit(0);
