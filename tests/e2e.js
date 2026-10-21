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

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
