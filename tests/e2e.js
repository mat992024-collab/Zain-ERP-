process.env.ZAIN_DB = require('node:path').join(__dirname, '..', 'data', 'e2e.db');
const fs = require('node:fs');
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.ZAIN_DB + s); } catch {} }

const { start } = require('../src/server/index.js');

(async () => {
  const { server, port } = await start(4202);
  const base = `http://127.0.0.1:${port}`;
  const raw = (path, opts = {}) => fetch(base + path, opts);
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data, ct };
  };
  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    if (cond) pass++; else fail++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  };

  let r = await raw('/');
  ok('GET / serves index.html', r.status === 200 && (await r.text()).includes('Zain'), String(r.status));
  r = await raw('/js/main.js');
  ok('GET /js/main.js', r.status === 200, String(r.status));
  r = await raw('/assets/app.css');
  const css = await r.text();
  ok('GET /assets/app.css has zain theme', r.status === 200 && css.length > 5000, String(css.length));
  r = await raw('/styles.css');
  ok('GET /styles.css', r.status === 200, String(r.status));
  r = await raw('/assets/vendor/bootstrap-icons.min.css');
  ok('GET vendor bootstrap-icons css', r.status === 200, String(r.status));
  r = await raw('/assets/vendor/fonts/bootstrap-icons.woff2');
  ok('GET vendor bootstrap-icons woff2', r.status === 200, String(r.status));
  r = await raw('/assets/vendor/cairo.css');
  ok('GET vendor cairo css', r.status === 200, String(r.status));
  r = await raw('/assets/vendor/fonts/cairo-arabic.woff2');
  ok('GET vendor cairo arabic woff2', r.status === 200, String(r.status));

  r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
  const token = r.data.token;
  ok('login', r.status === 200 && !!token);

  r = await call('POST', '/api/products', { name: 'لابتوب Lenovo', category: 'إلكترونيات', barcode: 'B100', sale_price: 500000, cost_price: 400000, quantity: 20, reorder_level: 3, part_number: 'LN-01' }, token);
  const pid = r.data.product.id;
  ok('create product', r.status === 201);

  r = await call('POST', '/api/customers', { name: 'شركة الأمل', type: 'wholesale', phone: '077' }, token);
  const cid = r.data.customer.id;
  ok('create customer', r.status === 201);

  r = await call('POST', '/api/sales', { items: [{ product_id: pid, qty: 2, unit_price: 500000 }], customer_id: cid, payment_method: 'credit', paid: 0, installment_plan: { count: 3, due_date: '2026-12-01' } }, token);
  ok('sale on credit', r.status === 201, 'due=' + r.data.invoice.due);

  r = await call('GET', `/api/customers/${cid}`, null, token);
  ok('customer balance updated', Number(r.data.customer.balance) === 1000000, String(r.data.customer.balance));

  r = await call('GET', '/api/installments', null, token);
  ok('installment created', r.status === 200 && r.data.rows.length === 1, 'remaining=' + r.data.rows[0].remaining);
  const iid = r.data.rows[0].id;

  r = await call('POST', `/api/installments/${iid}/pay`, { amount: 300000 }, token);
  ok('installment payment', r.status === 200 && r.data.installment.remaining === 700000, String(r.data.installment && r.data.installment.remaining));

  r = await call('GET', `/api/print/thermal/${1}?width=80`, null, token);
  ok('thermal receipt HTML', r.status === 200 && String(r.data).includes('<!DOCTYPE html>'), String(r.status));
  r = await call('GET', `/api/print/a4/${1}`, null, token);
  ok('A4 invoice HTML', r.status === 200 && String(r.data).includes('فاتورة'), String(r.status));
  r = await call('POST', '/api/print/labels', { items: [{ product_id: pid, qty: 2 }], repeats: 2 }, token);
  ok('barcode labels HTML (svg)', r.status === 200 && String(r.data).includes('<svg') && String(r.data).includes('rect'), String(r.status));
  r = await call('GET', `/api/print/barcode/${pid}`, null, token);
  ok('barcode svg endpoint', r.status === 200 && r.data.svg.includes('svg'));

  r = await call('POST', '/api/sales', { items: [{ product_id: pid, qty: 2, unit_price: 500000 }], payment_method: 'cash', paid: 1000000 }, token);
  ok('cash sale', r.status === 201);
  r = await call('GET', `/api/products/${pid}`, null, token);
  ok('stock decremented 20-4=16', r.data.product.quantity === 16, String(r.data.product.quantity));

  r = await call('POST', '/api/users', { username: 'cashier1', full_name: 'كاشير', password: '1234', role: 'cashier', permissions: ['pos.*', 'products.read'] }, token);
  ok('create cashier', r.status === 201);
  r = await call('POST', '/api/auth/login', { username: 'cashier1', password: '1234' });
  const cashierToken = r.data.token;
  ok('cashier login', r.status === 200);
  r = await call('POST', '/api/users', { username: 'x', full_name: 'x', password: 'x' }, cashierToken);
  ok('cashier cannot create users (403)', r.status === 403, String(r.status));
  r = await call('POST', '/api/sales', { items: [{ product_id: pid, qty: 1, unit_price: 500000 }], payment_method: 'cash', paid: 500000 }, cashierToken);
  ok('cashier can sell (pos.*)', r.status === 201, String(r.status));

  r = await call('GET', '/api/reports/trial-balance', null, token);
  const t = r.data.totals;
  ok('trial balance balanced', Math.abs(t.debit - t.credit) < 0.01, `${t.debit} / ${t.credit}`);

  r = await call('GET', '/api/ai/analysis', null, token);
  ok('ai analysis', r.status === 200 && Array.isArray(r.data.top));
  r = await call('GET', '/api/ai/suggestions', null, token);
  ok('ai suggestions', r.status === 200 && Array.isArray(r.data.suggestions));
  r = await call('GET', '/api/ai/forecast', null, token);
  ok('ai forecast', r.status === 200 && Array.isArray(r.data.list));

  r = await call('PUT', '/api/settings', { company_name: 'متجر النور', ai_enabled: true, printer_type: 'thermal80' }, token);
  ok('update settings', r.status === 200 && r.data.settings.company_name === 'متجر النور');
  r = await call('GET', '/api/settings', null, token);
  ok('settings persisted', r.data.settings.ai_enabled === '1', r.data.settings.ai_enabled);

  r = await call('POST', '/api/shifts/open', { opening_balance: 50000 }, token);
  const shiftId = r.data.shift.id;
  ok('shift open', r.status === 201);
  r = await call('POST', '/api/sales', { items: [{ product_id: pid, qty: 1, unit_price: 500000 }], payment_method: 'cash', paid: 500000, shift_id: shiftId }, token);
  ok('sale with shift', r.status === 201);
  r = await call('GET', '/api/shifts/current', null, token);
  ok('shift totals tracked', Number(r.data.shift.live_sales_total) === 500000, String(r.data.shift.live_sales_total));
  r = await call('POST', `/api/shifts/${shiftId}/close`, { closing_balance: 550000 }, token);
  ok('shift close', r.status === 200 && r.data.shift.status === 'closed');

  r = await call('GET', '/api/products/categories', null, token);
  ok('categories', r.status === 200 && r.data.categories.length >= 1);
  r = await call('POST', '/api/products/bulk-price', { category: 'إلكترونيات', field: 'sale_price', mode: 'percent', value: 10 }, token);
  ok('bulk price update', r.status === 200 && r.data.updated === 1, JSON.stringify(r.data));
  r = await call('GET', '/api/products/barcode/B100', null, token);
  ok('barcode lookup', r.status === 200 && r.data.product.name.includes('Lenovo'));

  r = await call('GET', '/api/sales?type=sale', null, token);
  ok('sales list', r.status === 200 && r.data.rows.length >= 4, String(r.data.rows.length));

  r = await call('POST', `/api/sales/1/return`, { items: [{ item_id: 1, qty: 1 }] }, token);
  ok('sales return', r.status === 201, String(r.status));

  r = await call('GET', '/api/accounts', null, token);
  ok('accounts tree', r.status === 200 && r.data.accounts.length >= 13);

  r = await call('GET', '/api/export', null, token);
  ok('export catalog', r.status === 200 && r.data.entities.length >= 8, String(r.data.entities && r.data.entities.length));
  r = await call('GET', '/api/export/sales', null, token);
  const csvRes = await fetch(base + '/api/export/sales', { headers: { Authorization: 'Bearer ' + token } });
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());
  const csv = csvBuf.toString('utf8');
  ok('export sales CSV', csvRes.status === 200 && csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF && csv.includes('رقم الفاتورة') && csv.includes('الإجمالي'), csvRes.status);
  ok('export CSV headers', (csvRes.headers.get('content-type') || '').includes('text/csv') && (csvRes.headers.get('content-disposition') || '').includes('attachment') && csv.split('\r\n').length > 3, csvRes.headers.get('content-type'));
  r = await call('GET', '/api/export/products', null, token);
  ok('export products CSV', r.status === 200 && String(r.data).includes('سعر البيع'), r.status);
  r = await call('GET', '/api/export/customers', null, token);
  ok('export customers CSV', r.status === 200 && String(r.data).includes('شركة الأمل'), r.status);
  r = await call('GET', '/api/export/accounts', null, token);
  ok('export accounts CSV', r.status === 200 && String(r.data).includes('اسم الحساب'), r.status);
  r = await call('GET', '/api/export/expenses', null, token);
  ok('export expenses CSV', r.status === 200, r.status);
  r = await call('GET', '/api/export/nope', null, token);
  ok('export unknown entity (404)', r.status === 404, String(r.status));
  r = await call('GET', '/api/export/sales', null, cashierToken);
  ok('export denied without permission (403)', r.status === 403, String(r.status));

  r = await call('PUT', `/api/customers/${cid}`, { name: 'شركة الأمل', type: 'wholesale', phone: '077', credit_limit: 500000 }, token);
  ok('customer credit limit set', r.status === 200 && Number(r.data.customer.credit_limit) === 500000, String(r.data.customer && r.data.customer.credit_limit));
  r = await call('POST', '/api/sales', { items: [{ product_id: pid, qty: 1, unit_price: 500000 }], customer_id: cid, payment_method: 'credit', paid: 0 }, token);
  ok('credit limit warn mode (409)', r.status === 409 && r.data.code === 'CREDIT_LIMIT', `${r.status} ${r.data.code}`);
  ok('credit limit details', r.data.details && Number(r.data.details.limit) === 500000, JSON.stringify(r.data.details));
  r = await call('POST', '/api/sales', { items: [{ product_id: pid, qty: 1, unit_price: 500000 }], customer_id: cid, payment_method: 'credit', paid: 0, force_credit_limit: true }, token);
  ok('credit limit override (201)', r.status === 201, String(r.status));
  r = await call('PUT', '/api/settings', { credit_limit_mode: 'block' }, token);
  ok('credit limit mode saved', r.data.settings.credit_limit_mode === 'block', r.data.settings.credit_limit_mode);
  r = await call('POST', '/api/sales', { items: [{ product_id: pid, qty: 1, unit_price: 500000 }], customer_id: cid, payment_method: 'credit', paid: 0, force_credit_limit: true }, token);
  ok('credit limit block mode (400)', r.status === 400 && r.data.code === 'CREDIT_LIMIT', `${r.status} ${r.data.code}`);
  r = await call('PUT', '/api/settings', { credit_limit_mode: 'off' }, token);
  r = await call('POST', '/api/sales', { items: [{ product_id: pid, qty: 1, unit_price: 500000 }], customer_id: cid, payment_method: 'credit', paid: 0 }, token);
  ok('credit limit off mode (201)', r.status === 201, String(r.status));
  await call('PUT', '/api/settings', { credit_limit_mode: 'warn' }, token);

  r = await call('POST', '/api/products', { name: 'مطاط', category: 'متنوعات', sale_price: 1000, cost_price: 600, quantity: 50 }, token);
  const spid = r.data.product.id;
  r = await call('POST', '/api/suppliers', { name: 'مورد zachary', phone: '0750' }, token);
  const sid = r.data.supplier.id;
  ok('create supplier', r.status === 201);
  r = await call('POST', '/api/purchases', { supplier_id: sid, payment_method: 'credit', paid: 0, items: [{ product_id: spid, qty: 10, cost_price: 600, unit_price: 600 }] }, token);
  const purchaseId = r.data.invoice.id;
  ok('purchase invoice created', r.status === 201 && r.data.invoice.due === 6000, JSON.stringify(r.data.invoice && r.data.invoice.due));
  r = await call('GET', `/api/sales/${purchaseId}`, null, token);
  const purchaseItemId = r.data.items[0].id;
  r = await call('GET', `/api/products/${spid}`, null, token);
  ok('purchase increased stock', r.data.product.quantity === 60, String(r.data.product.quantity));
  r = await call('GET', `/api/suppliers/${sid}`, null, token);
  ok('supplier balance increased', Number(r.data.supplier.balance) === 6000, String(r.data.supplier.balance));
  r = await call('POST', `/api/purchases/${purchaseId}/return`, { items: [{ item_id: 999999, qty: 1 }] }, token);
  ok('purchase return rejects unknown item (400)', r.status === 400, String(r.status));
  r = await call('POST', `/api/purchases/${purchaseId}/return`, { items: [{ item_id: purchaseItemId, qty: 4 }] }, token);
  ok('purchase return created', r.status === 201 && r.data.invoice.type === 'return_purchase', `${r.status} ${r.data.invoice && r.data.invoice.type}`);
  r = await call('GET', `/api/products/${spid}`, null, token);
  ok('purchase return reduced stock', r.data.product.quantity === 56, String(r.data.product.quantity));
  r = await call('GET', `/api/suppliers/${sid}`, null, token);
  ok('purchase return reduced supplier balance', Math.abs(Number(r.data.supplier.balance) - 3600) < 0.01, String(r.data.supplier.balance));

  r = await call('GET', `/api/statements/customer/${cid}`, null, token);
  ok('customer statement', r.status === 200 && Array.isArray(r.data.rows), String(r.status));
  ok('statement closing equals balance', Math.abs(Number(r.data.totals.closing) - Number(r.data.party.balance)) < 0.01, `${r.data.totals && r.data.totals.closing} / ${r.data.party && r.data.party.balance}`);
  r = await call('GET', `/api/statements/supplier/${sid}`, null, token);
  ok('supplier statement', r.status === 200 && Array.isArray(r.data.rows), String(r.status));
  r = await call('GET', `/api/print/statement/customer/${cid}`, null, token);
  ok('statement print HTML', r.status === 200 && String(r.data).includes('كشف حساب'), String(r.status));

  r = await call('GET', '/api/reports/income-statement', null, token);
  ok('income statement', r.status === 200 && typeof r.data.gross_profit === 'number' && typeof r.data.net_profit === 'number', String(r.status));
  ok('income statement products', Array.isArray(r.data.top_products), JSON.stringify(r.data.top_products && r.data.top_products.length));
  r = await call('GET', '/api/sales?type=sale', null, token);
  ok('sales rows carry profit', r.data.rows.every((x) => typeof x.profit === 'number'), JSON.stringify(r.data.rows[0] && { p: r.data.rows[0].profit, c: r.data.rows[0].cost_total }));
  r = await call('GET', '/api/sales/1', null, token);
  ok('invoice detail carries profit', typeof r.data.invoice.profit === 'number' && typeof r.data.invoice.cost_total === 'number', JSON.stringify({ p: r.data.invoice.profit, c: r.data.invoice.cost_total }));

  r = await call('GET', '/api/backup', null, token);
  ok('backup list', r.status === 200 && Array.isArray(r.data.backups), r.status);
  r = await call('POST', '/api/backup', null, token);
  const backupName = r.data.backup && r.data.backup.name;
  ok('backup created', r.status === 201 && !!backupName && r.data.backup.size > 1000, JSON.stringify(r.data.backup));
  r = await call('GET', `/api/backup/${encodeURIComponent(backupName)}/download`, null, token);
  ok('backup download', r.status === 200 && String(r.data).length > 1000, r.status);
  r = await call('GET', '/api/backup', null, cashierToken);
  ok('backup denied without permission (403)', r.status === 403, String(r.status));
  r = await call('POST', '/api/backup/upload/restore', { data: Buffer.from('not a database').toString('base64') }, token);
  ok('restore rejects invalid file (400)', r.status === 400, String(r.status));

  r = await call('GET', '/api/products', null, token);
  const beforeRestore = r.data.total;
  r = await call('POST', `/api/backup/${encodeURIComponent(backupName)}/restore`, null, token);
  ok('backup restored', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
  r = await call('GET', '/api/products', null, token);
  ok('data intact after restore', r.data.total === beforeRestore, `${beforeRestore} -> ${r.data.total}`);
  r = await call('GET', '/api/auth/me', null, token);
  ok('session alive after restore', r.status === 200, String(r.status));
  r = await call('DELETE', `/api/backup/${encodeURIComponent(backupName)}`, null, token);
  ok('backup deleted', r.status === 200 && !r.data.backups.some((b) => b.name === backupName), JSON.stringify(r.data.backups.map((b) => b.name)));

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
