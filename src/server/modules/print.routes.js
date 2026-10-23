const db = require('../db');
const { sendJson, sendText } = require('../core/http');
const code128 = require('../core/code128');
const statements = require('./statements.routes');
const accounting = require('./accounting.routes');
const vouchers = require('./vouchers.routes');
const currency = require('./currency.routes');
const tpl = require('../core/print-template');

function invoiceCurrency(invoice, settings) {
  const row = currency.findCurrency(invoice.currency);
  const foreign = row && !row.is_base ? row : null;
  const rate = foreign ? Number(foreign.rate) || 1 : 1;
  const symbol = foreign ? (foreign.symbol || foreign.code) : (settings.currency_symbol || 'د.ع');
  return {
    foreign,
    rate,
    symbol,
    convert: (v) => (foreign ? currency.roundTo((Number(v) || 0) / rate, foreign.decimals) : Number(v) || 0),
  };
}

const METHOD_LABELS = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', credit: 'آجل', mixed: 'مختلط' };

function paymentRows(invoice, payments, invCur, cur) {
  if (payments && payments.length) {
    return payments
      .map((p) => `<tr><td>${METHOD_LABELS[p.method] || esc(p.method)}</td><td class="col-price">${money(invCur.convert(p.amount), cur)}</td></tr>`)
      .join('');
  }
  if (!Number(invoice.paid)) return '';
  return `<tr><td>مدفوع (${METHOD_LABELS[invoice.payment_method] || esc(invoice.payment_method)})</td><td class="col-price">${money(invCur.convert(invoice.paid), cur)}</td></tr>`;
}

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function money(v, currency = 'د.ع') {
  return `${(Number(v) || 0).toLocaleString('ar-IQ')} ${currency}`;
}

function htmlDoc(title, bodyCss, body, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" href="data:,"/>
<title>${esc(title)}</title>
${extraHead}
<style>
${bodyCss}
@page { margin: 8mm; }
@media print { .no-print { display: none !important; } }
</style>
</head>
<body>${body}
<div class="no-print" style="text-align:center;margin-top:12px">
  <button onclick="window.print()" style="padding:8px 18px;cursor:pointer;background:#6366f1;color:#fff;border:0;border-radius:8px;font-family:sans-serif">طباعة</button>
</div>
</body></html>`;
}

const A4_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Cairo','Segoe UI',Tahoma,sans-serif; direction: rtl; text-align: right;
         color: #0f172a; margin: 0; padding: 16px; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 3px solid #6366f1; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { margin: 0; font-size: 26px; color: #6366f1; }
  .meta { text-align: left; font-size: 13px; line-height: 1.7; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  table.items th { background: #eef2ff; color: #3730a3; padding: 9px 8px; border: 1px solid #c7d2fe; }
  table.items td { padding: 7px 8px; border: 1px solid #e2e8f0; }
  .item-cell { display: flex; align-items: center; gap: 7px; }
  .item-img { width: 30px; height: 30px; object-fit: cover; border: 1px solid #e2e8f0; border-radius: 5px; background: #f8fafc; }
  .totals { width: 320px; margin: 16px 0 0 auto; font-size: 14px; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed #cbd5e1; }
  .totals .grand { font-weight: bold; font-size: 17px; border-bottom: 0; color: #4338ca; }
  footer { margin-top: 48px; display: flex; justify-content: space-between; font-size: 13px; color: #475569; }
  .badge { display: inline-block; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 4px 12px;
           border-radius: 999px; font-size: 12px; }
  .cards { display: flex; gap: 10px; margin: 12px 0 18px; }
  .cards .box { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; text-align: center; }
  .cards .box .lbl { font-size: 11px; color: #64748b; }
  .cards .box .val { font-size: 17px; font-weight: bold; margin-top: 3px; }
`;

const THERMAL_CSS = (mm) => `
  * { box-sizing: border-box; }
  body { font-family: 'Cairo','Segoe UI',Tahoma,sans-serif; direction: rtl; text-align: right;
         width: ${mm}mm; margin: 0 auto; font-size: ${mm <= 58 ? 10 : 11}px; color: #000; padding: 3mm; }
  .center { text-align: center; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: inherit; }
  th, td { padding: 2px 0; font-weight: normal; vertical-align: top; }
  .col-item { text-align: right; }
  .col-qty, .col-price { text-align: left; white-space: nowrap; }
  .total-row td { font-weight: bold; font-size: ${mm <= 58 ? 11 : 13}px; padding-top: 4px; }
  h2 { font-size: ${mm <= 58 ? 13 : 15}px; margin: 4px 0; }
  .muted { font-size: 10px; }
`;

function fetchInvoice(id) {
  const invoice = db.get(
    `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, u.full_name AS cashier_name
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN users u ON u.id = i.user_id WHERE i.id = ?`,
    [id]
  );
  if (!invoice) return null;
  const items = db.all('SELECT ii.*, p.image AS image FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ?', [id]);
  const payments = db.all('SELECT method, amount FROM invoice_payments WHERE invoice_id = ? ORDER BY id', [id]);
  const settings = db.getSettings();
  return { invoice, items, payments, settings };
}

module.exports = {
  register(router) {
    router.get('/api/print/thermal/:id', (ctx) => {
      const data = fetchInvoice(ctx.params.id);
      if (!data) return sendText(ctx.res, 404, 'Not found', 'text/plain; charset=utf-8');
      const mm = ctx.query.width === '58' ? 58 : 80;
      const { invoice, items, settings } = data;
      const invCur = invoiceCurrency(invoice, settings);
      const cur = invCur.symbol;
      const rows = items
        .map(
          (i) => `<tr>
            <td class="col-item">${esc(i.name)}<br/><span class="muted">${i.qty} × ${money(invCur.convert(i.unit_price), '')}</span></td>
            <td class="col-price">${money(invCur.convert(i.total), '')}</td>
          </tr>`
        )
        .join('');
      const body = `
        <div class="center">${tpl.logoTag(settings)}<h2>${esc(settings.company_name || 'Zain')}</h2>
        <div class="muted">${esc(settings.company_address || '')} ${settings.company_phone ? ' · ' + esc(settings.company_phone) : ''}</div>
        ${tpl.headerExtra(settings)}</div>
        <div class="line"></div>
        <div>رقم: <b>${esc(invoice.invoice_no)}</b></div>
        <div>التاريخ: ${esc(invoice.created_at)}</div>
        ${invoice.customer_name ? `<div>العميل: ${esc(invoice.customer_name)}</div>` : ''}
        <div>الكاشير: ${esc(invoice.cashier_name || '-')}</div>
        <div class="line"></div>
        <table><thead><tr><th class="col-item">الصنف</th><th class="col-price">المبلغ</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="line"></div>
        <table>
          <tr><td>الإجمالي الفرعي</td><td class="col-price">${money(invCur.convert(invoice.subtotal), cur)}</td></tr>
          ${Number(invoice.discount) ? `<tr><td>الخصم</td><td class="col-price">-${money(invCur.convert(invoice.discount), cur)}</td></tr>` : ''}
          ${Number(invoice.tax) ? `<tr><td>الضريبة${Number(invoice.tax_inclusive) ? ' (ضمن السعر)' : ''}</td><td class="col-price">${money(invCur.convert(invoice.tax), cur)}</td></tr>` : ''}
          <tr class="total-row"><td>المجموع</td><td class="col-price">${money(invCur.convert(invoice.total), cur)}</td></tr>
          ${paymentRows(invoice, data.payments, invCur, cur)}
          ${Number(invoice.due) ? `<tr><td>متبقي</td><td class="col-price">${money(invCur.convert(invoice.due), cur)}</td></tr>` : ''}
        </table>
        ${invCur.foreign ? `<div class="center muted">المبلغ بالعملة الأساسية: ${money(invoice.total, settings.currency_symbol || 'د.ع')} — سعر الصرف: 1 ${esc(invCur.foreign.code)} = ${invCur.rate} ${esc(settings.base_currency || 'IQD')}</div>` : ''}
        <div class="line"></div>
        <div class="center muted">${esc(settings.receipt_footer || '')}</div>
        ${tpl.footerExtra(settings)}`;
      sendText(ctx.res, 200, htmlDoc(invoice.invoice_no, THERMAL_CSS(mm) + tpl.extraCss(settings, false), body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/a4/:id', (ctx) => {
      const data = fetchInvoice(ctx.params.id);
      if (!data) return sendText(ctx.res, 404, 'Not found', 'text/plain; charset=utf-8');
      const { invoice, items, settings } = data;
      const invCur = invoiceCurrency(invoice, settings);
      const cur = invCur.symbol;
      const rows = items
        .map(
          (i, idx) => `<tr>
            <td style="width:30px;text-align:center">${idx + 1}</td>
            <td><div class="item-cell">${i.image ? `<img class="item-img" src="${esc(i.image)}" alt="" />` : ''}<span>${esc(i.name)}</span></div></td>
            <td style="text-align:center">${esc(i.unit || 'قطعة')}</td>
            <td style="text-align:center">${i.qty}</td>
            <td style="text-align:left">${money(invCur.convert(i.unit_price), '')}</td>
            <td style="text-align:left">${money(invCur.convert(i.discount), '')}</td>
            <td style="text-align:left">${money(invCur.convert(i.total), '')}</td>
          </tr>`
        )
        .join('');
      const css = A4_CSS;
      const body = `
        <header>
          <div>
            ${tpl.logoTag(settings, 'print-logo logo-inline')}
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
              ${tpl.taxIdLine(settings)}
            </div>
            ${tpl.headerExtra(settings)}
          </div>
          <div class="meta">
            <span class="badge">${invoice.type === 'sale' ? 'فاتورة مبيعات' : invoice.type === 'purchase' ? 'فاتورة مشتريات' : 'فاتورة'}</span><br/><br/>
            <b>${esc(invoice.invoice_no)}</b><br/>
            ${esc(invoice.created_at)}<br/>
            ${invoice.customer_name ? 'العميل: ' + esc(invoice.customer_name) + '<br/>' : ''}
            ${invoice.customer_phone ? 'الهاتف: ' + esc(invoice.customer_phone) + '<br/>' : ''}
            ${settings.print_show_cashier === '0' ? '' : 'الكاشير: ' + esc(invoice.cashier_name || '-')}
          </div>
        </header>
        <table class="items">
          <thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="totals">
          <div><span>الإجمالي الفرعي</span><span>${money(invCur.convert(invoice.subtotal), cur)}</span></div>
          <div><span>الخصم</span><span>${money(invCur.convert(invoice.discount), cur)}</span></div>
          <div><span>الضريبة${Number(invoice.tax_inclusive) ? ' (ضمن السعر)' : ''}</span><span>${money(invCur.convert(invoice.tax), cur)}</span></div>
          <div class="grand"><span>المجموع</span><span>${money(invCur.convert(invoice.total), cur)}</span></div>
          ${data.payments && data.payments.length
            ? data.payments.map((p) => `<div><span>مدفوع ${METHOD_LABELS[p.method] || esc(p.method)}</span><span>${money(invCur.convert(p.amount), cur)}</span></div>`).join('')
            : `<div><span>مدفوع</span><span>${money(invCur.convert(invoice.paid), cur)}</span></div>`}
          <div><span>المتبقي</span><span>${money(invCur.convert(invoice.due), cur)}</span></div>
          ${invCur.foreign ? `<div><span>المبلغ بالعملة الأساسية</span><span>${money(invoice.total, settings.currency_symbol || 'د.ع')}</span></div>` : ''}
        </div>
        <footer>
          <div>${esc(settings.receipt_footer || '')}${tpl.footerExtra(settings)}</div>
          <div style="text-align:left">التوقيع: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc(invoice.invoice_no, css + tpl.extraCss(settings, true), body), 'text/html; charset=utf-8');
    });

    router.post('/api/print/labels', (ctx) => {
      const items = (ctx.body || {}).items || [];
      const settings = db.getSettings();
      const labelW = Number(settings.label_width_mm) || 40;
      const labelH = Number(settings.label_height_mm) || 30;
      const repeats = Math.max(1, Math.min(Number((ctx.body || {}).repeats) || 1, 50));
      const labels = [];
      for (const item of items) {
        const p = item.product_id ? db.get('SELECT * FROM products WHERE id = ?', [item.product_id]) : null;
        const code = (p && p.barcode) || item.barcode || '';
        if (!code) continue;
        const name = (p && p.name) || item.name || '';
        const price = Number((p && p.sale_price) || item.price || 0);
        const sku = (p && (p.part_number || p.sku)) || '';
        const image = (p && p.image) || '';
        for (let r = 0; r < repeats; r++) {
          labels.push({ code, name, price, sku, image });
        }
      }
      const css = `
        * { box-sizing: border-box; }
        body { font-family: 'Cairo','Segoe UI',Tahoma,sans-serif; direction: rtl; margin: 0; padding: 6mm;
               display: flex; flex-wrap: wrap; gap: 4mm; background: #fff; }
        .label { width: ${labelW}mm; height: ${labelH}mm; border: 1px dashed #cbd5e1; padding: 2mm;
                 text-align: center; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
        .label .name { font-size: 9px; font-weight: bold; color: #0f172a; line-height: 1.15; max-height: 22px; overflow: hidden; }
        .label .head { display: flex; align-items: center; gap: 3mm; text-align: right; }
        .label .head img { width: 10mm; height: 10mm; object-fit: cover; border: 1px solid #e2e8f0; border-radius: 2mm; }
        .label .sku { font-size: 7px; color: #64748b; }
        .label .price { font-size: 10px; font-weight: bold; color: #4338ca; }
        .label svg { display: block; margin: 0 auto; }
        .no-print { text-align: center; width: 100%; margin-bottom: 8px; }
        .no-print button { padding: 8px 18px; cursor: pointer; background: #6366f1; color: #fff; border: 0; border-radius: 8px; }
        @media print { .no-print { display: none; } .label { border: 0; } }
        @page { margin: 6mm; }
      `;
      const body = `
        <div class="no-print"><button onclick="window.print()">طباعة الملصقات (${labels.length})</button></div>
        ${labels
          .map(
            (l) => `<div class="label">
              <div class="head">${l.image ? `<img src="${esc(l.image)}" alt="" />` : ''}<div class="name">${esc(l.name)}</div></div>
              ${l.sku ? `<div class="sku">${esc(l.sku)}</div>` : ''}
              <div>${code128.svg(l.code, { width: labelW * 3.4, height: 46, moduleWidth: 1, showText: true, color: '#000' })}</div>
              <div class="price">${money(l.price, settings.currency_symbol || 'د.ع')}</div>
              ${tpl.labelFooter(settings)}
            </div>`
          )
          .join('')}
      `;
      sendText(ctx.res, 200, htmlDoc('ملصقات الباركود', css + tpl.extraCss(settings, false), body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/statement/:kind/:id', (ctx) => {
      const statement = statements.buildStatement(ctx.params.kind, ctx.params.id, {
        from: ctx.query.from || null,
        to: ctx.query.to || null,
      });
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const rows = statement.rows.map((r) => `
        <tr>
          <td style="white-space:nowrap">${esc(r.date)}</td>
          <td>${esc(r.description)}</td>
          <td style="font-family:monospace">${esc(r.ref)}</td>
          <td style="text-align:left">${r.debit ? money(r.debit, '') : '—'}</td>
          <td style="text-align:left">${r.credit ? money(r.credit, '') : '—'}</td>
          <td style="text-align:left;font-weight:bold">${money(r.balance, '')}</td>
        </tr>`).join('');
      const body = `
        <header>
          <div>
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
            </div>
          </div>
          <div class="meta">
            <span class="badge">${esc(statement.title)}</span><br/><br/>
            <b>${esc(statement.party.name)}</b><br/>
            ${statement.party.phone ? 'الهاتف: ' + esc(statement.party.phone) + '<br/>' : ''}
            ${statement.period.from ? `من: ${esc(statement.period.from)}<br/>` : ''}
            ${statement.period.to ? `إلى: ${esc(statement.period.to)}<br/>` : ''}
            تاريخ الإصدار: ${esc(statement.generated_at)}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">الرصيد الافتتاحي</div><div class="val">${money(statement.opening, cur)}</div></div>
          <div class="box"><div class="lbl">مدين (فواتير)</div><div class="val">${money(statement.totals.debit, cur)}</div></div>
          <div class="box"><div class="lbl">دائن (سداد)</div><div class="val">${money(statement.totals.credit, cur)}</div></div>
          <div class="box"><div class="lbl">الرصيد الختامي</div><div class="val" style="color:#4338ca">${money(statement.totals.closing, cur)}</div></div>
        </div>
        <table class="items">
          <thead><tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:18px">لا توجد حركات</td></tr>'}</tbody>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}</div>
          <div style="text-align:left">توقيع ${esc(statement.kind === 'customer' ? 'العميل' : 'المورد')}: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc(statement.title, A4_CSS, body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/income-statement', (ctx) => {
      const data = accounting.buildIncomeStatement(ctx.query);
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const expenseRows = data.expenses_by_category.map((x) => `
        <tr><td>${esc(x.category)}</td><td style="text-align:left">${money(x.amount, '')}</td><td style="text-align:left">${x.count}</td></tr>`).join('');
      const productRows = data.top_products.map((x) => `
        <tr>
          <td>${esc(x.name)}</td>
          <td style="text-align:left">${x.qty}</td>
          <td style="text-align:left">${money(x.revenue, '')}</td>
          <td style="text-align:left">${money(x.cost, '')}</td>
          <td style="text-align:left;font-weight:bold">${money(x.profit, '')}</td>
          <td style="text-align:left">${Number(x.margin_pct).toFixed(1)}%</td>
        </tr>`).join('');
      const body = `
        <header>
          <div>
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
            </div>
          </div>
          <div class="meta">
            <span class="badge">قائمة الدخل</span><br/><br/>
            ${data.period.from ? `من: ${esc(data.period.from)}<br/>` : ''}
            ${data.period.to ? `إلى: ${esc(data.period.to)}<br/>` : ''}
            عدد الفواتير: ${data.sales_count}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">صافي الإيرادات</div><div class="val">${money(data.revenue, cur)}</div></div>
          <div class="box"><div class="lbl">مجمل الربح</div><div class="val" style="color:#059669">${money(data.gross_profit, cur)}</div></div>
          <div class="box"><div class="lbl">المصروفات</div><div class="val" style="color:#e11d48">${money(data.expenses_total, cur)}</div></div>
          <div class="box"><div class="lbl">صافي الربح</div><div class="val" style="color:#4338ca">${money(data.net_profit, cur)}</div></div>
        </div>
        <table class="items">
          <thead><tr><th>البند</th><th style="text-align:left">المبلغ</th><th style="text-align:left">العدد</th></tr></thead>
          <tbody>
            <tr><td>إجمالي المبيعات</td><td style="text-align:left">${money(data.sales_total, '')}</td><td style="text-align:left">${data.sales_count}</td></tr>
            <tr><td>مرتجعات البيع</td><td style="text-align:left">-${money(data.returns_total, '')}</td><td style="text-align:left"></td></tr>
            <tr><td><b>صافي الإيرادات</b></td><td style="text-align:left"><b>${money(data.revenue, '')}</b></td><td style="text-align:left"></td></tr>
            <tr><td>تكلفة البضاعة المباعة</td><td style="text-align:left">-${money(data.cogs, '')}</td><td style="text-align:left"></td></tr>
            <tr><td><b>مجمل الربح</b></td><td style="text-align:left"><b>${money(data.gross_profit, '')}</b></td><td style="text-align:left">${Number(data.gross_margin).toFixed(1)}%</td></tr>
            ${expenseRows}
            <tr><td>إيرادات أخرى</td><td style="text-align:left">+${money(data.other_income, '')}</td><td style="text-align:left"></td></tr>
            <tr><td><b>صافي الربح</b></td><td style="text-align:left"><b>${money(data.net_profit, '')}</b></td><td style="text-align:left">${Number(data.net_margin).toFixed(1)}%</td></tr>
          </tbody>
        </table>
        <h2 style="font-size:16px;margin:22px 0 8px">أكثر الأصناف ربحية</h2>
        <table class="items">
          <thead><tr><th>الصنف</th><th style="text-align:left">الكمية</th><th style="text-align:left">المبيعات</th><th style="text-align:left">التكلفة</th><th style="text-align:left">الربح</th><th style="text-align:left">الهامش</th></tr></thead>
          <tbody>${productRows || '<tr><td colspan="6" style="text-align:center;padding:16px">لا توجد مبيعات</td></tr>'}</tbody>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}</div>
          <div style="text-align:left">المدير: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc('قائمة الدخل', A4_CSS, body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/voucher/:id', (ctx) => {
      const voucher = db.get(
        `SELECT v.*, u.full_name AS user_name FROM vouchers v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = ?`,
        [ctx.params.id]
      );
      if (!voucher) return sendText(ctx.res, 404, 'السند غير موجود', 'text/plain; charset=utf-8');
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const labels = { receipt: 'سند قبض', payout: 'سند صرف', transfer: 'سند نقل' };
      const accountName = (code) => {
        if (!code) return '-';
        const a = db.get('SELECT name FROM accounts WHERE code = ?', [code]);
        return a ? `${code} - ${a.name}` : code;
      };
      const body = `
        <header>
          <div>
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
            </div>
          </div>
          <div class="meta">
            <span class="badge">${esc(labels[voucher.type] || voucher.type)}</span><br/><br/>
            رقم السند: ${esc(voucher.voucher_no)}<br/>
            التاريخ: ${esc(voucher.date || voucher.created_at)}<br/>
            ${voucher.user_name ? 'المستخدم: ' + esc(voucher.user_name) + '<br/>' : ''}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">المبلغ</div><div class="val">${money(voucher.amount, cur)}</div></div>
          <div class="box"><div class="lbl">${voucher.type === 'transfer' ? 'من حساب' : 'الطرف'}</div><div class="val" style="font-size:14px">${esc(voucher.type === 'transfer' ? accountName(voucher.from_account) : (voucher.partner_name || '—'))}</div></div>
          <div class="box"><div class="lbl">${voucher.type === 'transfer' ? 'إلى حساب' : 'طريقة الدفع'}</div><div class="val" style="font-size:14px">${esc(voucher.type === 'transfer' ? accountName(voucher.to_account) : (voucher.method === 'cash' ? 'نقدي' : voucher.method === 'card' ? 'بطاقة' : voucher.method))}</div></div>
        </div>
        <table class="items">
          <tbody>
            <tr><th style="width:180px">البيان</th><td>${esc(voucher.description || labels[voucher.type] || '')}</td></tr>
            <tr><th>المبلغ كتابةً</th><td>${esc((Number(voucher.amount) || 0).toLocaleString('ar-IQ'))} ${esc(cur)}</td></tr>
          </tbody>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}</div>
          <div style="display:flex;gap:60px">
            <span>المستلم: ....................</span>
            <span>المحاسب: ....................</span>
            <span>المدير: ....................</span>
          </div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc(labels[voucher.type] || 'سند', A4_CSS, body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/z-report', (ctx) => {
      const data = vouchers.buildZReport(ctx.query.date);
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const productRows = data.top_products.map((p) => `
        <tr><td>${esc(p.name)}</td><td style="text-align:left">${p.qty}</td><td style="text-align:left">${money(p.total, '')}</td></tr>`).join('');
      const hourRows = data.hourly.map((h) => `
        <tr><td>${esc(h.hour)}:00</td><td style="text-align:left">${h.count}</td><td style="text-align:left">${money(h.total, '')}</td></tr>`).join('');
      const body = `
        <header>
          <div>
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
            </div>
          </div>
          <div class="meta">
            <span class="badge">تقرير Z</span><br/><br/>
            التاريخ: ${esc(data.date)}<br/>
            وقت الإصدار: ${esc(new Date(data.generated_at).toLocaleString('ar-IQ'))}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">عدد الفواتير</div><div class="val">${data.sales.count}</div></div>
          <div class="box"><div class="lbl">صافي المبيعات</div><div class="val">${money(data.net_sales, cur)}</div></div>
          <div class="box"><div class="lbl">النقد المتوقع</div><div class="val">${money(data.expected_cash, cur)}</div></div>
        </div>
        <table class="items">
          <thead><tr><th>البند</th><th style="text-align:left">المبلغ</th><th style="text-align:left">العدد</th></tr></thead>
          <tbody>
            <tr><td>مبيعات نقدية</td><td style="text-align:left">${money(data.sales.cash, '')}</td><td style="text-align:left">${data.sales.count}</td></tr>
            <tr><td>مبيعات بطاقة</td><td style="text-align:left">${money(data.sales.card, '')}</td><td style="text-align:left"></td></tr>
            <tr><td>مبيعات محفظة</td><td style="text-align:left">${money(data.sales.wallet || 0, '')}</td><td style="text-align:left"></td></tr>
            <tr><td>مبيعات آجلة</td><td style="text-align:left">${money(data.sales.credit, '')}</td><td style="text-align:left"></td></tr>
            <tr><td>مرتجعات</td><td style="text-align:left">-${money(data.returns.total, '')}</td><td style="text-align:left">${data.returns.count}</td></tr>
            <tr><td><b>صافي المبيعات</b></td><td style="text-align:left"><b>${money(data.net_sales, '')}</b></td><td style="text-align:left"></td></tr>
            <tr><td>مصروفات</td><td style="text-align:left">-${money(data.expenses.total, '')}</td><td style="text-align:left">${data.expenses.count}</td></tr>
            <tr><td>سندات قبض</td><td style="text-align:left">+${money(data.vouchers.receipt.total, '')}</td><td style="text-align:left">${data.vouchers.receipt.count}</td></tr>
            <tr><td>سندات صرف</td><td style="text-align:left">-${money(data.vouchers.payout.total, '')}</td><td style="text-align:left">${data.vouchers.payout.count}</td></tr>
            <tr><td>سندات نقل</td><td style="text-align:left">${money(data.vouchers.transfer.total, '')}</td><td style="text-align:left">${data.vouchers.transfer.count}</td></tr>
            <tr><td>حركة نقدية داخل/خارج</td><td style="text-align:left">${money(data.cash_movement.in, '')} / ${money(data.cash_movement.out, '')}</td><td style="text-align:left"></td></tr>
            <tr><td><b>الرصيد النقدي المتوقع</b></td><td style="text-align:left"><b>${money(data.expected_cash, '')}</b></td><td style="text-align:left"></td></tr>
          </tbody>
        </table>
        <h2 style="font-size:16px;margin:22px 0 8px">المبيعات حسب الساعة</h2>
        <table class="items">
          <thead><tr><th>الساعة</th><th style="text-align:left">العدد</th><th style="text-align:left">المبلغ</th></tr></thead>
          <tbody>${hourRows || '<tr><td colspan="3" style="text-align:center;padding:16px">لا توجد مبيعات</td></tr>'}</tbody>
        </table>
        <h2 style="font-size:16px;margin:22px 0 8px">الأصناف الأكثر مبيعاً</h2>
        <table class="items">
          <thead><tr><th>الصنف</th><th style="text-align:left">الكمية</th><th style="text-align:left">المبلغ</th></tr></thead>
          <tbody>${productRows || '<tr><td colspan="3" style="text-align:center;padding:16px">لا توجد مبيعات</td></tr>'}</tbody>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}</div>
          <div style="text-align:left">مدير المبيعات: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc('تقرير Z', A4_CSS, body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/inventory', (ctx) => {
      const data = accounting.buildInventoryReport(ctx.query);
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const itemRows = data.rows.map((r) => `
        <tr>
          <td>${esc(r.name)}</td>
          <td style="font-family:monospace;font-size:11px">${esc(r.sku || r.barcode || '')}</td>
          <td>${esc(r.category || '')}</td>
          <td style="text-align:left">${r.quantity}</td>
          <td style="text-align:left">${money(r.cost_price, '')}</td>
          <td style="text-align:left">${money(r.sale_price, '')}</td>
          <td style="text-align:left;font-weight:bold">${money(r.cost_value, '')}</td>
          <td style="text-align:left">${money(r.sale_value, '')}</td>
        </tr>`).join('');
      const catRows = data.categories.map((c) => `
        <tr>
          <td>${esc(c.category)}</td>
          <td style="text-align:left">${c.items}</td>
          <td style="text-align:left">${c.quantity}</td>
          <td style="text-align:left;font-weight:bold">${money(c.cost_value, '')}</td>
          <td style="text-align:left">${money(c.sale_value, '')}</td>
        </tr>`).join('');
      const body = `
        <header>
          <div>
            ${tpl.logoTag(settings, 'print-logo logo-inline')}
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
              ${tpl.taxIdLine(settings)}
            </div>
          </div>
          <div class="meta">
            <span class="badge">تقرير المخزون</span><br/><br/>
            وقت الإصدار: ${esc(data.generated_at)}<br/>
            ${ctx.query.category ? `التصنيف: ${esc(ctx.query.category)}<br/>` : ''}
            ${ctx.query.search ? `بحث: ${esc(ctx.query.search)}<br/>` : ''}
            عدد الأصناف: ${data.totals.items}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">عدد الأصناف</div><div class="val">${data.totals.items}</div></div>
          <div class="box"><div class="lbl">إجمالي الكميات</div><div class="val">${data.totals.quantity}</div></div>
          <div class="box"><div class="lbl">قيمة المخزون بالتكلفة</div><div class="val" style="color:#4338ca">${money(data.totals.cost_value, cur)}</div></div>
          <div class="box"><div class="lbl">قيمة المخزون بالبيع</div><div class="val" style="color:#059669">${money(data.totals.sale_value, cur)}</div></div>
        </div>
        <h2 style="font-size:16px;margin:22px 0 8px">الملخص حسب التصنيف</h2>
        <table class="items">
          <thead><tr><th>التصنيف</th><th style="text-align:left">الأصناف</th><th style="text-align:left">الكميات</th><th style="text-align:left">قيمة التكلفة</th><th style="text-align:left">قيمة البيع</th></tr></thead>
          <tbody>${catRows || '<tr><td colspan="5" style="text-align:center;padding:16px">لا توجد أصناف</td></tr>'}</tbody>
        </table>
        <h2 style="font-size:16px;margin:22px 0 8px">تفاصيل الأصناف</h2>
        <table class="items">
          <thead><tr><th>الصنف</th><th>الرمز</th><th>التصنيف</th><th style="text-align:left">الكمية</th><th style="text-align:left">التكلفة</th><th style="text-align:left">سعر البيع</th><th style="text-align:left">قيمة التكلفة</th><th style="text-align:left">قيمة البيع</th></tr></thead>
          <tbody>${itemRows || '<tr><td colspan="8" style="text-align:center;padding:16px">لا توجد أصناف</td></tr>'}</tbody>
          <tfoot><tr>
            <td colspan="3"><b>الإجمالي</b></td>
            <td style="text-align:left"><b>${data.totals.quantity}</b></td>
            <td style="text-align:left"></td>
            <td style="text-align:left"></td>
            <td style="text-align:left"><b>${money(data.totals.cost_value, '')}</b></td>
            <td style="text-align:left"><b>${money(data.totals.sale_value, '')}</b></td>
          </tr></tfoot>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}${tpl.footerExtra(settings)}</div>
          <div style="text-align:left">أمين المخزن: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc('تقرير المخزون', A4_CSS + tpl.extraCss(settings, true), body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/tax', (ctx) => {
      const data = accounting.buildTaxReport(ctx.query);
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const typeLabels = { sale: 'بيع', return_sale: 'مرتجع بيع', purchase: 'شراء', return_purchase: 'مرتجع شراء' };
      const rows = data.rows.map((r) => `
        <tr>
          <td style="font-family:monospace;font-size:11px">${esc(r.invoice_no)}</td>
          <td style="font-size:11px">${esc(r.created_at)}</td>
          <td>${esc(typeLabels[r.type] || r.type)}</td>
          <td style="text-align:left">${money(r.subtotal, '')}</td>
          <td style="text-align:left;font-weight:bold">${money(r.tax, '')}${Number(r.tax_inclusive) ? ' (ضمن السعر)' : ''}</td>
          <td style="text-align:left">${money(r.total, '')}</td>
        </tr>`).join('');
      const body = `
        <header>
          <div>
            ${tpl.logoTag(settings, 'print-logo logo-inline')}
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
              ${tpl.taxIdLine(settings)}
            </div>
          </div>
          <div class="meta">
            <span class="badge">تقرير الضريبة</span><br/><br/>
            عدد الفواتير: ${data.rows.length}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">ضريبة المخرجات</div><div class="val" style="color:#059669">${money(data.output_tax, cur)}</div></div>
          <div class="box"><div class="lbl">ضريبة المشتريات</div><div class="val" style="color:#b45309">${money(data.input_tax, cur)}</div></div>
          <div class="box"><div class="lbl">صافي المستحق</div><div class="val" style="color:#4338ca">${money(data.net_payable, cur)}</div></div>
        </div>
        <h2 style="font-size:16px;margin:22px 0 8px">تفاصيل الفواتير الخاضعة للضريبة</h2>
        <table class="items">
          <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>النوع</th><th style="text-align:left">قبل الضريبة</th><th style="text-align:left">الضريبة</th><th style="text-align:left">الإجمالي</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:16px">لا توجد فواتير خاضعة للضريبة</td></tr>'}</tbody>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}${tpl.footerExtra(settings)}</div>
          <div style="text-align:left">المحاسب: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc('تقرير الضريبة', A4_CSS + tpl.extraCss(settings, true), body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/sales-analysis', (ctx) => {
      const data = accounting.buildSalesAnalysis(ctx.query);
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const prodRows = data.products.map((r) => `
        <tr>
          <td>${esc(r.name)}</td>
          <td style="text-align:left">${r.qty}</td>
          <td style="text-align:left">${r.invoices}</td>
          <td style="text-align:left">${money(r.revenue, '')}</td>
          <td style="text-align:left">${money(r.cost, '')}</td>
          <td style="text-align:left;font-weight:bold">${money(r.profit, '')}</td>
          <td style="text-align:left">${r.margin}%</td>
        </tr>`).join('');
      const custRows = data.customers.map((r) => `
        <tr>
          <td>${esc(r.name)}</td>
          <td style="font-family:monospace;font-size:11px">${esc(r.phone || '')}</td>
          <td style="text-align:left">${r.invoices}</td>
          <td style="text-align:left;font-weight:bold">${money(r.total, '')}</td>
          <td style="text-align:left">${money(r.paid, '')}</td>
          <td style="text-align:left">${money(r.due, '')}</td>
        </tr>`).join('');
      const dayRows = data.daily.map((d) => `
        <tr>
          <td>${esc(d.day)}</td>
          <td style="text-align:left">${d.invoices}</td>
          <td style="text-align:left;font-weight:bold">${money(d.total, '')}</td>
        </tr>`).join('');
      const body = `
        <header>
          <div>
            ${tpl.logoTag(settings, 'print-logo logo-inline')}
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
              ${tpl.taxIdLine(settings)}
            </div>
          </div>
          <div class="meta">
            <span class="badge">تحليل المبيعات</span><br/><br/>
            وقت الإصدار: ${esc(data.generated_at)}<br/>
            ${ctx.query.from ? `من: ${esc(ctx.query.from)}<br/>` : ''}
            ${ctx.query.to ? `إلى: ${esc(ctx.query.to)}<br/>` : ''}
            عدد الفواتير: ${data.totals.invoices}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">صافي المبيعات</div><div class="val" style="color:#059669">${money(data.totals.revenue, cur)}</div></div>
          <div class="box"><div class="lbl">عدد الفواتير</div><div class="val">${data.totals.invoices}</div></div>
          <div class="box"><div class="lbl">متوسط الفاتورة</div><div class="val" style="color:#4338ca">${money(data.totals.avg_ticket, cur)}</div></div>
          <div class="box"><div class="lbl">الربح الإجمالي</div><div class="val" style="color:#b45309">${money(data.totals.profit, cur)}</div></div>
        </div>
        <h2 style="font-size:16px;margin:22px 0 8px">الأصناف الأكثر مبيعاً</h2>
        <table class="items">
          <thead><tr><th>الصنف</th><th style="text-align:left">الكمية</th><th style="text-align:left">الفواتير</th><th style="text-align:left">المبيعات</th><th style="text-align:left">التكلفة</th><th style="text-align:left">الربح</th><th style="text-align:left">الهامش</th></tr></thead>
          <tbody>${prodRows || '<tr><td colspan="7" style="text-align:center;padding:16px">لا توجد مبيعات</td></tr>'}</tbody>
        </table>
        <h2 style="font-size:16px;margin:22px 0 8px">المبيعات حسب العميل</h2>
        <table class="items">
          <thead><tr><th>العميل</th><th>الهاتف</th><th style="text-align:left">الفواتير</th><th style="text-align:left">الإجمالي</th><th style="text-align:left">المدفوع</th><th style="text-align:left">المتبقي</th></tr></thead>
          <tbody>${custRows || '<tr><td colspan="6" style="text-align:center;padding:16px">لا يوجد عملاء</td></tr>'}</tbody>
        </table>
        <h2 style="font-size:16px;margin:22px 0 8px">المبيعات اليومية</h2>
        <table class="items">
          <thead><tr><th>اليوم</th><th style="text-align:left">الفواتير</th><th style="text-align:left">الإجمالي</th></tr></thead>
          <tbody>${dayRows || '<tr><td colspan="3" style="text-align:center;padding:16px">لا توجد بيانات</td></tr>'}</tbody>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}${tpl.footerExtra(settings)}</div>
          <div style="text-align:left">المحاسب: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc('تحليل المبيعات', A4_CSS + tpl.extraCss(settings, true), body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/account/:id', (ctx) => {
      const account = db.get('SELECT * FROM accounts WHERE id = ?', [ctx.params.id]);
      if (!account) return sendText(ctx.res, 404, 'الحساب غير موجود', 'text/plain; charset=utf-8');
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const entries = db.all(
        `SELECT * FROM account_entries WHERE account_id = ? ORDER BY id ASC LIMIT 2000`, [ctx.params.id]
      );
      let running = 0;
      const rows = entries.map((e) => {
        const debit = e.direction === 'debit' ? Number(e.amount) : 0;
        const credit = e.direction === 'credit' ? Number(e.amount) : 0;
        running += debit - credit;
        return `
        <tr>
          <td style="white-space:nowrap">${esc(String(e.created_at || '').slice(0, 16))}</td>
          <td>${esc(e.description || '')}</td>
          <td style="font-family:monospace">${esc(e.ref || '')}</td>
          <td style="text-align:left">${debit ? money(debit, '') : '—'}</td>
          <td style="text-align:left">${credit ? money(credit, '') : '—'}</td>
          <td style="text-align:left;font-weight:bold">${money(running, '')}</td>
        </tr>`;
      }).join('');
      const body = `
        <header>
          <div>
            ${tpl.logoTag(settings, 'print-logo logo-inline')}
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
            </div>
          </div>
          <div class="meta">
            <span class="badge">دفتر أستاذ الحساب</span><br/><br/>
            <b>${esc(account.code)} — ${esc(account.name)}</b><br/>
            النوع: ${esc({ asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات', cash: 'نقدية' }[account.type] || account.type)}<br/>
            تاريخ الإصدار: ${esc(new Date().toLocaleString('ar-IQ'))}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">عدد القيود</div><div class="val">${entries.length}</div></div>
          <div class="box"><div class="lbl">إجمالي المدين</div><div class="val">${money(entries.reduce((s, e) => s + (e.direction === 'debit' ? Number(e.amount) : 0), 0), cur)}</div></div>
          <div class="box"><div class="lbl">إجمالي الدائن</div><div class="val">${money(entries.reduce((s, e) => s + (e.direction === 'credit' ? Number(e.amount) : 0), 0), cur)}</div></div>
          <div class="box"><div class="lbl">الرصيد</div><div class="val" style="color:#4338ca">${money(running, cur)}</div></div>
        </div>
        <table class="items">
          <thead><tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:18px">لا توجد قيود</td></tr>'}</tbody>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}${tpl.footerExtra(settings)}</div>
          <div style="text-align:left">المحاسب: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc(`دفتر ${account.name}`, A4_CSS + tpl.extraCss(settings, true), body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/product-movements/:id', (ctx) => {
      const product = db.get('SELECT * FROM products WHERE id = ?', [ctx.params.id]);
      if (!product) return sendText(ctx.res, 404, 'الصنف غير موجود', 'text/plain; charset=utf-8');
      const settings = db.getSettings();
      const cur = settings.currency_symbol || 'د.ع';
      const movements = db.all(
        `SELECT m.*, u.full_name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 1000`, [ctx.params.id]
      );
      const rows = movements.map((m) => `
        <tr>
          <td style="white-space:nowrap">${esc(String(m.created_at || '').slice(0, 16))}</td>
          <td>${esc(m.direction === 'in' ? 'وارد' : m.direction === 'out' ? 'منصرف' : 'تسوية')}</td>
          <td>${esc(m.reason || '')}</td>
          <td style="font-family:monospace">${esc(m.ref_table || '')}${m.ref_id ? ' #' + m.ref_id : ''}</td>
          <td style="text-align:left">${m.direction === 'out' ? '-' : m.direction === 'in' ? '+' : ''}${m.qty}</td>
          <td style="text-align:left;font-weight:bold">${m.balance_after}</td>
          <td>${esc(m.user_name || '')}</td>
        </tr>`).join('');
      const body = `
        <header>
          <div>
            ${tpl.logoTag(settings, 'print-logo logo-inline')}
            <h1>${esc(settings.company_name || 'Zain ERP')}</h1>
            <div style="font-size:13px;color:#475569;margin-top:6px">
              ${esc(settings.company_address || '')}<br/>
              ${settings.company_phone ? 'هاتف: ' + esc(settings.company_phone) : ''}
            </div>
          </div>
          <div class="meta">
            <span class="badge">تقرير حركة صنف</span><br/><br/>
            <b>${esc(product.name)}</b><br/>
            ${product.sku ? 'الرمز: ' + esc(product.sku) + '<br/>' : ''}
            ${product.barcode ? 'الباركود: ' + esc(product.barcode) + '<br/>' : ''}
            تاريخ الإصدار: ${esc(new Date().toLocaleString('ar-IQ'))}
          </div>
        </header>
        <div class="cards">
          <div class="box"><div class="lbl">الرصيد الحالي</div><div class="val">${product.quantity} ${esc(product.unit || '')}</div></div>
          <div class="box"><div class="lbl">تكلفة الوحدة</div><div class="val">${money(product.cost_price, cur)}</div></div>
          <div class="box"><div class="lbl">سعر البيع</div><div class="val">${money(product.sale_price, cur)}</div></div>
          <div class="box"><div class="lbl">عدد الحركات</div><div class="val">${movements.length}</div></div>
        </div>
        <table class="items">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>السبب</th><th>المرجع</th><th>الكمية</th><th>الرصيد بعدها</th><th>المستخدم</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:18px">لا توجد حركات</td></tr>'}</tbody>
        </table>
        <footer>
          <div>${esc(settings.receipt_footer || '')}${tpl.footerExtra(settings)}</div>
          <div style="text-align:left">أمين المخزن: ....................</div>
        </footer>`;
      sendText(ctx.res, 200, htmlDoc(`حركة ${product.name}`, A4_CSS + tpl.extraCss(settings, true), body), 'text/html; charset=utf-8');
    });

    router.get('/api/print/barcode/:productId', (ctx) => {
      const p = db.get('SELECT * FROM products WHERE id = ?', [ctx.params.productId]);
      if (!p) return sendText(ctx.res, 404, 'Not found', 'text/plain; charset=utf-8');
      sendJson(ctx.res, 200, {
        barcode: p.barcode,
        svg: code128.svg(p.barcode || '', { width: 260, height: 60, showText: true }),
      });
    });
  },
};
