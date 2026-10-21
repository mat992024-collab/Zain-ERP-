const db = require('./db');

async function seed() {
  db.init();
  db.tx(() => {
    for (let i = 1; i <= 15; i++) {
      const name = `صنف تجريبي ${i}`;
      db.run(
        `INSERT INTO products (name, barcode, category, cost_price, sale_price, quantity, reorder_level, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, `ZAIN900${String(i).padStart(3, '0')}`, 'عام', 300 + i * 10, 500 + i * 15, 40 - i, 5, 'قطعة']
      );
    }
    db.run(`INSERT INTO customers (name, phone, type) VALUES (?, ?, ?)`, ['عميل نقدي', '0000', 'retail']);
    db.run(`INSERT INTO suppliers (name, phone) VALUES (?, ?)`, ['مورد عام', '0000']);
  });
  console.log('Seed completed. Products:', db.get('SELECT COUNT(*) c FROM products').c);
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
