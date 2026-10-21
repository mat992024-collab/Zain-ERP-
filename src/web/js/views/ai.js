import { api, state, money, num, esc, toast, modal, emptyState, openPrint } from '../core.js';

export async function renderAi(c) {
  const [analysis, forecast, suggest] = await Promise.all([
    api('GET', '/api/ai/analysis'),
    api('GET', '/api/ai/forecast'),
    api('GET', '/api/ai/suggestions'),
  ]);

  const priorityClass = (p) => (p === 'high' ? 'border-rose-500 bg-rose-50' : p === 'medium' ? 'border-amber-500 bg-amber-50' : 'border-emerald-500 bg-emerald-50');
  const conf = (v) => Math.round(Number(v) * 100);

  c.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-graph-up-arrow"></i></div><div><div class="kpi-value">${num(analysis.top.length)}</div><div class="kpi-label">أصناف سريعة الحركة</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-exclamation-triangle"></i></div><div><div class="kpi-value">${num(analysis.low.length)}</div><div class="kpi-label">أصناف تحتاج إعادة طلب</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-hourglass-split"></i></div><div><div class="kpi-value">${num(analysis.slow.length)}</div><div class="kpi-label">أصناف بطيئة الحركة</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-indigo-100 text-indigo-700"><i class="bi bi-cpu"></i></div><div><div class="kpi-value">${num(forecast.list.length)}</div><div class="kpi-label">تنبؤات نفاد المخزون</div></div></div>
    </div>

    <div class="grid grid-cols-12 gap-4">
      <div class="col-span-8 card">
        <div class="p-4 border-b border-slate-100 font-black flex items-center gap-2"><i class="bi bi-magic text-zain-600"></i> تنبؤات نفاد المخزون (الذكاء الاصطناعي)</div>
        <div class="overflow-auto max-h-[46vh]"><table class="w-full">
          <thead><tr><th class="th">الصنف</th><th class="th">المخزون</th><th class="th">معدل البيع/يوم</th><th class="th">أيام حتى النفاد</th><th class="th">كمية مقترحة</th><th class="th">الثقة</th></tr></thead>
          <tbody>${forecast.list.length ? forecast.list.map((f) => `<tr class="tr">
            <td class="td font-bold">${esc(f.product_name)}</td>
            <td class="td ${f.is_below_reorder ? 'text-rose-600 font-bold' : ''}">${num(f.quantity)} <span class="text-xs text-slate-400">/ ${num(f.reorder_level)}</span></td>
            <td class="td">${num(Number(f.predicted_daily).toFixed(1))}</td>
            <td class="td">${f.days_until_stockout != null ? `<span class="badge ${f.days_until_stockout <= 3 ? 'badge-danger' : f.days_until_stockout <= 7 ? 'badge-warn' : 'badge-ok'}">${num(f.days_until_stockout)} يوم</span>` : '—'}</td>
            <td class="td font-bold text-zain-700">${num(f.suggested_qty)}</td>
            <td class="td"><div class="w-20 bg-slate-100 rounded-full h-2"><div class="bg-zain-500 h-2 rounded-full" style="width:${conf(f.confidence)}%"></div></div></td>
          </tr>`).join('') : `<tr><td colspan="6">${emptyState('bi-emoji-smile', 'لا توجد تنبؤات حالياً', 'البيانات غير كافية أو المخزون بحالة جيدة')}</td></tr>`}</tbody>
        </table></div>
      </div>

      <div class="col-span-4 card">
        <div class="p-4 border-b border-slate-100 font-black flex items-center gap-2"><i class="bi bi-lightbulb text-amber-500"></i> مقترحات ذكية</div>
        <div class="p-3 space-y-2 overflow-auto max-h-[46vh]">
          ${suggest.suggestions.length ? suggest.suggestions.map((s) => `<div class="border-r-4 ${priorityClass(s.priority)} rounded-lg p-3 cursor-pointer hover:shadow" data-goto="${s.product_id}">
            <div class="font-bold text-sm">${esc(s.title)}</div><div class="text-xs text-slate-500 mt-1">${esc(s.body)}</div>
          </div>`).join('') : emptyState('bi-lightbulb', 'لا توجد مقترحات حالياً')}
        </div>
      </div>

      <div class="col-span-6 card">
        <div class="p-4 border-b border-slate-100 font-black flex items-center gap-2"><i class="bi bi-fire text-rose-500"></i> الأكثر مبيعاً (30 يوم)</div>
        <div class="overflow-auto max-h-[36vh]"><table class="w-full"><thead><tr><th class="th">الصنف</th><th class="th">المباع</th><th class="th">الإيراد</th></tr></thead>
        <tbody>${analysis.top.length ? analysis.top.map((t) => `<tr class="tr"><td class="td font-bold">${esc(t.name)}</td><td class="td">${num(t.sold)}</td><td class="td text-zain-700 font-bold">${money(t.revenue)}</td></tr>`).join('') : '<tr><td colspan="3" class="td text-center text-slate-400 py-8">لا توجد بيانات</td></tr>'}</tbody></table></div>
      </div>

      <div class="col-span-6 card">
        <div class="p-4 border-b border-slate-100 font-black flex items-center gap-2"><i class="bi bi-arrow-down-circle text-amber-500"></i> إعادة الطلب / بطيئة الحركة</div>
        <div class="overflow-auto max-h-[36vh]"><table class="w-full"><thead><tr><th class="th">الصنف</th><th class="th">المخزون</th><th class="th">حد الطلب</th><th class="th">مباع</th></tr></thead>
        <tbody>${[...analysis.low, ...analysis.slow].length ? [...analysis.low.map((t) => ({ ...t, tag: 'منخفض', sold: '—' })), ...analysis.slow.map((t) => ({ ...t, tag: 'بطيء', sold: t.sold }))].map((t) => `<tr class="tr"><td class="td font-bold">${esc(t.name)} <span class="badge ${t.tag === 'منخفض' ? 'badge-danger' : 'badge-warn'} mr-1">${t.tag}</span></td><td class="td">${num(t.quantity)}</td><td class="td text-slate-500">${num(t.reorder_level)}</td><td class="td">${esc(String(t.sold))}</td></tr>`).join('') : '<tr><td colspan="4" class="td text-center text-slate-400 py-8">لا توجد بيانات</td></tr>'}</tbody></table></div>
      </div>
    </div>`;

  c.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => {
    modal({
      title: 'تفاصيل الصنف',
      size: 'max-w-sm',
      body: `<div class="text-center py-4"><i class="bi bi-cpu text-4xl text-zain-500"></i><p class="mt-3 text-slate-600">انتقل إلى المخزون للاطلاع على تفاصيل الصنف رقم <b>${el.dataset.goto}</b></p></div>`,
      footer: `<button data-close class="btn btn-primary w-full">حسناً</button>`,
    });
  }));
}

export async function renderReports(c) {
  c.innerHTML = `
    <div class="flex gap-2 mb-3">
      <button data-rtab="sales" class="btn btn-primary"><i class="bi bi-graph-up"></i> المبيعات والأرباح</button>
      <button data-rtab="inventory" class="btn btn-ghost"><i class="bi bi-box-seam"></i> تقرير المخزون</button>
      <button data-rtab="tax" class="btn btn-ghost"><i class="bi bi-percent"></i> تقرير الضريبة</button>
    </div>
    <div id="repPane"></div>`;
  const pane = () => c.querySelector('#repPane');
  c.querySelectorAll('[data-rtab]').forEach((b) => b.addEventListener('click', () => {
    c.querySelectorAll('[data-rtab]').forEach((x) => { x.className = 'btn btn-ghost'; });
    b.className = 'btn btn-primary';
    open(b.dataset.rtab);
  }));
  const open = (key) => (key === 'inventory' ? inventory(pane()) : key === 'tax' ? taxReport(pane()) : sales(pane()));
  sales(pane());
}

async function sales(p) {
  const summary = await api('GET', '/api/reports/summary');
  const maxDay = Math.max(1, ...summary.daily.map((d) => Number(d.total)));
  const payLabels = { cash: 'نقدي', card: 'بطاقة', credit: 'آجل', bank: 'بنكي', transfer: 'تحويل' };

  p.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-cart-check"></i></div><div><div class="kpi-value">${money(summary.revenue)}</div><div class="kpi-label">صافي المبيعات (30 يوم)</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-graph-up"></i></div><div><div class="kpi-value">${money(summary.gross_profit)}</div><div class="kpi-label">الربح الإجمالي</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-indigo-100 text-indigo-700"><i class="bi bi-cash-stack"></i></div><div><div class="kpi-value">${money(summary.net_profit)}</div><div class="kpi-label">الربح الصافي</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-receipt-cutoff"></i></div><div><div class="kpi-value">${money(summary.expenses)}</div><div class="kpi-label">المصروفات</div></div></div>
    </div>

    <div class="grid grid-cols-12 gap-4">
      <div class="col-span-8 card p-4">
        <div class="font-black mb-4 flex items-center gap-2"><i class="bi bi-bar-chart text-zain-600"></i> المبيعات اليومية</div>
        <div class="flex items-end gap-2 h-56">
          ${summary.daily.length ? summary.daily.map((d) => `<div class="flex-1 flex flex-col items-center justify-end gap-1 group" title="${esc(d.day)}: ${money(d.total)}">
            <span class="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">${money(d.total, '')}</span>
            <div class="w-full bg-gradient-to-t from-zain-600 to-zain-400 rounded-t-lg transition-all" style="height:${Math.max(4, (Number(d.total) / maxDay) * 100)}%"></div>
            <span class="text-[9px] text-slate-400 rotate-45 origin-right whitespace-nowrap">${esc(String(d.day).slice(5))}</span>
          </div>`).join('') : '<div class="w-full text-center text-slate-400">لا توجد مبيعات في الفترة</div>'}
        </div>
      </div>

      <div class="col-span-4 space-y-4">
        <div class="card p-4">
          <div class="font-black mb-3 flex items-center gap-2"><i class="bi bi-credit-card text-zain-600"></i> المبيعات حسب طريقة الدفع</div>
          ${summary.by_payment.length ? summary.by_payment.map((p) => {
            const pct = summary.revenue ? Math.round((Number(p.total) / Number(summary.sales || 1)) * 100) : 0;
            return `<div class="mb-3"><div class="flex justify-between text-sm mb-1"><span>${esc(payLabels[p.payment_method] || p.payment_method)}</span><span class="font-bold">${money(p.total)}</span></div><div class="w-full bg-slate-100 rounded-full h-2"><div class="bg-zain-500 rounded-full h-2" style="width:${Math.min(100, pct)}%"></div></div></div>`;
          }).join('') : '<div class="text-slate-400 text-sm">لا توجد بيانات</div>'}
        </div>
        <div class="card p-4 space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-slate-500">عدد الفواتير</span><span class="font-bold">${num(summary.sales_count)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">إجمالي المبيعات</span><span class="font-bold">${money(summary.sales)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">المرتجعات</span><span class="font-bold text-rose-600">${money(summary.returns)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">المشتريات</span><span class="font-bold">${money(summary.purchases)}</span></div>
          <div class="flex justify-between border-t border-dashed pt-2"><span class="text-slate-500">تكلفة المبيعات</span><span class="font-bold">${money(summary.cogs)}</span></div>
        </div>
      </div>
    </div>`;
}

async function inventory(p) {
  const data = await api('GET', '/api/reports/inventory');
  const catRows = data.categories.map((c) => `
    <tr class="tr">
      <td class="td font-bold">${esc(c.category)}</td>
      <td class="td">${num(c.items)}</td>
      <td class="td">${num(c.quantity)}</td>
      <td class="td font-bold text-zain-700">${money(c.cost_value, '')}</td>
      <td class="td text-emerald-600">${money(c.sale_value, '')}</td>
    </tr>`).join('');
  const itemRows = data.rows.map((r) => `
    <tr class="tr">
      <td class="td font-bold">${esc(r.name)}</td>
      <td class="td font-mono text-xs">${esc(r.sku || r.barcode || '-')}</td>
      <td class="td text-xs">${esc(r.category || '-')}</td>
      <td class="td ${Number(r.quantity) <= Number(r.reorder_level) ? 'text-rose-600 font-bold' : ''}">${num(r.quantity)}</td>
      <td class="td">${money(r.cost_price, '')}</td>
      <td class="td">${money(r.sale_price, '')}</td>
      <td class="td font-bold">${money(r.cost_value, '')}</td>
      <td class="td text-emerald-600">${money(r.sale_value, '')}</td>
    </tr>`).join('');

  p.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-boxes"></i></div><div><div class="kpi-value">${num(data.totals.items)}</div><div class="kpi-label">عدد الأصناف</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-indigo-100 text-indigo-700"><i class="bi bi-collection"></i></div><div><div class="kpi-value">${num(data.totals.quantity)}</div><div class="kpi-label">إجمالي الكميات</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-cash-coin"></i></div><div><div class="kpi-value">${money(data.totals.cost_value)}</div><div class="kpi-label">قيمة المخزون بالتكلفة</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-graph-up-arrow"></i></div><div><div class="kpi-value">${money(data.totals.sale_value)}</div><div class="kpi-label">قيمة المخزون بالبيع</div></div></div>
    </div>

    <div class="grid grid-cols-12 gap-4">
      <div class="col-span-5 card">
        <div class="p-4 border-b border-slate-100 font-black flex items-center justify-between">
          <span><i class="bi bi-diagram-3 text-zain-600"></i> الملخص حسب التصنيف</span>
          <button id="invPrint" class="btn btn-primary btn-sm"><i class="bi bi-printer"></i> طباعة التقرير</button>
        </div>
        <div class="overflow-auto max-h-[56vh]"><table class="w-full">
          <thead><tr><th class="th">التصنيف</th><th class="th">الأصناف</th><th class="th">الكميات</th><th class="th">قيمة التكلفة</th><th class="th">قيمة البيع</th></tr></thead>
          <tbody>${catRows || `<tr><td colspan="5" class="td text-center text-slate-400 py-8">لا توجد أصناف</td></tr>`}</tbody>
          <tfoot><tr class="tr bg-slate-50">
            <td class="td font-black">الإجمالي</td>
            <td class="td font-black">${num(data.totals.items)}</td>
            <td class="td font-black">${num(data.totals.quantity)}</td>
            <td class="td font-black text-zain-700">${money(data.totals.cost_value, '')}</td>
            <td class="td font-black text-emerald-600">${money(data.totals.sale_value, '')}</td>
          </tr></tfoot>
        </table></div>
      </div>

      <div class="col-span-7 card">
        <div class="p-4 border-b border-slate-100 font-black"><i class="bi bi-list-ul text-zain-600"></i> تفاصيل الأصناف</div>
        <div class="overflow-auto max-h-[56vh]"><table class="w-full">
          <thead><tr><th class="th">الصنف</th><th class="th">الرمز</th><th class="th">التصنيف</th><th class="th">الكمية</th><th class="th">التكلفة</th><th class="th">سعر البيع</th><th class="th">قيمة التكلفة</th><th class="th">قيمة البيع</th></tr></thead>
          <tbody>${itemRows || `<tr><td colspan="8" class="td text-center text-slate-400 py-8">لا توجد أصناف</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>`;

  p.querySelector('#invPrint').addEventListener('click', () => openPrint('/api/print/inventory'));
}

async function taxReport(p) {
  const data = await api('GET', '/api/reports/tax');
  const typeLabels = { sale: 'بيع', return_sale: 'مرتجع بيع', purchase: 'شراء', return_purchase: 'مرتجع شراء' };
  const rows = data.rows.map((r) => `
    <tr class="tr">
      <td class="td font-mono text-xs">${esc(r.invoice_no)}</td>
      <td class="td text-xs">${esc(r.created_at)}</td>
      <td class="td"><span class="badge ${r.type === 'sale' ? 'badge-ok' : r.type.startsWith('return') ? 'badge-danger' : 'badge-info'}">${esc(typeLabels[r.type] || r.type)}</span></td>
      <td class="td">${money(r.subtotal, '')}</td>
      <td class="td font-bold text-zain-700">${money(r.tax, '')}${Number(r.tax_inclusive) ? ' <span class="text-[10px] text-slate-400">(ضمن السعر)</span>' : ''}</td>
      <td class="td">${money(r.total, '')}</td>
    </tr>`).join('');

  p.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-arrow-up-circle"></i></div><div><div class="kpi-value">${money(data.output_tax)}</div><div class="kpi-label">ضريبة المخرجات</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-arrow-down-circle"></i></div><div><div class="kpi-value">${money(data.input_tax)}</div><div class="kpi-label">ضريبة المشتريات</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-bank"></i></div><div><div class="kpi-value">${money(data.net_payable)}</div><div class="kpi-label">صافي المستحق للهيئة</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-indigo-100 text-indigo-700"><i class="bi bi-receipt"></i></div><div><div class="kpi-value">${num(data.rows.length)}</div><div class="kpi-label">فواتير خاضعة للضريبة</div></div></div>
    </div>

    <div class="card">
      <div class="p-4 border-b border-slate-100 font-black flex items-center justify-between">
        <span><i class="bi bi-percent text-zain-600"></i> تفاصيل الضريبة المحصّلة</span>
        <button id="taxPrint" class="btn btn-primary btn-sm"><i class="bi bi-printer"></i> طباعة التقرير</button>
      </div>
      <div class="overflow-auto max-h-[56vh]"><table class="w-full">
        <thead><tr><th class="th">رقم الفاتورة</th><th class="th">التاريخ</th><th class="th">النوع</th><th class="th">قبل الضريبة</th><th class="th">الضريبة</th><th class="th">الإجمالي</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="td text-center text-slate-400 py-8">لا توجد فواتير خاضعة للضريبة</td></tr>`}</tbody>
      </table></div>
    </div>`;

  p.querySelector('#taxPrint').addEventListener('click', () => openPrint('/api/print/tax'));
}
