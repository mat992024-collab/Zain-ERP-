const db = require('./db');
db.init();
db.conn().exec(`
  DELETE FROM invoice_items;
  DELETE FROM invoices;
  DELETE FROM stock_movements;
  DELETE FROM expenses;
  DELETE FROM treasury;
  DELETE FROM installments;
  DELETE FROM installment_payments;
  DELETE FROM account_entries;
  DELETE FROM ai_predictions;
  DELETE FROM ai_insights;
  DELETE FROM activity_log;
  DELETE FROM shifts;
`);
db.conn().exec(`DELETE FROM products; DELETE FROM customers; DELETE FROM suppliers; DELETE FROM partners;`);
console.log('Reset done');
process.exit(0);
