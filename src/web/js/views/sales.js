import { api, state, money, num, esc, toast, modal, confirmBox, field, openPrint, formToObject } from '../core.js';

const TYPE_LABELS = { sale: 'بيع', return_sale: 'مرتجع بيع', purchase: 'شراء', return_purchase: 'مرتجع شراء' };

export async function renderSales(c) {
  let page = 1;
  let filter = { type: '', from: '', to: '', search: '' };
  c.innerHTML = `
    <div class="card">
      <div class="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
        <input id="sSearch" class="field !w-56" placeholder="رقم الفاتورة / العميل" />
        <select id="sType" class="field !w-40">
          <option value="">كل الأنواع</option>
          <option value="sale">بيع</option>
          <option value="return_sale">مرتجع بيع</option>
          <option value="purchase">شراء</option>
        </select>
        <input id="sFrom" type="date" class="field !w-40" />
        <input id="sTo" type="date" class="field !w-40" />
        <button id="sApply" class="btn btn-primary"><i class="bi bi-funnel"></i> تصفية</button>
        <div class="ml-auto text-lg font-black text-zain-700" id="sTotal"></div>
      </div>
      <div class="overflow-auto max-h-[calc(100vh-230px)]">
        <table class="w-full">
          <thead><tr><th class="th">الفاتورة</th><th class="th">التاريخ</th><th class="th">النوع</th><th class="th">العميل/المورد</th><th class="th">الأصناف</th><th class="th">الدفع</th><th class="th">الإجمالي</th><th class="th">المتبقي</th><th class="th"></th></tr></thead>
          <tbody id="sBody"></tbody>
        </table>
      </div>
      <div class="p-3 flex justify-between items-center border-t border-slate-100 text-sm">
        <span id="sCount" class="text-slate-500"></span>
        <div class="flex gap-2"><button id="sPrev" class="btn btn-ghost btn-sm">السابق</button><button id="sNext" class="btn btn-ghost btn-sm">التالي</button></div>
      </div>
    </div>`;

  const load = async () => {
    const q = new URLSearchParams({ page, page_size: 50 });
    Object.entries(filter).forEach(([k, v]) => { if (v) q.set(k, v); });
    const data = await api('GET', '/api/sales?' + q.toString());
    c.querySelector('#sCount').textContent = `عدد الفواتير: ${data.total}`;
    c.querySelector('#sTotal').textContent = `الإجمالي: ${money(data.sum_total)}`;
    c.querySelector('#sBody').innerHTML = data.rows.length ? data.rows.map((r) => `
      <tr class="tr">
        <td class="td font-mono text-xs font-bold text-zain-700">${esc(r.invoice_no)}</td>
        <td class="td text-xs">${esc(r.created_at)}</td>
        <td class="td"><span class="badge ${r.type === 'sale' ? 'badge-ok' : r.type === 'purchase' ? 'badge-info' : 'badge-warn'}">${TYPE_LABELS[r.type] || r.type}</span></td>
        <td class="td">${esc(r.customer_name || r.supplier_name || 'نقدي')}</td>
        <td class="td">${r.items_count}</td>
        <td class="td text-xs">${r.payment_method}</td>
        <td class="td font-bold">${money(r.total)}</td>
        <td class="td ${Number(r.due) > 0 ? 'text-rose-600 font-bold' : ''}">${money(r.due)}</td>
        <td class="td"><div class="flex gap-1">
          <button data-view="${r.id}" class="btn btn-ghost btn-sm"><i class="bi bi-eye"></i></button>
          <button data-print="${r.id}" class="btn btn-ghost btn-sm"><i class="bi bi-printer"></i></button>
          ${r.type === 'sale' ? `<button data-ret="${r.id}" class="btn btn-ghost btn-sm text-amber-600"><i class="bi bi-arrow-return-right"></i></button>` : ''}
        </div></td>
      </tr>`).join('') : `<tr><td colspan="9" class="td text-center text-slate-400 py-10">لا توجد فواتير</td></tr>`;
    c.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => view(+b.dataset.view)));
    c.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => printMenu(+b.dataset.print)));
    c.querySelectorAll('[data-ret]').forEach((b) => b.addEventListener('click', () => salesReturn(+b.dataset.ret, load)));
  };

  c.querySelector('#sApply').addEventListener('click', () => {
    filter = {
      search: c.querySelector('#sSearch').value,
      type: c.querySelector('#sType').value,
      from: c.querySelector('#sFrom').value,
      to: c.querySelector('#sTo').value,
    };
    page = 1;
    load();
  });
  c.querySelector('#sPrev').addEventListener('click', () => { if (page > 1) { page--; load(); } });
  c.querySelector('#sNext').addEventListener('click', () => { page++; load(); });

  async function view(id) {
    const data = await api('GET', `/api/sales/${id}`);
    const inv = data.invoice;
    modal({
      title: `فاتورة ${inv.invoice_no}`,
      size: 'max-w-3xl',
      body: `
        <div class="grid grid-cols-4 gap-3 mb-4 text-center">
          <div class="card p-3"><div class="text-xs text-slate-400">النوع</div><div class="font-bold">${TYPE_LABELS[inv.type] || inv.type}</div></div>
          <div class="card p-3"><div class="text-xs text-slate-400">التاريخ</div><div class="font-bold text-sm">${esc(inv.created_at)}</div></div>
          <div class="card p-3"><div class="text-xs text-slate-400">العميل</div><div class="font-bold">${esc(inv.customer_name || inv.supplier_name || 'نقدي')}</div></div>
          <div class="card p-3"><div class="text-xs text-slate-400">الدفع</div><div class="font-bold">${esc(inv.payment_method)}</div></div>
        </div>
        <table class="w-full"><thead><tr><th class="th">الصنف</th><th class="th">الكمية</th><th class="th">السعر</th><th class="th">الخصم</th><th class="th">الإجمالي</th></tr></thead>
        <tbody>${data.items.map((i) => `<tr class="tr"><td class="td">${esc(i.name)}</td><td class="td">${num(i.qty)} ${esc(i.unit || '')}</td><td class="td">${money(i.unit_price, '')}</td><td class="td">${money(i.discount, '')}</td><td class="td font-bold">${money(i.total)}</td></tr>`).join('')}</tbody></table>
        <div class="flex justify-end mt-4">
          <div class="w-72 space-y-1.5 text-sm">
            <div class="flex justify-between"><span class="text-slate-500">الإجمالي الفرعي</span><span>${money(inv.subtotal)}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">الخصم</span><span>${money(inv.discount)}</span></div>
            <div class="flex justify-between font-black text-lg text-zain-700 border-t border-dashed pt-2"><span>المجموع</span><span>${money(inv.total)}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">مدفوع</span><span>${money(inv.paid)}</span></div>
            <div class="flex justify-between text-rose-600 font-bold"><span>متبقي</span><span>${money(inv.due)}</span></div>
          </div>
        </div>`,
      footer: `<button data-close class="btn btn-ghost">إغلاق</button>
        <button id="vThermal" class="btn btn-primary"><i class="bi bi-receipt"></i> حراري</button>
        <button id="vA4" class="btn btn-ghost"><i class="bi bi-file-earmark-text"></i> A4</button>`,
      onMount(wrap, close) {
        wrap.querySelector('#vThermal').addEventListener('click', () => openPrint(`/api/print/thermal/${id}?width=${state.settings.printer_type === 'thermal58' ? 58 : 80}`));
        wrap.querySelector('#vA4').addEventListener('click', () => openPrint(`/api/print/a4/${id}`));
      },
    });
  }

  function printMenu(id) {
    modal({
      title: 'طباعة الفاتورة',
      size: 'max-w-sm',
      body: `<div class="grid gap-2">
        <button id="pThermal80" class="btn btn-primary"><i class="bi bi-receipt"></i> طابعة حرارية 80mm</button>
        <button id="pThermal58" class="btn btn-ghost"><i class="bi bi-receipt"></i> طابعة حرارية 58mm</button>
        <button id="pA4" class="btn btn-ghost"><i class="bi bi-file-earmark-text"></i> ورقة A4</button>
      </div>`,
      onMount(wrap, close) {
        wrap.querySelector('#pThermal80').addEventListener('click', () => { openPrint(`/api/print/thermal/${id}?width=80`); close(); });
        wrap.querySelector('#pThermal58').addEventListener('click', () => { openPrint(`/api/print/thermal/${id}?width=58`); close(); });
        wrap.querySelector('#pA4').addEventListener('click', () => { openPrint(`/api/print/a4/${id}`); close(); });
      },
    });
  }

  async function salesReturn(id, reload) {
    const data = await api('GET', `/api/sales/${id}`);
    if (data.invoice.type !== 'sale') { toast('يمكن إرجاع فواتير البيع فقط', 'error'); return; }
    if (!(await confirmBox('إرجاع كامل الفاتورة وإعادة الأصناف للمخزون؟'))) return;
    try {
      await api('POST', `/api/sales/${id}/return`, {});
      toast('تم إنشاء مرتجع البيع', 'success');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  load();
}

export async function renderPurchases(c) {
  const [suppliers, products] = await Promise.all([
    api('GET', '/api/suppliers?page_size=200').then((r) => r.rows).catch(() => []),
    api('GET', '/api/products?page_size=300').then((r) => r.rows).catch(() => []),
  ]);
  const lines = [];

  c.innerHTML = `
    <div class="grid grid-cols-12 gap-4">
      <div class="col-span-7 card p-4">
        <div class="flex gap-2 mb-3">
          <select id="puProduct" class="field flex-1"><option value="">اختر صنفاً لإضافته...</option>${products.map((p) => `<option value="${p.id}">${esc(p.name)} — ${esc(p.barcode || '')}</option>`).join('')}</select>
          <button id="puAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> إضافة</button>
        </div>
        <div class="overflow-auto max-h-[60vh]">
          <table class="w-full"><thead><tr><th class="th">الصنف</th><th class="th">الكمية</th><th class="th">التكلفة</th><th class="th">الإجمالي</th><th class="th"></th></tr></thead>
          <tbody id="puBody"></tbody></table>
        </div>
      </div>
      <div class="col-span-5 card p-4 flex flex-col">
        <div class="font-black mb-3">بيانات فاتورة الشراء</div>
        <div class="space-y-3">
          ${field('المورد', `<select id="puSupplier" class="field"><option value="">—</option>${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`)}
          ${field('طريقة الدفع', `<select id="puMethod" class="field"><option value="cash">نقدي</option><option value="credit">آجل</option></select>`)}
          <div class="grid grid-cols-2 gap-2">
            ${field('خصم', '<input id="puDiscount" type="number" value="0" class="field" />')}
            ${field('المدفوع', '<input id="puPaid" type="number" value="0" class="field" />')}
          </div>
          ${field('ملاحظات', '<textarea id="puNotes" class="field" rows="2"></textarea>')}
        </div>
        <div class="mt-4 bg-slate-50 rounded-xl p-3 flex justify-between font-black text-lg"><span>المجموع</span><span id="puTotal" class="text-zain-700">0</span></div>
        <button id="puSave" class="btn btn-success w-full mt-3 !py-3"><i class="bi bi-check2-circle"></i> حفظ فاتورة الشراء</button>
      </div>
    </div>`;

  const renderLines = () => {
    c.querySelector('#puBody').innerHTML = lines.length ? lines.map((l, i) => `
      <tr class="tr">
        <td class="td">${esc(l.name)}</td>
        <td class="td"><input type="number" value="${l.qty}" data-q="${i}" class="field !py-1 !w-20" /></td>
        <td class="td"><input type="number" value="${l.cost_price}" data-c="${i}" class="field !py-1 !w-28" /></td>
        <td class="td font-bold">${money(l.qty * l.cost_price)}</td>
        <td class="td"><button data-d="${i}" class="text-rose-400 hover:text-rose-600"><i class="bi bi-x-lg"></i></button></td>
      </tr>`).join('') : '<tr><td colspan="5" class="td text-center text-slate-400 py-10">لم تضف أصنافاً بعد</td></tr>';
    c.querySelectorAll('[data-q]').forEach((el) => el.addEventListener('change', (e) => { lines[+e.target.dataset.q].qty = Number(e.target.value) || 1; renderLines(); }));
    c.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', (e) => { lines[+e.target.dataset.c].cost_price = Number(e.target.value) || 0; renderLines(); }));
    c.querySelectorAll('[data-d]').forEach((el) => el.addEventListener('click', () => { lines.splice(+el.dataset.d, 1); renderLines(); }));
    const total = lines.reduce((s, l) => s + l.qty * l.cost_price, 0) - Number(c.querySelector('#puDiscount').value || 0);
    c.querySelector('#puTotal').textContent = money(total);
  };

  c.querySelector('#puAdd').addEventListener('click', () => {
    const sel = c.querySelector('#puProduct');
    const p = products.find((x) => x.id === Number(sel.value));
    if (!p) return;
    const exist = lines.find((l) => l.product_id === p.id);
    if (exist) exist.qty += 1;
    else lines.push({ product_id: p.id, name: p.name, qty: 1, cost_price: p.cost_price });
    sel.value = '';
    renderLines();
  });
  function paidValue() {
    const v = c.querySelector('#puPaid').value;
    if (v !== '') return Number(v) || 0;
    const total = lines.reduce((s, l) => s + l.qty * l.cost_price, 0) - Number(c.querySelector('#puDiscount').value || 0);
    return c.querySelector('#puMethod').value === 'credit' ? 0 : total;
  }

  c.querySelector('#puDiscount').addEventListener('input', renderLines);
  c.querySelector('#puSave').addEventListener('click', async () => {
    if (!lines.length) { toast('لم تضف أصنافاً', 'error'); return; }
    try {
      const res = await api('POST', '/api/purchases', {
        supplier_id: c.querySelector('#puSupplier').value || null,
        payment_method: c.querySelector('#puMethod').value,
        discount: Number(c.querySelector('#puDiscount').value) || 0,
        paid: paidValue(),
        notes: c.querySelector('#puNotes').value,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, cost_price: l.cost_price, unit_price: l.cost_price })),
      });
      toast(`تم حفظ فاتورة الشراء ${res.invoice.invoice_no}`, 'success');
      if (confirm('طباعة الفاتورة الآن؟')) openPrint(`/api/print/a4/${res.invoice.id}`);
      lines.length = 0;
      c.querySelector('#puBody').innerHTML = '';
      c.querySelector('#puDiscount').value = '0';
      c.querySelector('#puPaid').value = '';
      renderLines();
      const fresh = await api('GET', '/api/products?page_size=300');
      products.length = 0;
      products.push(...fresh.rows);
      c.querySelector('#puProduct').innerHTML = `<option value="">اختر صنفاً لإضافته...</option>${products.map((p) => `<option value="${p.id}">${esc(p.name)} — ${esc(p.barcode || '')}</option>`).join('')}`;
    } catch (e) { toast(e.message, 'error'); }
  });

  renderLines();
}
