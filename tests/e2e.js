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

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
