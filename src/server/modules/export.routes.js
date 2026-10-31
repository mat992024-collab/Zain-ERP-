const db = require('../db');
const { toCsv, sendCsv, dateFilter } = require('../core/csv');
const { HttpError } = require('../core/http');

const ENTITIES = {
  sales: {
    perm: 'sales.write',
    label: 'فواتير البيع',
    build(query) {
      const f = dateFilter(query, 'i.created_at');
      const allowed = ['sale', 'return_sale', 'purchase', 'return_purchase'];
      const type = allowed.includes(query.type) ? query.type : 'sale';
      return {
        sql: `SELECT i.invoice_no, i.created_at, i.pos_mode, COALESCE(c.name, 'عميل نقدي') AS customer,
                     i.subtotal, i.discount, i.tax, i.total, i.paid, i.due, i.payment_method, i.status
              FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
              WHERE i.type = ? ${f.clauses.length ? 'AND ' + f.clauses.join(' AND ') : ''}
              ORDER BY i.id DESC`,
        params: [type, ...f.params],
        columns: [
          { label: 'رقم الفاتورة', key: 'invoice_no' },
          { label: 'التاريخ', key: 'created_at' },
          { label: 'نوع البيع', key: 'pos_mode' },
          { label: 'العميل', key: 'customer' },
          { label: 'المجموع قبل الخصم', key: 'subtotal' },
          { label: 'الخصم', key: 'discount' },
          { label: 'الضريبة', key: 'tax' },
          { label: 'الإجمالي', key: 'total' },
          { label: 'المدفوع', key: 'paid' },
          { label: 'المتبقي', key: 'due' },
          { label: 'طريقة الدفع', key: 'payment_method' },
          { label: 'الحالة', key: 'status' },
        ],
      };
    },
  },
  purchases: {
    perm: 'purchases.write',
    label: 'فواتير الشراء',
    build(query) {
      const f = dateFilter(query, 'i.created_at');
      return {
        sql: `SELECT i.invoice_no, i.created_at, COALESCE(s.name, 'مورد') AS supplier,
                     i.subtotal, i.discount, i.tax, i.total, i.paid, i.due, i.payment_method, i.status
              FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id
              WHERE i.type = 'purchase' ${f.clauses.length ? 'AND ' + f.clauses.join(' AND ') : ''}
              ORDER BY i.id DESC`,
        params: f.params,
        columns: [
          { label: 'رقم الفاتورة', key: 'invoice_no' },
          { label: 'التاريخ', key: 'created_at' },
          { label: 'المورد', key: 'supplier' },
          { label: 'المجموع قبل الخصم', key: 'subtotal' },
          { label: 'الخصم', key: 'discount' },
          { label: 'الضريبة', key: 'tax' },
          { label: 'الإجمالي', key: 'total' },
          { label: 'المدفوع', key: 'paid' },
          { label: 'المتبقي', key: 'due' },
          { label: 'طريقة الدفع', key: 'payment_method' },
          { label: 'الحالة', key: 'status' },
        ],
      };
    },
  },
  products: {
    perm: 'inventory.write',
    label: 'الأصناف',
    build() {
      return {
        sql: `SELECT p.sku, p.barcode, p.name, p.category, p.brand, p.unit, p.cost_price, p.sale_price,
                     p.wholesale_price, p.quantity, p.reorder_level, p.tax_rate, p.is_active, p.created_at
              FROM products p ORDER BY p.id DESC`,
        params: [],
        columns: [
          { label: 'الرمز', key: 'sku' },
          { label: 'الباركود', key: 'barcode' },
          { label: 'الاسم', key: 'name' },
          { label: 'الصنف', key: 'category' },
          { label: 'العلامة', key: 'brand' },
          { label: 'الوحدة', key: 'unit' },
          { label: 'سعر الشراء', key: 'cost_price' },
          { label: 'سعر البيع', key: 'sale_price' },
          { label: 'سعر الجملة', key: 'wholesale_price' },
          { label: 'الكمية', key: 'quantity' },
          { label: 'حد التنبيه', key: 'reorder_level' },
          { label: 'نسبة الضريبة', key: 'tax_rate' },
          { label: 'نشط', key: 'is_active', value: (r) => (r.is_active ? 'نعم' : 'لا') },
          { label: 'تاريخ الإضافة', key: 'created_at' },
        ],
      };
    },
  },
  customers: {
    perm: 'customers.write',
    label: 'العملاء',
    build() {
      return {
        sql: `SELECT name, phone, email, address, type, balance, credit_limit, notes, is_active, created_at
              FROM customers ORDER BY id DESC`,
        params: [],
        columns: [
          { label: 'الاسم', key: 'name' },
          { label: 'الهاتف', key: 'phone' },
          { label: 'البريد', key: 'email' },
          { label: 'العنوان', key: 'address' },
          { label: 'النوع', key: 'type' },
          { label: 'الرصيد', key: 'balance' },
          { label: 'حد الائتمان', key: 'credit_limit' },
          { label: 'ملاحظات', key: 'notes' },
          { label: 'نشط', key: 'is_active', value: (r) => (r.is_active ? 'نعم' : 'لا') },
          { label: 'تاريخ الإضافة', key: 'created_at' },
        ],
      };
    },
  },
  suppliers: {
    perm: 'suppliers.write',
    label: 'الموردون',
    build() {
      return {
        sql: `SELECT name, company, phone, email, address, balance, notes, is_active, created_at
              FROM suppliers ORDER BY id DESC`,
        params: [],
        columns: [
          { label: 'الاسم', key: 'name' },
          { label: 'الشركة', key: 'company' },
          { label: 'الهاتف', key: 'phone' },
          { label: 'البريد', key: 'email' },
          { label: 'العنوان', key: 'address' },
          { label: 'الرصيد', key: 'balance' },
          { label: 'ملاحظات', key: 'notes' },
          { label: 'نشط', key: 'is_active', value: (r) => (r.is_active ? 'نعم' : 'لا') },
          { label: 'تاريخ الإضافة', key: 'created_at' },
        ],
      };
    },
  },
  expenses: {
    perm: 'accounting.write',
    label: 'المصروفات',
    build(query) {
      const f = dateFilter(query, 'e.date');
      return {
        sql: `SELECT e.date, e.category, e.description, e.amount, e.payment_method, e.created_at
              FROM expenses e ${f.clauses.length ? 'WHERE ' + f.clauses.join(' AND ') : ''} ORDER BY e.id DESC`,
        params: f.params,
        columns: [
          { label: 'التاريخ', key: 'date' },
          { label: 'التصنيف', key: 'category' },
          { label: 'الوصف', key: 'description' },
          { label: 'المبلغ', key: 'amount' },
          { label: 'طريقة الدفع', key: 'payment_method' },
          { label: 'وقت التسجيل', key: 'created_at' },
        ],
      };
    },
  },
  accounts: {
    perm: 'accounting.write',
    label: 'الحسابات',
    build() {
      return {
        sql: `SELECT a.code, a.name, a.type, a.balance, a.is_system, a.created_at
              FROM accounts a ORDER BY a.code`,
        params: [],
        columns: [
          { label: 'الرمز', key: 'code' },
          { label: 'اسم الحساب', key: 'name' },
          { label: 'النوع', key: 'type' },
          { label: 'الرصيد', key: 'balance' },
          { label: 'نظامي', key: 'is_system', value: (r) => (r.is_system ? 'نعم' : 'لا') },
          { label: 'تاريخ الإنشاء', key: 'created_at' },
        ],
      };
    },
  },
  shifts: {
    perm: 'pos.shift',
    label: 'الورديات',
    build(query) {
      const f = dateFilter(query, 's.opened_at');
      return {
        sql: `SELECT s.branch, s.opened_at, s.closed_at, s.opening_balance, s.total_sales, s.total_cash,
                     s.total_card, s.total_credit, s.closing_balance, s.expected_cash, s.status
              FROM shifts s ${f.clauses.length ? 'WHERE ' + f.clauses.join(' AND ') : ''} ORDER BY s.id DESC`,
        params: f.params,
        columns: [
          { label: 'الفرع', key: 'branch' },
          { label: 'وقت الفتح', key: 'opened_at' },
          { label: 'وقت الإغلاق', key: 'closed_at' },
          { label: 'رصيد افتتاحي', key: 'opening_balance' },
          { label: 'إجمالي المبيعات', key: 'total_sales' },
          { label: 'نقدي', key: 'total_cash' },
          { label: 'بطاقة', key: 'total_card' },
          { label: 'آجل', key: 'total_credit' },
          { label: 'رصيد ختامي', key: 'closing_balance' },
          { label: 'النقد المتوقع', key: 'expected_cash' },
          { label: 'الحالة', key: 'status' },
        ],
      };
    },
  },
  treasury: {
    perm: 'accounting.write',
    label: 'حركة الخزنة',
    build(query) {
      const f = dateFilter(query, 't.created_at');
      return {
        sql: `SELECT t.created_at, t.direction, t.amount, t.source, t.description, t.balance_after
              FROM treasury t ${f.clauses.length ? 'WHERE ' + f.clauses.join(' AND ') : ''} ORDER BY t.id DESC`,
        params: f.params,
        columns: [
          { label: 'التاريخ', key: 'created_at' },
          { label: 'النوع', key: 'direction', value: (r) => (r.direction === 'in' ? 'إدخال' : 'إخراج') },
          { label: 'المبلغ', key: 'amount' },
          { label: 'المصدر', key: 'source' },
          { label: 'الوصف', key: 'description' },
          { label: 'الرصيد بعدها', key: 'balance_after' },
        ],
      };
    },
  },
  activity: {
    perm: 'admin.users',
    perms: ['activity.view', 'admin.users'],
    label: 'سجل النشاط',
    build(query) {
      const f = dateFilter(query, 'l.created_at');
      return {
        sql: `SELECT l.created_at, u.username, l.action, l.entity, l.entity_id, l.details
              FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
              ${f.clauses.length ? 'WHERE ' + f.clauses.join(' AND ') : ''} ORDER BY l.id DESC`,
        params: f.params,
        columns: [
          { label: 'التاريخ', key: 'created_at' },
          { label: 'المستخدم', key: 'username' },
          { label: 'الإجراء', key: 'action' },
          { label: 'الكيان', key: 'entity' },
          { label: 'رقم السجل', key: 'entity_id' },
          { label: 'التفاصيل', key: 'details' },
        ],
      };
    },
  },
};

function fileName(label) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${label}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
}

module.exports = {
  register(router) {
    router.get('/api/export/:entity', (ctx) => {
      const entity = ENTITIES[ctx.params.entity];
      if (!entity) {
        ctx.res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        ctx.res.end(JSON.stringify({ error: 'نوع التصدير غير معروف' }));
        return;
      }
      const perms = entity.perms || [entity.perm];
      if (!perms.some((p) => ctx.can(p))) throw new HttpError(403, 'لا تملك صلاحية تنفيذ هذه العملية');
      const { sql, params, columns } = entity.build(ctx.query);
      const rows = db.all(sql, params);
      db.logActivity(ctx.user.id, 'export', ctx.params.entity, null, { rows: rows.length });
      sendCsv(ctx.res, fileName(entity.label), toCsv(rows, columns));
    });

    router.get('/api/export', (ctx) => {
      ctx.res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      ctx.res.end(JSON.stringify({
        entities: Object.entries(ENTITIES).map(([key, e]) => ({ key, label: e.label })),
      }));
    });

    router.get('/api/export-json', (ctx) => {
      if (!ctx.user || (ctx.user.role !== 'admin' && !ctx.can('admin.users'))) {
        throw new HttpError(403, 'لا تملك صلاحية التصدير الشامل');
      }
      const payload = {
        version: 1,
        exported_at: new Date().toISOString(),
        settings: db.getSettings(),
        products: db.all('SELECT * FROM products'),
        customers: db.all('SELECT * FROM customers'),
        suppliers: db.all('SELECT * FROM suppliers'),
        accounts: db.all('SELECT * FROM accounts'),
      };
      db.logActivity(ctx.user.id, 'export', 'system_json', null, { products: payload.products.length });
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="zain-backup-${Date.now()}.json"`,
      });
      ctx.res.end(JSON.stringify(payload, null, 2));
    });

    router.post('/api/import-json', (ctx) => {
      if (!ctx.user || ctx.user.role !== 'admin') {
        throw new HttpError(403, 'يتطلب استيراد JSON صلاحية المدير');
      }
      const body = ctx.body || {};
      let imported = 0;
      if (Array.isArray(body.products)) {
        for (const p of body.products) {
          if (!p || !p.name) continue;
          const existing = (p.barcode ? db.get('SELECT id FROM products WHERE barcode = ?', [p.barcode]) : null) ||
                           (p.sku ? db.get('SELECT id FROM products WHERE sku = ?', [p.sku]) : null) ||
                           db.get('SELECT id FROM products WHERE name = ?', [p.name]);
          if (existing) {
            db.run('UPDATE products SET cost_price = ?, sale_price = ?, wholesale_price = ?, quantity = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
              [Number(p.cost_price) || 0, Number(p.sale_price) || 0, Number(p.wholesale_price) || 0, Number(p.quantity) || 0, existing.id]);
          } else {
            db.run(`INSERT INTO products (name, barcode, sku, package_size, category, unit, cost_price, sale_price, wholesale_price, quantity, reorder_level, shelf_location, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
              [p.name, p.barcode || null, p.sku || null, p.package_size || null, p.category || 'عام', p.unit || 'قطعة', Number(p.cost_price) || 0, Number(p.sale_price) || 0, Number(p.wholesale_price) || 0, Number(p.quantity) || 0, Number(p.reorder_level) || 5, p.shelf_location || null]);
          }
          imported++;
        }
      }
      if (Array.isArray(body.customers)) {
        for (const c of body.customers) {
          if (!c || !c.name) continue;
          const existing = db.get('SELECT id FROM customers WHERE name = ? OR (phone IS NOT NULL AND phone = ?)', [c.name, c.phone || '']);
          if (!existing) {
            db.run('INSERT INTO customers (name, phone, address, created_at) VALUES (?, ?, ?, datetime(\'now\',\'localtime\'))', [c.name, c.phone || null, c.address || null]);
          }
        }
      }
      if (Array.isArray(body.suppliers)) {
        for (const s of body.suppliers) {
          if (!s || !s.name) continue;
          const existing = db.get('SELECT id FROM suppliers WHERE name = ? OR (phone IS NOT NULL AND phone = ?)', [s.name, s.phone || '']);
          if (!existing) {
            db.run('INSERT INTO suppliers (name, phone, address, created_at) VALUES (?, ?, ?, datetime(\'now\',\'localtime\'))', [s.name, s.phone || null, s.address || null]);
          }
        }
      }
      db.logActivity(ctx.user.id, 'import', 'system_json', null, { imported });
      ctx.res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      ctx.res.end(JSON.stringify({ ok: true, imported }));
    });
  },
};
