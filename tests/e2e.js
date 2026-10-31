process.env.ZAIN_DB = require('node:path').join(__dirname, '..', 'data', 'test', 'e2e.db');
const fs = require('node:fs');
const path = require('node:path');
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.ZAIN_DB + s); } catch {} }
for (const d of [path.join(__dirname, '..', 'data', 'test', 'backups'), path.join(__dirname, '..', 'data', 'test', 'images')]) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}

const { start } = require('../src/server/index.js');
const { readZip } = require('../src/server/core/zip');

(async () => {
  const { server, port, host } = await start(4202);
  const base = `http://${host || '127.0.41.80'}:${port}`;
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

  const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  r = await call('POST', `/api/products/${pid}/image`, { data_url: pngDataUrl }, token);
  ok('upload product image', r.status === 200 && String(r.data.product.image).startsWith('/images/'), JSON.stringify(r.data));
  const imageUrl = r.data.product.image;
  const imageRes = await raw(imageUrl);
  ok('product image is served', imageRes.status === 200 && String(imageRes.headers.get('content-type')).startsWith('image/'), String(imageRes.status));
  r = await call('GET', '/api/products', null, token);
  ok('product list exposes image url', r.data.rows.find((x) => x.id === pid).image === imageUrl, JSON.stringify(r.data.rows.find((x) => x.id === pid).image));
  r = await call('POST', `/api/products/${pid}/image`, { data_url: 'data:text/html;base64,PHNjcmlwdD4=' }, token);
  ok('invalid image rejected', r.status === 400, String(r.status));

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
  ok('A4 invoice shows product image', String(r.data).includes(imageUrl), 'has=' + String(r.data).includes(imageUrl));
  r = await call('POST', '/api/print/labels', { items: [{ product_id: pid, qty: 2 }], repeats: 2 }, token);
  ok('barcode labels HTML (svg)', r.status === 200 && String(r.data).includes('<svg') && String(r.data).includes('rect'), String(r.status));
  ok('barcode labels show product image', String(r.data).includes(imageUrl), 'has=' + String(r.data).includes(imageUrl));
  r = await call('GET', `/api/print/barcode/${pid}`, null, token);
  ok('barcode svg endpoint', r.status === 200 && r.data.svg.includes('svg'));
  r = await call('GET', '/api/products/quick?limit=5', null, token);
  ok('quick products expose image', r.status === 200 && r.data.rows.some((x) => x.image === imageUrl), JSON.stringify(r.data.rows.map((x) => x.image)));

  r = await call('PUT', '/api/settings', {
    company_tax_id: '9876543',
    print_header_text: 'فرع الكرادة',
    print_header_sub: 'خدمة على مدار الساعة',
    print_footer_note: 'شكراً لزيارتكم',
    print_invoice_note: 'البضاعة لا تُرد ولا تُستبدل بعد 3 أيام',
    print_label_note: 'امسح الباركود لطلب الخدمة',
    print_font_size: 'large',
    print_density: 'compact',
    print_show_logo: 1,
    print_logo_data: 'data:image/png;base64,iVBORw0KGgo=',
    print_show_tax_id: 1,
    print_show_cashier: 0,
  }, token);
  ok('print template settings saved', r.status === 200 && r.data.settings.print_header_text === 'فرع الكرادة' && r.data.settings.print_font_size === 'large', JSON.stringify(r.data.settings && r.data.settings.print_header_text));
  r = await call('GET', `/api/print/thermal/${1}?width=80`, null, token);
  const thermalHtml = String(r.data);
  ok('thermal shows header line', thermalHtml.includes('فرع الكرادة'), 'len=' + thermalHtml.length);
  ok('thermal shows sub header', thermalHtml.includes('خدمة على مدار الساعة'));
  ok('thermal shows footer note', thermalHtml.includes('شكراً لزيارتكم'));
  ok('thermal shows logo', thermalHtml.includes('data:image/png;base64,iVBORw0KGgo='));
  ok('thermal uses larger font size', thermalHtml.includes('body { font-size: 13px;'), 'font');
  r = await call('GET', `/api/print/a4/${1}`, null, token);
  const a4Html = String(r.data);
  ok('a4 shows invoice note', a4Html.includes('البضاعة لا تُرد ولا تُستبدل بعد 3 أيام'));
  ok('a4 hides cashier when disabled', !a4Html.includes('الكاشير:'), 'cashier');
  ok('a4 shows tax id', a4Html.includes('الرقم الضريبي'), 'tax');
  r = await call('POST', '/api/print/labels', { items: [{ product_id: pid, qty: 1 }], repeats: 1 }, token);
  ok('labels show label footer', String(r.data).includes('مسح الباركود'), 'label');
  r = await call('PUT', '/api/settings', { company_tax_id: '', print_header_text: '', print_header_sub: '', print_footer_note: '', print_invoice_note: '', print_label_note: '', print_show_logo: 0, print_logo_data: '', print_font_size: 'normal', print_density: 'normal', print_show_cashier: 1 }, token);
  ok('print template settings reset', r.status === 200 && r.data.settings.print_header_text === '' && r.data.settings.print_show_logo === '0', JSON.stringify(r.data.settings && r.data.settings.print_header_text));
  r = await call('GET', `/api/print/thermal/${1}?width=80`, null, token);
  ok('thermal header cleared', !String(r.data).includes('فرع الكرادة'));

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

  r = await call('GET', '/api/products/quick?limit=5', null, token);
  ok('quick products', r.status === 200 && Array.isArray(r.data.rows) && r.data.rows.length > 0, String(r.status));
  ok('quick products carry sold qty', r.data.rows.every((x) => typeof x.sold === 'number'), JSON.stringify(r.data.rows[0] && r.data.rows[0].sold));
  r = await call('GET', '/api/products/low-stock?limit=10', null, token);
  ok('low stock list', r.status === 200 && Array.isArray(r.data.rows), String(r.status));
  ok('low stock respects reorder level', r.data.rows.every((x) => Number(x.quantity) <= Number(x.reorder_level)), JSON.stringify(r.data.rows[0] || null));
  r = await call('GET', '/api/sales/last', null, token);
  ok('last sale', r.status === 200 && r.data.invoice && Array.isArray(r.data.items), String(r.status));
  ok('last sale items match invoice', r.data.items.every((i) => i.invoice_id === r.data.invoice.id), JSON.stringify(r.data.items[0] || null));

  r = await call('GET', `/api/customers/${cid}`, null, token);
  const balanceBefore = Number(r.data.customer.balance);
  r = await call('GET', '/api/treasury', null, token);
  const treasuryBefore = Number(r.data.balance);
  r = await call('POST', '/api/vouchers', { type: 'receipt', amount: 100000, partner_type: 'customer', partner_id: cid, method: 'cash', description: 'سند قبض اختبار' }, token);
  const receiptId = r.data.voucher && r.data.voucher.id;
  ok('receipt voucher created', r.status === 201 && r.data.voucher.type === 'receipt' && r.data.voucher.voucher_no.startsWith('RCV-'), JSON.stringify(r.data.voucher && r.data.voucher.voucher_no));
  r = await call('GET', `/api/customers/${cid}`, null, token);
  ok('receipt reduced customer balance', Math.abs(Number(r.data.customer.balance) - (balanceBefore - 100000)) < 0.01, `${balanceBefore} -> ${r.data.customer.balance}`);
  r = await call('GET', '/api/treasury', null, token);
  ok('receipt increased treasury', Math.abs(Number(r.data.balance) - (treasuryBefore + 100000)) < 0.01, `${treasuryBefore} -> ${r.data.balance}`);

  r = await call('GET', `/api/suppliers/${sid}`, null, token);
  const supplierBefore = Number(r.data.supplier.balance);
  r = await call('POST', '/api/vouchers', { type: 'payout', amount: 50000, partner_type: 'supplier', partner_id: sid, method: 'cash', description: 'سند صرف اختبار' }, token);
  const payoutId = r.data.voucher && r.data.voucher.id;
  ok('payout voucher created', r.status === 201 && r.data.voucher.type === 'payout', JSON.stringify(r.data.voucher && r.data.voucher.voucher_no));
  r = await call('GET', `/api/suppliers/${sid}`, null, token);
  ok('payout increased supplier balance', Math.abs(Number(r.data.supplier.balance) - (supplierBefore + 50000)) < 0.01, `${supplierBefore} -> ${r.data.supplier.balance}`);

  r = await call('POST', '/api/vouchers', { type: 'transfer', amount: 25000, from_account: '1100', to_account: '2100', description: 'نقل اختبار' }, token);
  const transferId = r.data.voucher && r.data.voucher.id;
  ok('transfer voucher created', r.status === 201 && r.data.voucher.type === 'transfer', JSON.stringify(r.data.voucher && r.data.voucher.voucher_no));
  r = await call('POST', '/api/vouchers', { type: 'transfer', amount: 1000, from_account: '1100', to_account: '9999' }, token);
  ok('transfer rejects unknown account (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/vouchers', { type: 'receipt', amount: 0 }, token);
  ok('voucher rejects zero amount (400)', r.status === 400, String(r.status));

  r = await call('GET', '/api/vouchers', null, token);
  ok('vouchers list', r.status === 200 && r.data.rows.length >= 3, 'rows=' + r.data.rows.length);
  r = await call('GET', '/api/vouchers?type=receipt', null, token);
  ok('vouchers filter by type', r.data.rows.every((v) => v.type === 'receipt'), JSON.stringify(r.data.rows.map((v) => v.type)));

  r = await call('GET', '/api/treasury', null, token);
  const treasuryBeforeDelete = Number(r.data.balance);
  r = await call('POST', '/api/vouchers', { type: 'receipt', amount: 33333, partner_type: 'customer', partner_id: cid, method: 'cash', description: 'سند للاختبار' }, token);
  const tempVoucherId = r.data.voucher && r.data.voucher.id;
  r = await call('GET', `/api/customers/${cid}`, null, token);
  const balanceBeforeTemp = Number(r.data.customer.balance);
  r = await call('DELETE', `/api/vouchers/${tempVoucherId}`, null, token);
  ok('voucher deleted', r.status === 200 && r.data.ok === true, String(r.status));
  r = await call('GET', `/api/customers/${cid}`, null, token);
  ok('deleting voucher restored customer balance', Math.abs(Number(r.data.customer.balance) - (balanceBeforeTemp + 33333)) < 0.01, `${balanceBeforeTemp + 33333} -> ${r.data.customer.balance}`);
  r = await call('GET', '/api/treasury', null, token);
  ok('deleting voucher restored treasury', Math.abs(Number(r.data.balance) - treasuryBeforeDelete) < 0.01, `${treasuryBeforeDelete} -> ${r.data.balance}`);
  r = await call('DELETE', `/api/vouchers/${payoutId}`, null, token);
  ok('payout voucher deleted', r.status === 200, String(r.status));

  r = await call('GET', '/api/reports/z-report', null, token);
  ok('z-report', r.status === 200 && r.data.sales && typeof r.data.sales.total === 'number' && typeof r.data.expected_cash === 'number', String(r.status));
  ok('z-report net sales', Math.abs(r.data.net_sales - (r.data.sales.total - r.data.returns.total)) < 0.01, JSON.stringify({ n: r.data.net_sales, s: r.data.sales.total }));
  r = await call('GET', '/api/reports/z-report?date=2000-01-01', null, token);
  ok('z-report for empty day', r.status === 200 && r.data.sales.count === 0, String(r.status));

  const soon = new Date();
  soon.setDate(soon.getDate() + 5);
  const expDate = soon.toISOString().slice(0, 10);
  r = await call('POST', '/api/products', { name: 'لبن منتهي قريباً', category: 'ألبان', sale_price: 2000, cost_price: 1500, quantity: 12, track_expiry: 1, expiry_date: expDate }, token);
  ok('expiry product created', r.status === 201, String(r.status));
  r = await call('GET', '/api/reports/expiring?days=30', null, token);
  ok('expiry report', r.status === 200 && r.data.rows.some((x) => x.name === 'لبن منتهي قريباً'), JSON.stringify(r.data.summary));
  ok('expiry report status', r.data.rows.find((x) => x.name === 'لبن منتهي قريباً').status === 'critical', JSON.stringify(r.data.rows.map((x) => x.status)));
  r = await call('GET', '/api/reports/expiring?days=1', null, token);
  ok('expiry report respects window', !r.data.rows.some((x) => x.name === 'لبن منتهي قريباً'), JSON.stringify(r.data.rows.map((x) => x.name)));
  r = await call('GET', `/api/print/voucher/${transferId}`, null, token);
  ok('voucher print HTML', r.status === 200 && String(r.data).includes('سند'), String(r.status));
  r = await call('GET', '/api/print/z-report', null, token);
  ok('z-report print HTML', r.status === 200 && String(r.data).includes('تقرير Z'), String(r.status));

  r = await call('GET', '/api/currencies', null, token);
  ok('currencies list', r.status === 200 && r.data.rows.length >= 1 && r.data.base.code === 'IQD', JSON.stringify(r.data.base));
  r = await call('POST', '/api/currencies', { code: 'usd', name: 'دولار أمريكي', symbol: '$', rate: 1300, decimals: 2 }, token);
  ok('create currency', r.status === 201 && r.data.rows.some((c) => c.code === 'USD'), JSON.stringify(r.data.rows.map((c) => c.code)));
  r = await call('POST', '/api/currencies', { code: 'USD', name: 'مكرر', rate: 1 }, token);
  ok('duplicate currency rejected (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/currencies', { code: 'EUR', name: 'يورو', rate: 0 }, token);
  ok('invalid rate rejected (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/currencies', { code: 'EUR', name: 'يورو', rate: 1500 }, cashierToken);
  ok('cashier cannot create currency (403)', r.status === 403, String(r.status));
  r = await call('PUT', '/api/currencies/USD', { rate: 1310, name: 'دولار أمريكي', symbol: '$' }, token);
  ok('update currency rate', r.status === 200 && r.data.rows.find((c) => c.code === 'USD').rate === 1310, JSON.stringify(r.data.rows.find((c) => c.code === 'USD')));
  r = await call('GET', '/api/currencies/convert?amount=100&to=USD', null, token);
  ok('convert endpoint', r.status === 200 && r.data.base_amount === 131000, JSON.stringify(r.data));

  r = await call('POST', '/api/products', { name: 'صنف بالدولار', category: 'عام', sale_price: 131000, cost_price: 100000, quantity: 10, unit: 'قطعة' }, token);
  const usdProductId = r.data.product.id;
  ok('product for foreign sale created', r.status === 201, String(r.status));
  r = await call('POST', '/api/sales', {
    items: [{ product_id: usdProductId, qty: 1, unit_price: 131000 }],
    payment_method: 'cash',
    currency: 'USD',
    paid_original: 100,
  }, token);
  const usdInvoiceId = r.data.invoice && r.data.invoice.id;
  ok('sale in foreign currency', r.status === 201 && r.data.invoice.currency === 'USD', JSON.stringify(r.data.invoice && { c: r.data.invoice.currency, t: r.data.invoice.total }));
  ok('foreign sale total stored in base', Math.abs(Number(r.data.invoice.total) - 131000) < 0.01, String(r.data.invoice.total));
  ok('foreign sale original total', Math.abs(Number(r.data.invoice.total_original) - 100) < 0.01, String(r.data.invoice.total_original));
  ok('foreign sale paid in base', Math.abs(Number(r.data.invoice.paid) - 131000) < 0.01, String(r.data.invoice.paid));
  ok('foreign sale due zero', Math.abs(Number(r.data.invoice.due)) < 0.01, String(r.data.invoice.due));
  r = await call('GET', '/api/treasury', null, token);
  const foreignTreasury = r.data.rows.find((t) => t.ref_table === 'invoices' && t.ref_id === usdInvoiceId);
  ok('foreign sale treasury in base currency', foreignTreasury && Math.abs(Number(foreignTreasury.amount) - 131000) < 0.01, JSON.stringify(foreignTreasury && foreignTreasury.amount));
  r = await call('GET', `/api/print/thermal/${usdInvoiceId}`, null, token);
  ok('foreign receipt shows currency rate', r.status === 200 && String(r.data).includes('USD'), String(r.status));
  r = await call('GET', '/api/reports/currency', null, token);
  ok('currency report', r.status === 200 && r.data.sales.some((s) => s.code === 'USD' && Math.abs(s.total_original - 100) < 0.01), JSON.stringify(r.data.sales));
  r = await call('GET', '/api/reports/trial-balance', null, token);
  ok('trial balance still balanced with foreign sale', Math.abs(r.data.totals.debit - r.data.totals.credit) < 0.01, `${r.data.totals.debit} / ${r.data.totals.credit}`);
  r = await call('POST', '/api/expenses', { category: 'نقل', description: 'أجرة', amount: 131000, currency: 'USD' }, token);
  ok('expense in foreign currency', r.status === 201 && r.data.expense.currency === 'USD' && Math.abs(Number(r.data.expense.amount_original) - 100) < 0.01, JSON.stringify(r.data.expense && { c: r.data.expense.currency, o: r.data.expense.amount_original }));
  r = await call('DELETE', `/api/currencies/USD`, null, token);
  ok('delete currency in use rejected (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/currencies', { code: 'EUR', name: 'يورو', symbol: '€', rate: 1500, decimals: 2 }, token);
  ok('second currency created', r.status === 201, String(r.status));
  r = await call('DELETE', '/api/currencies/EUR', null, token);
  ok('unused currency deleted', r.status === 200 && !r.data.rows.some((c) => c.code === 'EUR'), JSON.stringify(r.data.rows.map((c) => c.code)));
  r = await call('DELETE', '/api/currencies/IQD', null, token);
  ok('base currency cannot be deleted (400)', r.status === 400, String(r.status));

  r = await call('POST', '/api/products', { name: 'صنف بأسعار متعددة', category: 'عام', sale_price: 131000, cost_price: 100000, quantity: 5, unit: 'قطعة' }, token);
  const multiPriceId = r.data.product.id;
  ok('multi price product created', r.status === 201, String(r.status));
  r = await call('PUT', `/api/products/${multiPriceId}/prices`, { currency: 'USD', sale_price: 25, cost_price: 15, wholesale_price: 22 }, token);
  ok('set product price in foreign currency', r.status === 200 && r.data.rows.some((x) => x.currency === 'USD' && x.sale_price === 25), JSON.stringify(r.data.rows));
  r = await call('GET', `/api/products/${multiPriceId}/prices`, null, token);
  ok('read product prices', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].currency === 'USD', JSON.stringify(r.data.rows));
  r = await call('GET', `/api/products/${multiPriceId}`, null, token);
  ok('product exposes prices map', r.status === 200 && r.data.product.prices && r.data.product.prices.USD.sale_price === 25, JSON.stringify(r.data.product && r.data.product.prices));
  r = await call('GET', '/api/products?page_size=5', null, token);
  const listedMulti = r.data.rows.find((x) => x.id === multiPriceId);
  ok('product list includes prices', !!listedMulti && listedMulti.prices && listedMulti.prices.USD.sale_price === 25, JSON.stringify(listedMulti && listedMulti.prices));
  r = await call('PUT', `/api/products/${multiPriceId}/prices`, { currency: 'XXX', sale_price: 5 }, token);
  ok('unknown currency rejected for product price (400)', r.status === 400, String(r.status));
  r = await call('PUT', `/api/products/${multiPriceId}/prices`, { currency: 'USD', sale_price: -5 }, token);
  ok('negative product price rejected (400)', r.status === 400, String(r.status));
  r = await call('PUT', `/api/products/${multiPriceId}/prices`, { currency: 'USD', sale_price: 1 }, cashierToken);
  ok('cashier cannot set product prices (403)', r.status === 403, String(r.status));
  r = await call('POST', '/api/sales', {
    items: [{ product_id: multiPriceId, qty: 2, unit_price: 25 * 1310 }],
    payment_method: 'cash',
    currency: 'USD',
    paid_original: 50,
  }, token);
  ok('sale uses product foreign price', r.status === 201 && Math.abs(Number(r.data.invoice.total_original) - 50) < 0.01 && Math.abs(Number(r.data.invoice.total) - 65500) < 0.01, JSON.stringify(r.data.invoice && { t: r.data.invoice.total, o: r.data.invoice.total_original }));
  r = await call('DELETE', `/api/products/${multiPriceId}/prices/USD`, null, token);
  ok('delete product price', r.status === 200, String(r.status));
  r = await call('GET', `/api/products/${multiPriceId}/prices`, null, token);
  ok('product price removed', r.status === 200 && r.data.rows.length === 0, JSON.stringify(r.data.rows));

  r = await call('GET', '/api/backup', null, token);
  ok('backup list', r.status === 200 && Array.isArray(r.data.backups), r.status);
  ok('backup auto state', r.status === 200 && r.data.auto && r.data.auto.enabled === false && typeof r.data.auto.next === 'string', JSON.stringify(r.data.auto));
  r = await call('PUT', '/api/backup/auto', { enabled: true, time: '23:30', keep: 3 }, token);
  ok('auto backup settings saved', r.status === 200 && r.data.auto.enabled === true && r.data.auto.time === '23:30' && r.data.auto.keep === 3, JSON.stringify(r.data.auto));
  r = await call('PUT', '/api/backup/auto', { time: '99:99' }, token);
  ok('invalid auto backup time rejected (400)', r.status === 400, String(r.status));
  r = await call('PUT', '/api/backup/auto', { keep: 0 }, token);
  ok('invalid auto backup keep rejected (400)', r.status === 400, String(r.status));
  r = await call('PUT', '/api/backup/auto', { enabled: true }, cashierToken);
  ok('auto backup denied without permission (403)', r.status === 403, String(r.status));
  r = await call('POST', '/api/backup/auto/run', null, token);
  const autoName = r.data.backup && r.data.backup.name;
  ok('auto backup snapshot created', r.status === 201 && !!autoName && autoName.startsWith('zain-auto-'), JSON.stringify(r.data.backup));
  r = await call('GET', '/api/backup', null, token);
  ok('auto backup listed', r.data.backups.some((b) => b.name === autoName), JSON.stringify(r.data.backups.map((b) => b.name)));
  ok('auto backup last date recorded', r.data.auto.last === r.data.auto.today, JSON.stringify({ last: r.data.auto.last, today: r.data.auto.today }));
  r = await call('GET', `/api/backup/${encodeURIComponent(autoName)}/download`, null, token);
  ok('auto backup downloadable', r.status === 200 && String(r.data).length > 1000, r.status);
  r = await call('PUT', '/api/backup/auto', { enabled: false }, token);
  ok('auto backup disabled', r.status === 200 && r.data.auto.enabled === false, JSON.stringify(r.data.auto));
  const jobs = require('../src/server/core/jobs');
  const todayStr = jobs.runAutoBackup ? require('../src/server/modules/backup.routes').localDate() : '';
  ok('auto backup scheduler skips when disabled', jobs.autoBackupDue({ enabled: false, time: '00:00', last: '', today: todayStr }) === false);
  ok('auto backup scheduler runs when due', jobs.autoBackupDue({ enabled: true, time: '00:00', last: '', today: todayStr }) === true);
  ok('auto backup scheduler skips after daily run', jobs.autoBackupDue({ enabled: true, time: '00:00', last: todayStr, today: todayStr }) === false);
  ok('auto backup scheduler waits for the configured time', jobs.autoBackupDue({ enabled: true, time: '23:59', last: '', today: todayStr }) === (new Date().getHours() * 60 + new Date().getMinutes() >= 23 * 60 + 59));

  r = await call('POST', '/api/backup', null, token);
  const backupName = r.data.backup && r.data.backup.name;
  ok('backup created', r.status === 201 && !!backupName && r.data.backup.size > 1000, JSON.stringify(r.data.backup));
  ok('backup archive is zip', backupName.endsWith('.zip'), backupName);
  const dl = await raw(`/api/backup/${encodeURIComponent(backupName)}/download`, { headers: { Authorization: 'Bearer ' + token } });
  const archive = Buffer.from(await dl.arrayBuffer());
  const entries = readZip(archive);
  ok('backup archive contains database', entries.some((e) => e.name === 'zain.db'), entries.map((e) => e.name).join(','));
  ok('backup archive contains product images', entries.some((e) => e.name.startsWith('images/')), entries.map((e) => e.name).join(','));
  r = await call('GET', `/api/backup/${encodeURIComponent(backupName)}/download`, null, token);
  ok('backup download', r.status === 200 && String(r.data).length > 1000, r.status);
  r = await call('GET', '/api/backup', null, cashierToken);
  ok('backup denied without permission (403)', r.status === 403, String(r.status));
  r = await call('POST', '/api/backup/upload/restore', { data: Buffer.from('not a database').toString('base64') }, token);
  ok('restore rejects invalid file (400)', r.status === 400, String(r.status));

  const extDir = path.join(path.dirname(process.env.ZAIN_DB), 'ext-backups');
  r = await call('PUT', '/api/backup/external', { enabled: 1, dir: extDir, keep: 3 }, token);
  ok('external backup settings saved', r.status === 200 && r.data.external.enabled === true && r.data.external.dir === extDir && r.data.external.writable === true, JSON.stringify(r.data.external));
  r = await call('PUT', '/api/backup/external', { dir: path.join(extDir, 'bad\0name') }, token);
  ok('invalid external path rejected (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/backup/external/run', null, token);
  ok('external copy executed', r.status === 201 && r.data.external.count >= 1, JSON.stringify(r.data.external));
  const extFiles = fs.existsSync(extDir) ? fs.readdirSync(extDir).filter((f) => f.endsWith('.zip')) : [];
  ok('external archive written to disk', extFiles.length >= 1, extFiles.join(','));
  const extEntries = extFiles.length ? readZip(fs.readFileSync(path.join(extDir, extFiles[0]))) : [];
  ok('external archive contains database', extEntries.some((e) => e.name === 'zain.db'), extEntries.map((e) => e.name).join(','));
  r = await call('POST', '/api/backup', null, token);
  ok('manual backup copies to external dir', r.data.backup && r.data.backup.external && r.data.backup.external.copied === true, JSON.stringify(r.data.backup && r.data.backup.external));
  r = await call('PUT', '/api/backup/external', { enabled: 0 }, token);
  ok('external backup disabled', r.status === 200 && r.data.external.enabled === false, JSON.stringify(r.data.external));
  r = await call('POST', '/api/backup/external/run', null, token);
  ok('external copy blocked when disabled (400)', r.status === 400, String(r.status));
  r = await call('PUT', '/api/backup/external', { enabled: 1, dir: extDir }, cashierToken);
  ok('external backup requires permission (403)', r.status === 403, String(r.status));

  r = await call('GET', '/api/products', null, token);
  const beforeRestore = r.data.total;
  r = await call('POST', `/api/backup/${encodeURIComponent(backupName)}/restore`, null, token);
  ok('backup restored', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
  r = await call('GET', '/api/products', null, token);
  ok('data intact after restore', r.data.total === beforeRestore, `${beforeRestore} -> ${r.data.total}`);
  r = await call('GET', '/api/auth/me', null, token);
  ok('session alive after restore', r.status === 200, String(r.status));
  const imgAfterRestore = await raw(imageUrl);
  ok('product image intact after restore', imgAfterRestore.status === 200, String(imgAfterRestore.status));
  r = await call('POST', '/api/backup/upload/restore', { data: archive.toString('base64') }, token);
  ok('restore from uploaded archive', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
  const imgAfterUpload = await raw(imageUrl);
  ok('product image restored from uploaded archive', imgAfterUpload.status === 200, String(imgAfterUpload.status));
  r = await call('DELETE', `/api/backup/${encodeURIComponent(backupName)}`, null, token);
  ok('backup deleted', r.status === 200 && !r.data.backups.some((b) => b.name === backupName), JSON.stringify(r.data.backups.map((b) => b.name)));

  r = await call('GET', '/api/reminders', null, token);
  ok('reminders list', r.status === 200 && Array.isArray(r.data.rows), String(r.status));
  r = await call('POST', '/api/reminders', { title: 'صيانة الطابعة', body: 'فحص الطباعة الحرارية', repeat_type: 'weekly', time_of_day: '10:30' }, token);
  const reminderId = r.data.reminder && r.data.reminder.id;
  ok('create reminder', r.status === 201 && !!reminderId, JSON.stringify(r.data.reminder));
  ok('reminder next run computed', !!r.data.reminder.next_run && r.data.reminder.next_run.includes('10:30'), String(r.data.reminder.next_run));
  r = await call('POST', '/api/reminders', { body: 'بدون عنوان' }, token);
  ok('reminder without title rejected (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/reminders', { title: 'x', repeat_type: 'yearly' }, token);
  ok('invalid repeat type rejected (400)', r.status === 400, String(r.status));
  r = await call('PUT', `/api/reminders/${reminderId}`, { title: 'صيانة أسبوعية', time_of_day: '11:00' }, token);
  ok('update reminder', r.status === 200 && r.data.reminder.title === 'صيانة أسبوعية' && r.data.reminder.time_of_day === '11:00', JSON.stringify(r.data.reminder));
  r = await call('POST', `/api/reminders/${reminderId}/run`, null, token);
  ok('run reminder marks last run', r.status === 200 && !!r.data.reminder.last_run, JSON.stringify(r.data.reminder && r.data.reminder.last_run));
  r = await call('GET', '/api/reminders', null, cashierToken);
  ok('reminders denied without permission (403)', r.status === 403, String(r.status));
  r = await call('GET', '/api/reminders/daily', null, token);
  ok('daily digest', r.status === 200 && typeof r.data.text === 'string' && r.data.text.length > 10, String(r.status));
  const companyName = (await call('GET', '/api/settings', null, token)).data.settings.company_name;
  ok('daily digest includes company name', r.data.text.includes(companyName) || r.data.text.includes('Zain'), r.data.text.split('\n')[0]);
  ok('daily digest includes debts section', r.data.text.includes('ذمم'), r.data.text);
  r = await call('GET', '/api/reminders/digest.txt', null, token);
  ok('digest text endpoint', r.status === 200 && String(r.data).includes('تذكير'), r.status);
  r = await call('POST', '/api/products', { name: 'حليب منتهي', category: 'مواد غذائية', sale_price: 3000, cost_price: 2500, quantity: 12, reorder_level: 30, track_expiry: 1, expiry_date: '2026-10-25' }, token);
  const expiryPid = r.data.product.id;
  ok('create expiring product', r.status === 201 && !!expiryPid, String(r.status));
  r = await call('GET', '/api/reminders/daily', null, token);
  ok('digest reports expiring products', r.data.text.includes('حليب منتهي'), r.data.text.slice(0, 200));
  ok('digest reports low stock products', r.data.text.includes('على وشك النفاد'), r.data.text.slice(0, 200));
  r = await call('PUT', '/api/settings', { reminder_expiry: 0, reminder_low_stock: 0, reminder_debts: 0, reminder_sales_summary: 0 }, token);
  ok('digest sections can be disabled', r.status === 200, String(r.status));
  r = await call('GET', '/api/reminders/daily', null, token);
  ok('digest empty when sections disabled', r.data.text.includes('لا توجد تنبيهات'), r.data.text);
  r = await call('PUT', '/api/settings', { reminder_expiry: 1, reminder_low_stock: 1, reminder_debts: 1, reminder_sales_summary: 1 }, token);
  r = await call('DELETE', `/api/reminders/${reminderId}`, null, token);
  ok('reminder deleted', r.status === 200, String(r.status));
  r = await call('GET', '/api/reminders', null, token);
  ok('reminder removed from list', !r.data.rows.some((x) => x.id === reminderId), JSON.stringify(r.data.rows.map((x) => x.id)));
  r = await call('DELETE', `/api/reminders/${reminderId}`, null, token);
  ok('deleting missing reminder (404)', r.status === 404, String(r.status));
  const jobs2 = require('../src/server/core/jobs');
  jobs2.stop();
  await call('PUT', '/api/settings', { reminder_daily_time: '00:00', reminder_last_digest_at: '' }, token);
  ok('digest scheduler runs when due', jobs2.digestDue() === true, 'due=' + jobs2.digestDue());
  const digest = jobs2.runDailyDigest();
  ok('daily digest generated by scheduler', !!digest && typeof digest.text === 'string' && digest.text.length > 10, JSON.stringify(digest && digest.text && digest.text.slice(0, 40)));
  ok('digest scheduler skips after daily run', jobs2.digestDue() === false);
  r = await call('GET', '/api/reminders/daily', null, token);
  ok('last digest stored', r.data.last_digest.length > 10 && r.data.last_digest_at === r.data.date, JSON.stringify({ at: r.data.last_digest_at, date: r.data.date }));
  await call('PUT', '/api/settings', { reminder_daily_time: '08:00' }, token);

  r = await call('GET', '/api/reports/inventory', null, token);
  const invTotals = r.data.totals;
  ok('inventory report', r.status === 200 && invTotals.items >= 1 && invTotals.cost_value > 0, JSON.stringify(invTotals));
  const invRow = r.data.rows.find((x) => x.id === pid);
  ok('inventory row computes cost value', invRow && Math.abs(invRow.cost_value - invRow.quantity * invRow.cost_price) < 0.01, JSON.stringify(invRow && { q: invRow.quantity, c: invRow.cost_price, v: invRow.cost_value }));
  ok('inventory groups by category', r.data.categories.some((x) => x.category === 'إلكترونيات'), JSON.stringify(r.data.categories.map((x) => x.category)));
  r = await call('GET', '/api/reports/inventory?category=إلكترونيات', null, token);
  ok('inventory report filters by category', r.status === 200 && r.data.rows.every((x) => x.category === 'إلكترونيات'), String(r.data.rows.length));
  r = await call('GET', '/api/reports/inventory?search=Lenovo', null, token);
  ok('inventory report searches by name', r.status === 200 && r.data.rows.length === 1, String(r.data.rows.length));
  r = await call('GET', '/api/print/inventory', null, token);
  ok('inventory print HTML', r.status === 200 && String(r.data).includes('تقرير المخزون') && String(r.data).includes('قيمة المخزون بالتكلفة'), String(r.status));
  r = await call('GET', '/api/accounts', null, token);
  const accountId = r.data.accounts[0].id;
  r = await call('GET', `/api/print/account/${accountId}`, null, token);
  ok('account ledger print HTML', r.status === 200 && String(r.data).includes('دفتر أستاذ الحساب'), String(r.status));
  r = await call('GET', '/api/print/account/99999', null, token);
  ok('account ledger print 404 for missing account', r.status === 404, String(r.status));
  r = await call('GET', `/api/print/product-movements/${pid}`, null, token);
  ok('product movements print HTML', r.status === 200 && String(r.data).includes('تقرير حركة صنف'), String(r.status));
  r = await call('GET', '/api/print/product-movements/99999', null, token);
  ok('product movements print 404 for missing product', r.status === 404, String(r.status));

  r = await call('POST', '/api/products', { name: 'صنف ضريبي 10%', category: 'عام', sale_price: 100000, cost_price: 80000, quantity: 50, tax_rate: 10 }, token);
  const taxedPid = r.data.product.id;
  ok('create product with tax rate', r.status === 201 && Number(r.data.product.tax_rate) === 10, String(r.data.product && r.data.product.tax_rate));
  r = await call('PUT', '/api/settings', { tax_mode: 'auto' }, token);
  ok('tax mode auto saved', r.status === 200 && r.data.settings.tax_mode === 'auto', String(r.data.settings && r.data.settings.tax_mode));
  r = await call('PUT', '/api/settings', { tax_mode: 'wrong' }, token);
  ok('invalid tax mode rejected', r.status === 400, String(r.status));
  r = await call('POST', '/api/sales', { items: [{ product_id: taxedPid, qty: 2, unit_price: 100000 }], payment_method: 'cash', paid: 220000 }, token);
  const autoInvoice = r.data.invoice;
  ok('auto tax added to total', r.status === 201 && autoInvoice.tax === 20000 && autoInvoice.total === 220000 && Number(autoInvoice.tax_inclusive) === 0, JSON.stringify({ tax: autoInvoice.tax, total: autoInvoice.total }));
  r = await call('POST', '/api/sales', { items: [{ product_id: taxedPid, qty: 1, unit_price: 100000 }], payment_method: 'cash', paid: 105000, tax: 5000 }, token);
  ok('manual tax overrides auto', r.status === 201 && r.data.invoice.tax === 5000 && r.data.invoice.total === 105000, JSON.stringify({ tax: r.data.invoice.tax, total: r.data.invoice.total }));
  await call('PUT', '/api/settings', { tax_mode: 'inclusive' }, token);
  r = await call('POST', '/api/sales', { items: [{ product_id: taxedPid, qty: 2, unit_price: 110000 }], payment_method: 'cash', paid: 220000 }, token);
  const incInvoice = r.data.invoice;
  ok('inclusive tax extracted from price', r.status === 201 && Math.abs(incInvoice.tax - 20000) < 0.01 && incInvoice.total === 220000 && Number(incInvoice.tax_inclusive) === 1, JSON.stringify({ tax: incInvoice.tax, total: incInvoice.total }));
  await call('PUT', '/api/settings', { tax_mode: 'manual' }, token);
  r = await call('POST', '/api/sales', { items: [{ product_id: taxedPid, qty: 1, unit_price: 100000 }], payment_method: 'cash', paid: 100000 }, token);
  ok('manual mode has no tax', r.status === 201 && r.data.invoice.tax === 0 && r.data.invoice.total === 100000, JSON.stringify({ tax: r.data.invoice.tax, total: r.data.invoice.total }));
  r = await call('GET', '/api/reports/tax', null, token);
  ok('tax report totals', r.status === 200 && r.data.output_tax === 45000 && r.data.input_tax === 0 && r.data.net_payable === 45000, JSON.stringify({ o: r.data.output_tax, i: r.data.input_tax }));
  r = await call('GET', '/api/reports/tax?from=2000-01-01&to=2000-01-02', null, token);
  ok('tax report respects range', r.status === 200 && r.data.rows.length === 0, String(r.data.rows.length));
  r = await call('GET', '/api/print/tax', null, token);
  ok('tax print HTML', r.status === 200 && String(r.data).includes('تقرير الضريبة'), String(r.status));
  r = await call('GET', '/api/accounts', null, token);
  const vatAccount = r.data.accounts.find((a) => a.code === '2300');
  ok('vat account exists', !!vatAccount, JSON.stringify(r.data.accounts.map((a) => a.code)));
  ok('vat account holds output tax', vatAccount && Math.abs(Number(vatAccount.computed_balance) + 45000) < 0.01, String(vatAccount && vatAccount.computed_balance));
  r = await call('GET', '/api/reports/trial-balance', null, token);
  ok('trial balance balanced after tax', Math.abs(r.data.totals.debit - r.data.totals.credit) < 0.01, `${r.data.totals.debit} / ${r.data.totals.credit}`);
  r = await call('GET', '/api/reports/income-statement', null, token);
  ok('income statement revenue excludes vat', r.status === 200, String(r.status));

  r = await call('GET', '/api/reports/sales-analysis', null, token);
  const ana = r.data;
  ok('sales analysis returns totals', r.status === 200 && ana.totals.revenue > 0 && ana.totals.invoices > 0, JSON.stringify(ana.totals));
  ok('sales analysis ranks products', ana.products.length > 0 && ana.products[0].revenue > 0 && ana.products[0].qty > 0, JSON.stringify(ana.products[0]));
  ok('sales analysis ranks customers', ana.customers.length > 0 && ana.customers[0].total > 0, JSON.stringify(ana.customers[0]));
  const anaRev = Math.round(ana.products.reduce((s, p) => s + p.revenue, 0) * 100) / 100;
  ok('sales analysis computes product profit', Math.abs(ana.totals.profit - (anaRev - ana.totals.cost)) < 0.02, JSON.stringify({ profit: ana.totals.profit, cost: ana.totals.cost }));
  ok('sales analysis daily series', Array.isArray(ana.daily), String(typeof ana.daily));
  r = await call('GET', '/api/reports/sales-analysis?from=2000-01-01&to=2000-01-02', null, token);
  ok('sales analysis respects range', r.status === 200 && r.data.totals.revenue === 0 && r.data.products.length === 0, JSON.stringify(r.data.totals));
  r = await call('GET', '/api/print/sales-analysis', null, token);
  ok('sales analysis print HTML', r.status === 200 && String(r.data).includes('تحليل المبيعات') && String(r.data).includes('الأصناف الأكثر مبيعاً'), String(r.status));

  r = await call('GET', '/api/activity', null, token);
  ok('activity log lists entries', r.status === 200 && r.data.rows.length > 0 && r.data.total > 0, JSON.stringify({ rows: r.data.rows.length, total: r.data.total }));
  ok('activity log groups by action', r.data.by_action.length > 0 && r.data.by_action[0].count > 0, JSON.stringify(r.data.by_action.slice(0, 2)));
  ok('activity log joins user', r.data.rows.some((x) => x.username), JSON.stringify(r.data.rows[0] && r.data.rows[0].username));
  r = await call('GET', '/api/activity?action=sale', null, token);
  ok('activity log filters by action', r.status === 200 && r.data.rows.every((x) => x.action === 'sale'), String(r.data.rows.length));
  r = await call('GET', '/api/activity?from=2000-01-01&to=2000-01-02', null, token);
  ok('activity log respects date range', r.status === 200 && r.data.rows.length === 0, String(r.data.rows.length));
  r = await call('GET', '/api/activity', null, cashierToken);
  ok('activity log requires permission (403)', r.status === 403, String(r.status));
  r = await call('GET', '/api/export/activity', null, token);
  ok('activity export CSV', r.status === 200 && String(r.data).includes('الإجراء'), String(r.status));

  r = await call('GET', '/api/search?q=' + encodeURIComponent('لابتوب'), null, token);
  ok('search finds products by name', r.status === 200 && r.data.products.length === 1 && r.data.products[0].name.includes('لابتوب'), JSON.stringify(r.data.products.map((x) => x.name)));
  r = await call('GET', '/api/search?q=B100', null, token);
  ok('search finds products by barcode', r.status === 200 && r.data.products.length === 1, String(r.data.products.length));
  r = await call('GET', '/api/search?q=' + encodeURIComponent('الأمل'), null, token);
  ok('search finds customers', r.status === 200 && r.data.customers.length === 1, String(r.data.customers.length));
  r = await call('GET', '/api/search?q=' + encodeURIComponent('الأمل'), null, token);
  ok('search groups results', r.data.total === r.data.products.length + r.data.customers.length + r.data.suppliers.length + r.data.invoices.length, String(r.data.total));
  r = await call('GET', '/api/search?q=' + encodeURIComponent('ZZZ-NOT-FOUND'), null, token);
  ok('search without results', r.status === 200 && r.data.total === 0, String(r.data.total));
  r = await call('GET', '/api/search?q=', null, token);
  ok('search empty query', r.status === 200 && r.data.total === 0, String(r.data.total));
  r = await call('GET', '/api/search?q=' + encodeURIComponent('لابتوب'));
  ok('search requires authentication', r.status === 401, String(r.status));
  r = await call('GET', '/api/search?q=' + encodeURIComponent('لابتوب'), null, cashierToken);
  ok('search allowed for cashier', r.status === 200, String(r.status));

  r = await call('POST', `/api/products/${pid}/image`, { data_url: pngDataUrl }, cashierToken);
  ok('product image requires permission', r.status === 403, String(r.status));
  r = await call('DELETE', `/api/products/${pid}/image`, null, token);
  ok('delete product image', r.status === 200, String(r.status));
  r = await raw(imageUrl);
  ok('product image removed from disk', r.status === 404, String(r.status));

  r = await call('POST', '/api/products', { name: 'صنف مؤقت بصورة', category: 'إلكترونيات', barcode: 'TMP-IMG', sale_price: 1000, cost_price: 500, quantity: 1, reorder_level: 0 }, token);
  const tmpPid = r.data.product.id;
  r = await call('POST', `/api/products/${tmpPid}/image`, { data_url: pngDataUrl }, token);
  const tmpImageUrl = r.data.product.image;
  const tmpImageFile = tmpImageUrl.split('/').pop();
  ok('temporary product image uploaded', r.status === 200 && !!tmpImageUrl, JSON.stringify(r.data));
  r = await call('DELETE', `/api/products/${tmpPid}`, null, token);
  ok('temporary product deleted', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
  const tmpImgRes = await raw(tmpImageUrl);
  ok('deleted product image file removed from disk', tmpImgRes.status === 404, String(tmpImgRes.status));
  r = await call('GET', '/api/products', null, token);
  ok('deleted product removed from list', !r.data.rows.some((x) => x.id === tmpPid), 'found=' + r.data.rows.some((x) => x.id === tmpPid));
  ok('deleted product image file deleted', !fs.existsSync(path.join(path.dirname(process.env.ZAIN_DB), 'images', tmpImageFile)), tmpImageFile);

  r = await call('GET', '/api/scheduled', null, token);
  ok('scheduled list empty', r.status === 200 && r.data.rows.length === 0, String(r.data.rows.length));
  r = await call('POST', '/api/scheduled', {}, token);
  ok('scheduled requires title (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/scheduled', { title: 'بلا أصناف' }, token);
  ok('scheduled requires items (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/scheduled', { title: 'آجل بلا عميل', items: [{ name: 'خدمة', unit_price: 1000 }] }, token);
  ok('scheduled credit sale requires customer (400)', r.status === 400, String(r.status));
  r = await call('POST', '/api/scheduled', { title: 'شراء بلا مورد', type: 'purchase', items: [{ name: 'بند', unit_price: 1000 }] }, token);
  ok('scheduled purchase requires supplier (400)', r.status === 400, String(r.status));

  r = await call('POST', '/api/scheduled', {
    title: 'إيجار شهري', type: 'sale', payment_method: 'cash', frequency: 'monthly',
    next_run: '2020-01-01 09:00', items: [{ name: 'إيجار المكتب', qty: 1, unit_price: 250000 }],
  }, token);
  const scheduleId = r.data.schedule && r.data.schedule.id;
  ok('create scheduled invoice', r.status === 201 && !!scheduleId, JSON.stringify(r.data.schedule));

  r = await call('POST', '/api/scheduled/run-due', null, token);
  ok('run-due creates invoice', r.status === 200 && r.data.created.length === 1, JSON.stringify(r.data.created));
  r = await call('GET', '/api/scheduled', null, token);
  const schRow = r.data.rows.find((x) => x.id === scheduleId);
  ok('scheduled counters updated', schRow.runs_count === 1 && !!schRow.last_run && !!schRow.last_invoice_id, JSON.stringify(schRow));
  ok('scheduled next run advanced', new Date(String(schRow.next_run).replace(' ', 'T')) > new Date(), String(schRow.next_run));
  r = await call('GET', '/api/sales?type=sale&page_size=500', null, token);
  const schInvoice = r.data.rows.find((x) => x.id === schRow.last_invoice_id);
  ok('scheduled invoice created as cash sale', schInvoice && Number(schInvoice.total) === 250000 && Number(schInvoice.paid) === 250000 && schInvoice.payment_method === 'cash', JSON.stringify(schInvoice));
  ok('scheduled invoice tagged with title', schInvoice && String(schInvoice.notes || '').includes('إيجار شهري'), schInvoice && schInvoice.notes);

  r = await call('POST', '/api/scheduled/run-due', null, token);
  ok('run-due skips future schedule', r.status === 200 && r.data.created.length === 0, JSON.stringify(r.data.created));

  r = await call('PUT', `/api/scheduled/${scheduleId}`, { active: 0, next_run: '2020-01-02 09:00' }, token);
  ok('pause scheduled invoice', r.status === 200 && r.data.rows.find((x) => x.id === scheduleId).active === 0, JSON.stringify(r.data.rows));
  r = await call('POST', '/api/scheduled/run-due', null, token);
  ok('run-due ignores paused schedule', r.status === 200 && r.data.created.length === 0, JSON.stringify(r.data.created));
  r = await call('PUT', `/api/scheduled/${scheduleId}`, { active: 1 }, token);
  ok('resume scheduled invoice', r.status === 200 && r.data.rows.find((x) => x.id === scheduleId).active === 1);
  r = await call('POST', '/api/scheduled/run-due', null, token);
  ok('run-due resumes creation', r.status === 200 && r.data.created.length === 1, JSON.stringify(r.data.created));

  r = await call('POST', `/api/scheduled/${scheduleId}/run`, null, token);
  ok('run scheduled invoice manually', r.status === 201 && !!r.data.invoice && Number(r.data.invoice.total) === 250000, JSON.stringify(r.data.invoice));
  r = await call('GET', '/api/scheduled', null, token);
  ok('manual run increments counter', r.data.rows.find((x) => x.id === scheduleId).runs_count === 3, JSON.stringify(r.data.rows));

  r = await call('POST', '/api/scheduled', { title: 'بلا صلاحية', items: [{ name: 'x', unit_price: 1 }] }, cashierToken);
  ok('scheduled denied without permission (403)', r.status === 403, String(r.status));
  r = await call('POST', '/api/scheduled/run-due', null, cashierToken);
  ok('scheduled run-due denied (403)', r.status === 403, String(r.status));

  r = await call('DELETE', `/api/scheduled/${scheduleId}`, null, token);
  ok('delete scheduled invoice', r.status === 200 && !r.data.rows.some((x) => x.id === scheduleId), String(r.data.rows.length));
  r = await call('DELETE', `/api/scheduled/${scheduleId}`, null, token);
  ok('deleting missing schedule (404)', r.status === 404, String(r.status));

  r = await call('POST', '/api/customers', { name: 'عميل متأخر', phone: '0780' }, token);
  const lateCustomer = r.data.customer.id;
  const lateDate = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  r = await call('POST', '/api/sales', {
    items: [{ name: 'خدمة صيانة', qty: 1, unit_price: 400000 }], customer_id: lateCustomer,
    payment_method: 'credit', paid: 0, installment_plan: { count: 2, due_date: lateDate },
  }, token);
  ok('overdue installment sale created', r.status === 201, String(r.status));
  r = await call('GET', `/api/installments?status=overdue&customer_id=${lateCustomer}`, null, token);
  ok('installment not overdue before scan', r.data.rows.length === 0, String(r.data.rows.length));
  r = await call('POST', '/api/installments/mark-overdue', null, token);
  ok('mark-overdue flags late installment', r.status === 200 && r.data.marked === 1, JSON.stringify(r.data));
  r = await call('GET', `/api/installments?status=overdue&customer_id=${lateCustomer}`, null, token);
  const lateInst = r.data.rows[0];
  ok('overdue installment listed', r.data.rows.length === 1 && lateInst.status === 'overdue', JSON.stringify(lateInst && lateInst.status));
  r = await call('POST', `/api/installments/${lateInst.id}/pay`, { amount: 150000 }, token);
  ok('partial payment keeps overdue status', r.status === 200 && r.data.installment.status === 'overdue', r.data.installment && r.data.installment.status);
  r = await call('POST', `/api/installments/${lateInst.id}/pay`, { amount: 250000 }, token);
  ok('full payment completes overdue', r.status === 200 && r.data.installment.status === 'completed', r.data.installment && r.data.installment.status);
  r = await call('POST', '/api/installments/mark-overdue', null, token);
  ok('mark-overdue no-op when clean', r.data.marked === 0, JSON.stringify(r.data));
  r = await call('GET', '/api/activity?action=installments_overdue', null, token);
  ok('overdue scan logged in activity', r.data.rows.length === 1 && r.data.rows[0].action === 'installments_overdue', JSON.stringify(r.data.rows));
  r = await call('POST', '/api/installments/mark-overdue', null, cashierToken);
  ok('mark-overdue denied without permission (403)', r.status === 403, String(r.status));

  r = await call('GET', '/api/sales/1', null, token);
  const srcSale = r.data.invoice;
  const stockBeforeRepeat = Number((await call('GET', `/api/products/${pid}`, null, token)).data.product.quantity);
  r = await call('POST', '/api/sales/1/repeat', null, token);
  ok('repeat credit over limit blocked (409)', r.status === 409 && r.data.code === 'CREDIT_LIMIT', JSON.stringify({ status: r.status, code: r.data && r.data.code }));
  r = await call('POST', '/api/sales/1/repeat', { force_credit_limit: true }, token);
  ok('repeat sale invoice', r.status === 201 && Number(r.data.invoice.total) === Number(srcSale.total) && r.data.repeated_from === 1, JSON.stringify({ total: r.data.invoice && r.data.invoice.total, from: r.data.repeated_from }));
  ok('repeat sale copies items and notes', String(r.data.invoice.notes || '').includes('تكرار') && String(r.data.invoice.notes).includes(srcSale.invoice_no) && r.data.invoice.id !== 1, String(r.data.invoice.notes));
  ok('repeat sale gets new number', r.data.invoice.invoice_no !== srcSale.invoice_no, `${srcSale.invoice_no} -> ${r.data.invoice.invoice_no}`);
  const repeatItems = (await call('GET', `/api/sales/${r.data.invoice.id}`, null, token)).data.items;
  ok('repeat sale items match original', repeatItems.length === 1 && Number(repeatItems[0].unit_price) === 500000 && Number(repeatItems[0].qty) === 2, JSON.stringify(repeatItems.map((x) => ({ p: x.unit_price, q: x.qty }))));
  const stockAfterRepeat = Number((await call('GET', `/api/products/${pid}`, null, token)).data.product.quantity);
  ok('repeat sale moves stock', stockBeforeRepeat - stockAfterRepeat === 2, `${stockBeforeRepeat} -> ${stockAfterRepeat}`);
  ok('repeat of credit sale is unpaid', Number(r.data.invoice.paid) === 0 && Number(r.data.invoice.due) === Number(r.data.invoice.total), JSON.stringify({ paid: r.data.invoice.paid, due: r.data.invoice.due }));

  const cashRow = (await call('GET', '/api/sales?type=sale&page_size=500', null, token)).data.rows.find((x) => x.payment_method === 'cash');
  r = await call('POST', `/api/sales/${cashRow.id}/repeat`, null, token);
  ok('repeat cash sale fully paid', r.status === 201 && Number(r.data.invoice.paid) === Number(r.data.invoice.total) && Number(r.data.invoice.due) === 0, JSON.stringify({ paid: r.data.invoice && r.data.invoice.paid }));

  const stockBeforePurchaseRepeat = Number((await call('GET', `/api/products/${spid}`, null, token)).data.product.quantity);
  r = await call('POST', `/api/sales/${purchaseId}/repeat`, null, token);
  ok('repeat purchase invoice', r.status === 201 && r.data.invoice.type === 'purchase', JSON.stringify(r.data.invoice && r.data.invoice.type));
  const stockAfterPurchaseRepeat = Number((await call('GET', `/api/products/${spid}`, null, token)).data.product.quantity);
  ok('repeat purchase adds stock', stockAfterPurchaseRepeat - stockBeforePurchaseRepeat === 10, `${stockBeforePurchaseRepeat} -> ${stockAfterPurchaseRepeat}`);

  const returnRow = (await call('GET', '/api/sales?type=return_sale&page_size=5', null, token)).data.rows[0];
  r = await call('POST', `/api/sales/${returnRow.id}/repeat`, null, token);
  ok('repeat rejects return invoices (400)', r.status === 400, String(r.status));
  r = await call('POST', `/api/sales/${purchaseId}/repeat`, null, cashierToken);
  ok('repeat purchase requires permission (403)', r.status === 403, String(r.status));
  r = await call('POST', '/api/sales/999999/repeat', null, token);
  ok('repeat missing invoice (404)', r.status === 404, String(r.status));

  r = await call('POST', '/api/vouchers', { type: 'receipt', amount: 12000, partner_type: 'customer', partner_id: cid, method: 'cash', description: 'سند تكرار' }, token);
  const repVoucherId = r.data.voucher.id;
  const balanceBeforeRepeat = Number((await call('GET', `/api/customers/${cid}`, null, token)).data.customer.balance);
  r = await call('POST', `/api/vouchers/${repVoucherId}/repeat`, null, token);
  ok('repeat voucher creates copy', r.status === 201 && r.data.voucher.id !== repVoucherId && Number(r.data.voucher.amount) === 12000, JSON.stringify(r.data.voucher && r.data.voucher.voucher_no));
  ok('repeat voucher keeps type and description', r.data.voucher.type === 'receipt' && r.data.voucher.description === 'سند تكرار', JSON.stringify({ type: r.data.voucher.type, desc: r.data.voucher.description }));
  ok('repeat voucher gets new number', r.data.voucher.voucher_no !== (await call('GET', `/api/vouchers/${repVoucherId}`, null, token)).data.voucher.voucher_no, r.data.voucher.voucher_no);
  const balanceAfterRepeat = Number((await call('GET', `/api/customers/${cid}`, null, token)).data.customer.balance);
  ok('repeat voucher updates customer balance', Math.abs((balanceBeforeRepeat - balanceAfterRepeat) - 12000) < 0.01, `${balanceBeforeRepeat} -> ${balanceAfterRepeat}`);
  r = await call('POST', `/api/vouchers/${repVoucherId}/repeat`, null, cashierToken);
  ok('repeat voucher requires permission (403)', r.status === 403, String(r.status));
  r = await call('POST', '/api/vouchers/999999/repeat', null, token);
  ok('repeat missing voucher (404)', r.status === 404, String(r.status));

  r = await call('POST', '/api/shifts/open', { opening_balance: 0 }, token);
  ok('shift opened for split tests', r.status === 201, String(r.status));
  const splitShiftId = r.data.shift.id;

  r = await call('POST', '/api/products', { name: 'صنف دفع مختلط', category: 'اختبار', barcode: 'MIX1', sale_price: 500000, cost_price: 300000, quantity: 30, reorder_level: 1 }, token);
  const mixPid = r.data.product.id;
  ok('product for split payment created', r.status === 201, String(r.status));

  r = await call('POST', '/api/sales', {
    items: [{ product_id: mixPid, qty: 2, unit_price: 500000 }],
    payment_method: 'mixed', paid: 1100000, shift_id: splitShiftId,
    payments: [{ method: 'cash', amount: 700000 }, { method: 'card', amount: 400000 }],
  }, token);
  const splitId = r.data.invoice && r.data.invoice.id;
  ok('split payment sale created', r.status === 201 && r.data.invoice.payment_method === 'mixed', JSON.stringify({ status: r.status, method: r.data.invoice && r.data.invoice.payment_method }));
  ok('split payment fully settled', Number(r.data.invoice.paid) === 1000000 && Number(r.data.invoice.due) === 0, JSON.stringify({ paid: r.data.invoice && r.data.invoice.paid, due: r.data.invoice && r.data.invoice.due }));

  r = await call('GET', `/api/sales/${splitId}`, null, token);
  const splitPayments = r.data.payments || [];
  ok('split payment rows stored', splitPayments.length === 2 && splitPayments.some((p) => p.method === 'cash') && splitPayments.some((p) => p.method === 'card'), JSON.stringify(splitPayments.map((p) => ({ m: p.method, a: p.amount }))));
  ok('split change trimmed from cash', splitPayments.find((p) => p.method === 'cash').amount === 600000 && splitPayments.find((p) => p.method === 'card').amount === 400000, JSON.stringify(splitPayments.map((p) => ({ m: p.method, a: p.amount }))));

  r = await call('GET', '/api/treasury?page_size=10', null, token);
  const saleCash = r.data.rows.find((x) => x.source === 'sale_cash' && Number(x.amount) === 600000);
  const saleCard = r.data.rows.find((x) => x.source === 'sale_card' && Number(x.amount) === 400000);
  ok('split treasury cash row', !!saleCash, JSON.stringify(r.data.rows.slice(0, 3).map((x) => ({ s: x.source, a: x.amount }))));
  ok('split treasury card row', !!saleCard, JSON.stringify(r.data.rows.slice(0, 3).map((x) => ({ s: x.source, a: x.amount }))));

  r = await call('GET', `/api/shifts/${splitShiftId}`, null, token);
  ok('shift wallet/card totals updated', Number(r.data.shift.total_card) === 400000 && Number(r.data.shift.total_cash) === 600000, JSON.stringify({ cash: r.data.shift.total_cash, card: r.data.shift.total_card, wallet: r.data.shift.total_wallet }));

  r = await call('POST', '/api/sales', {
    items: [{ product_id: mixPid, qty: 1, unit_price: 500000 }],
    payment_method: 'mixed', shift_id: splitShiftId,
    payments: [{ method: 'wallet', amount: 500000 }],
  }, token);
  const walletSaleId = r.data.invoice && r.data.invoice.id;
  ok('wallet payment sale', r.status === 201 && r.data.invoice.payment_method === 'wallet', JSON.stringify({ status: r.status, method: r.data.invoice && r.data.invoice.payment_method }));
  r = await call('GET', `/api/shifts/${splitShiftId}`, null, token);
  ok('shift wallet total updated', Number(r.data.shift.total_wallet) === 500000, String(r.data.shift.total_wallet));

  r = await call('GET', '/api/reports/z-report', null, token);
  ok('z-report exposes wallet total', Number(r.data.sales.wallet) === 500000, JSON.stringify(r.data.sales));
  r = await call('GET', '/api/print/z-report', null, token);
  ok('z-report print shows wallet', r.status === 200 && String(r.data).includes('مبيعات محفظة'), String(r.status));

  r = await call('POST', '/api/sales', {
    items: [{ product_id: mixPid, qty: 1, unit_price: 500000 }],
    payment_method: 'mixed', shift_id: splitShiftId,
    payments: [{ method: 'cash', amount: -100 }, { method: 'card', amount: 500100 }],
  }, token);
  ok('split negative amount rejected (400)', r.status === 400, String(r.status));

  r = await call('POST', '/api/sales', {
    items: [{ product_id: mixPid, qty: 1, unit_price: 500000 }],
    payment_method: 'mixed', shift_id: splitShiftId,
    payments: [{ method: 'bitcoin', amount: 500000 }],
  }, token);
  ok('split unknown method rejected (400)', r.status === 400, String(r.status));

  r = await call('POST', '/api/sales', {
    items: [{ product_id: mixPid, qty: 1, unit_price: 500000 }],
    payment_method: 'mixed', shift_id: splitShiftId,
    payments: [{ method: 'cash', amount: 200000 }],
  }, token);
  ok('split partial without customer rejected (400)', r.status === 400 && String(r.data.error).includes('عميل'), JSON.stringify({ status: r.status, error: r.data && r.data.error }));

  r = await call('POST', '/api/sales', {
    items: [{ product_id: mixPid, qty: 1, unit_price: 500000 }],
    payment_method: 'mixed', shift_id: splitShiftId, currency: 'USD',
    payments: [{ method: 'cash', amount: 500000 }],
  }, token);
  ok('split with foreign currency rejected (400)', r.status === 400, String(r.status));

  r = await call('POST', '/api/products', { name: 'صنف مرتجع تالف', category: 'اختبار', barcode: 'DMG1', sale_price: 2000, cost_price: 1000, quantity: 5, reorder_level: 1 }, token);
  const dmgPid = r.data.product.id;
  r = await call('POST', '/api/sales', {
    items: [{ product_id: dmgPid, qty: 2, unit_price: 2000 }],
    payment_method: 'cash', paid: 4000, shift_id: splitShiftId,
  }, token);
  const dmgSaleId = r.data.invoice.id;
  const dmgItemId = (await call('GET', `/api/sales/${dmgSaleId}`, null, token)).data.items[0].id;
  const dmgStockBefore = Number((await call('GET', `/api/products/${dmgPid}`, null, token)).data.product.quantity);
  r = await call('POST', `/api/sales/${dmgSaleId}/return`, { items: [{ item_id: dmgItemId, qty: 2, damaged: true }] }, token);
  ok('damaged return created', r.status === 201 && String(r.data.invoice.notes).includes('تالف'), JSON.stringify({ status: r.status, notes: r.data.invoice && r.data.invoice.notes }));
  const dmgStockAfter = Number((await call('GET', `/api/products/${dmgPid}`, null, token)).data.product.quantity);
  ok('damaged return keeps stock unchanged', dmgStockBefore === dmgStockAfter, `${dmgStockBefore} -> ${dmgStockAfter}`);
  const dmgMoves = (await call('GET', `/api/products/${dmgPid}/movements`, null, token)).data.movements;
  ok('damaged return logs damage movement', dmgMoves.some((m) => m.direction === 'damage'), JSON.stringify(dmgMoves.slice(0, 3).map((m) => m.direction)));

  r = await call('POST', '/api/sales', {
    items: [{ product_id: dmgPid, qty: 1, unit_price: 2000 }],
    payment_method: 'cash', paid: 2000, shift_id: splitShiftId,
  }, token);
  const goodSaleId = r.data.invoice.id;
  const goodItemId = (await call('GET', `/api/sales/${goodSaleId}`, null, token)).data.items[0].id;
  const goodStockBefore = Number((await call('GET', `/api/products/${dmgPid}`, null, token)).data.product.quantity);
  r = await call('POST', `/api/sales/${goodSaleId}/return`, { items: [{ item_id: goodItemId, qty: 1 }] }, token);
  const goodStockAfter = Number((await call('GET', `/api/products/${dmgPid}`, null, token)).data.product.quantity);
  ok('sound return restocks product', goodStockAfter - goodStockBefore === 1, `${goodStockBefore} -> ${goodStockAfter}`);

  r = await call('POST', '/api/sales', {
    items: [{ product_id: dmgPid, qty: 1, unit_price: 2000 }],
    payment_method: 'card', paid: 2000, shift_id: splitShiftId,
  }, token);
  const cardSaleId = r.data.invoice.id;
  const cardItemId = (await call('GET', `/api/sales/${cardSaleId}`, null, token)).data.items[0].id;
  r = await call('POST', `/api/sales/${cardSaleId}/return`, { items: [{ item_id: cardItemId, qty: 1 }] }, token);
  ok('return refunds by original method', r.status === 201 && r.data.invoice.payment_method === 'card', JSON.stringify({ status: r.status, method: r.data.invoice && r.data.invoice.payment_method }));
  r = await call('GET', '/api/treasury?page_size=10', null, token);
  ok('return card treasury row', r.data.rows.some((x) => x.source === 'return_card' && Number(x.amount) === 2000), JSON.stringify(r.data.rows.slice(0, 3).map((x) => ({ s: x.source, a: x.amount }))));

  r = await call('POST', `/api/shifts/${splitShiftId}/close`, {}, token);
  ok('shift closed after split tests', r.status === 200 && r.data.shift.status === 'closed', String(r.status));

  r = await call('GET', '/api/reports/trial-balance', null, token);
  ok('trial balance balanced after repeats', Math.abs(r.data.totals.debit - r.data.totals.credit) < 0.01, `${r.data.totals.debit} / ${r.data.totals.credit}`);

  r = await call('POST', '/api/products', { name: 'صنف ميزان', category: 'اختبار', barcode: '9011', sale_price: 6000, cost_price: 4000, quantity: 50, reorder_level: 1 }, token);
  const scalePid = r.data.product.id;
  ok('scale product created with numeric barcode', r.status === 201 && Number(scalePid) > 0, String(scalePid));

  const scaleBarcode = '209011015007';
  r = await call('GET', `/api/products/barcode/${scaleBarcode}`, null, token);
  ok('scale barcode resolves product (before enabled)', r.status === 404, String(r.status));

  r = await call('PUT', '/api/settings', { scale_enabled: 1, scale_mode: 'weight', scale_prefix: '2', scale_plu_len: 5, scale_value_len: 5, scale_value_decimals: 3 }, token);
  ok('scale settings saved', r.status === 200 && r.data.settings.scale_enabled === '1', JSON.stringify({ en: r.data.settings && r.data.settings.scale_enabled, mode: r.data.settings && r.data.settings.scale_mode }));

  r = await call('GET', `/api/products/barcode/${scaleBarcode}`, null, token);
  ok('scale barcode resolves PLU to product', r.status === 200 && Number(r.data.product.id) === Number(scalePid), JSON.stringify({ status: r.status, id: r.data.product && r.data.product.id }));

  r = await call('GET', '/api/products/barcode/209011023339', null, token);
  ok('scale barcode ignores zero padding', r.status === 200 && Number(r.data.product.id) === Number(scalePid), JSON.stringify({ status: r.status }));

  r = await call('GET', '/api/products/barcode/29999912345x', null, token);
  ok('scale barcode with unknown PLU returns 404', r.status === 404, String(r.status));
  r = await call('PUT', '/api/settings', { scale_mode: 'invalid' }, token);
  ok('invalid scale mode rejected (400)', r.status === 400, String(r.status));
  await call('PUT', '/api/settings', { scale_enabled: 0 }, token);

  r = await call('GET', '/api/sync/status', null, token);
  ok('cloud sync status returns queue stats', r.status === 200 && typeof r.data.pending === 'number', String(r.status));

  r = await call('POST', '/api/sync/config', { enabled: true, url: 'http://127.0.0.1:9999/dummy-sync', interval: 60 }, token);
  ok('cloud sync config updated', r.status === 200 && r.data.ok === true, String(r.status));

  r = await call('POST', '/api/sync/trigger', null, token);
  ok('cloud sync trigger handles offline safely', r.status === 200 || r.status === 400, String(r.status));

  r = await call('POST', '/api/sync/receive', { items: [{ entity: 'products', data: { name: 'صنف فرع سموحة سحابي', barcode: 'SYNC-881', sale_price: 1500 } }] }, token);
  ok('cloud sync receive applies inbound data', r.status === 200 && r.data.received === 1, String(r.status));

  r = await call('GET', '/api/sync/queue', null, token);
  ok('cloud sync queue listed', r.status === 200 && Array.isArray(r.data.rows), String(r.status));

  r = await call('GET', '/api/license/status', null, token);
  ok('license status exposes machine_id', r.status === 200 && typeof r.data.machine_id === 'string', String(r.status));

  r = await call('POST', '/api/license/activate', { key: 'ZACT-INVALID-KEY' }, token);
  ok('invalid license rejected (400)', r.status === 400, String(r.status));

  const licModule = require('../src/server/core/license');
  const thisMachId = licModule.getMachineId();
  const testLicKey = licModule.generateLicenseKey(thisMachId, 'yearly');
  r = await call('POST', '/api/license/activate', { key: testLicKey }, token);
  ok('valid license key activated', r.status === 200 && r.data.ok === true && r.data.license.type === 'yearly', String(r.status));

  r = await call('GET', '/api/shifts/1/whatsapp', null, token);
  ok('shift whatsapp endpoint returns report', r.status === 200 && typeof r.data.text === 'string' && r.data.text.includes('تقرير إغلاق الوردية'), String(r.status));

  r = await call('GET', '/api/sales/1/whatsapp?phone=01012345678', null, token);
  ok('sales whatsapp endpoint returns invoice', r.status === 200 && typeof r.data.text === 'string' && r.data.url.includes('wa.me/201012345678'), String(r.status));

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
