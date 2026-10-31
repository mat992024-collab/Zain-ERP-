import { api, state, money, num, esc, toast, modal, confirmBox, field, openPrint, debounce, formToObject, downloadFile, pickImageFile, barcodeSvg } from '../core.js';

const BULK_FIELDS = ['name', 'barcode', 'part_number', 'author', 'category', 'brand', 'unit', 'cost_price', 'sale_price', 'wholesale_price', 'quantity', 'reorder_level', 'tax_rate', 'expiry_date', 'supplier_id', 'track_expiry', 'is_active', 'description'];

export async function renderProducts(c) {
  await listView(c, { mode: 'products' });
}

export async function renderInventory(c) {
  await listView(c, { mode: 'inventory' });
}

async function listView(c, { mode }) {
  let page = 1;
  let search = '';
  let category = '';
  let lowOnly = mode === 'inventory';
  if (state.pendingSearch && state.pendingSearch.view === 'inventory') {
    search = state.pendingSearch.q;
    lowOnly = false;
    state.pendingSearch = null;
  }
  const [categories, suppliers, currencies] = await Promise.all([
    api('GET', '/api/products/categories').then((r) => r.categories).catch(() => []),
    api('GET', '/api/suppliers?page_size=200').then((r) => r.rows).catch(() => []),
    api('GET', '/api/currencies').then((r) => r.rows).catch(() => []),
  ]);

  c.innerHTML = `
    <div class="card">
      <div class="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
        <div class="relative flex-1 min-w-64">
          <i class="bi bi-search absolute top-1/2 -translate-y-1/2 right-3.5 text-slate-400"></i>
          <input id="pSearch" class="field !pr-11" placeholder="بحث بالاسم / الباركود / رقم القطعة / المؤلف" />
        </div>
        <select id="pCategory" class="field !w-44"><option value="">كل الأصناف</option>${categories.map((x) => `<option value="${esc(x.name)}">${esc(x.name)} (${x.count})</option>`).join('')}</select>
        <label class="flex items-center gap-2 text-sm font-bold text-slate-600 cursor-pointer"><input type="checkbox" id="pLow" ${lowOnly ? 'checked' : ''} class="w-4 h-4 accent-rose-500" /> النواقص فقط</label>
        <div class="flex-1"></div>
        <button id="pExpiry" class="btn btn-ghost"><i class="bi bi-hourglass-bottom"></i> تقرير الصلاحية</button>
        <button id="pImport" class="btn btn-ghost text-indigo-600 font-bold"><i class="bi bi-file-earmark-arrow-up"></i> استيراد ذكي</button>
        <button id="pLabel" class="btn btn-ghost"><i class="bi bi-tags"></i> استوديو الباركود</button>
        <button id="pExport" class="btn btn-ghost"><i class="bi bi-filetype-csv"></i> تصدير CSV</button>
        <button id="pBulk" class="btn btn-ghost"><i class="bi bi-percent"></i> تعديل أسعار</button>
        <button id="pAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> صنف جديد</button>
      </div>
      <div class="overflow-auto max-h-[calc(100vh-230px)]">
        <table class="w-full">
          <thead><tr>
            <th class="th">الصنف</th><th class="th">الباركود</th><th class="th">التصنيف</th>
            <th class="th">التكلفة</th><th class="th">البيع</th><th class="th">الكمية</th><th class="th">الحالة</th><th class="th"></th>
          </tr></thead>
          <tbody id="pBody"></tbody>
        </table>
      </div>
      <div class="p-3 flex items-center justify-between border-t border-slate-100 text-sm">
        <div id="pCount" class="text-slate-500"></div>
        <div class="flex gap-2"><button id="pPrev" class="btn btn-ghost btn-sm">السابق</button><span id="pPage" class="px-3 py-1 font-bold"></span><button id="pNext" class="btn btn-ghost btn-sm">التالي</button></div>
      </div>
    </div>`;

  if (search) c.querySelector('#pSearch').value = search;

  const load = async () => {
    const q = new URLSearchParams({ page, page_size: 50, search, category, low_stock: lowOnly ? '1' : '0' });
    const data = await api('GET', '/api/products?' + q.toString());
    const rows = data.rows;
    c.querySelector('#pCount').textContent = `العدد الكلي: ${data.total}`;
    c.querySelector('#pPage').textContent = `صفحة ${page}`;
    c.querySelector('#pBody').innerHTML = rows.length
      ? rows.map((p) => `
        <tr class="tr">
          <td class="td">
            <div class="flex items-center gap-2">
              ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" class="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0" />` : ''}
              <div><div class="font-bold text-slate-800">${esc(p.name)}</div><div class="text-[11px] text-slate-400">${esc(p.author || p.part_number || '')}</div>
                ${Object.keys(p.prices || {}).length ? `<div class="flex gap-1 mt-1 flex-wrap">${Object.keys(p.prices).map((code) => `<span class="badge badge-info">${esc(code)}</span>`).join('')}</div>` : ''}
              </div>
            </div>
          </td>
          <td class="td font-mono text-xs">${esc(p.barcode || '-')}</td>
          <td class="td"><span class="badge badge-info">${esc(p.category)}</span></td>
          <td class="td">${num(p.cost_price)}</td>
          <td class="td font-bold text-zain-700">${num(p.sale_price)}</td>
          <td class="td"><span class="font-bold ${p.quantity <= p.reorder_level ? 'text-rose-600' : ''}">${num(p.quantity)}</span> <span class="text-[11px] text-slate-400">${esc(p.unit)}</span></td>
          <td class="td">${p.quantity <= 0 ? '<span class="badge badge-danger">نفد</span>' : p.quantity <= p.reorder_level ? '<span class="badge badge-warn">منخفض</span>' : '<span class="badge badge-ok">متوفر</span>'}</td>
          <td class="td">
            <div class="flex gap-1">
              <button data-edit="${p.id}" class="btn btn-ghost btn-sm"><i class="bi bi-pencil"></i></button>
              <button data-stock="${p.id}" class="btn btn-ghost btn-sm"><i class="bi bi-box-seam"></i></button>
              <button data-labels="${p.id}" class="btn btn-ghost btn-sm"><i class="bi bi-upc"></i></button>
              <button data-move="${p.id}" class="btn btn-ghost btn-sm"><i class="bi bi-clock-history"></i></button>
              <button data-del="${p.id}" class="btn btn-ghost btn-sm text-rose-500"><i class="bi bi-trash3"></i></button>
            </div>
          </td>
        </tr>`).join('')
      : `<tr><td colspan="8" class="td text-center text-slate-400 py-10">لا توجد أصناف</td></tr>`;
    bindRows(rows);
  };

  const bindRows = (rows) => {
    c.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => productForm(rows.find((x) => x.id === +b.dataset.edit), { categories, suppliers, currencies, onSave: load })));
    c.querySelectorAll('[data-stock]').forEach((b) => b.addEventListener('click', () => stockAdjust(rows.find((x) => x.id === +b.dataset.stock), load)));
    c.querySelectorAll('[data-labels]').forEach((b) => b.addEventListener('click', () => labelsForm([+b.dataset.labels])));
    c.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => movements(+b.dataset.move)));
    c.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = rows.find((x) => x.id === +b.dataset.del);
      if (!(await confirmBox(`حذف/أرشفة الصنف "${p.name}"؟`))) return;
      try { await api('DELETE', `/api/products/${p.id}`); toast('تم الحذف', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
    }));
  };

  const reload = debounce(() => { page = 1; load(); }, 250);
  c.querySelector('#pSearch').addEventListener('input', (e) => { search = e.target.value; reload(); });
  c.querySelector('#pCategory').addEventListener('change', (e) => { category = e.target.value; page = 1; load(); });
  c.querySelector('#pLow').addEventListener('change', (e) => { lowOnly = e.target.checked; page = 1; load(); });
  c.querySelector('#pPrev').addEventListener('click', () => { if (page > 1) { page--; load(); } });
  c.querySelector('#pNext').addEventListener('click', () => { page++; load(); });
  c.querySelector('#pAdd').addEventListener('click', () => productForm(null, { categories, suppliers, currencies, onSave: load }));
  c.querySelector('#pBulk').addEventListener('click', () => bulkForm(categories, load));
  c.querySelector('#pExpiry').addEventListener('click', () => expiryReport());
  c.querySelector('#pImport').addEventListener('click', () => importModal(load));
  c.querySelector('#pLabel').addEventListener('click', () => labelsForm(null));
  c.querySelector('#pExport').addEventListener('click', async () => {
    try {
      await downloadFile('/api/export/products', 'الأصناف.csv');
      toast('تم تصدير الملف', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  load();
}

async function expiryReport() {
  const days = 30;
  const data = await api('GET', `/api/reports/expiring?days=${days}`).catch(() => null);
  if (!data) { toast('تعذر تحميل التقرير', 'error'); return; }
  const status = {
    expired: ['badge-danger', 'منتهي'],
    critical: ['badge-warn', 'أقل من 7 أيام'],
    warning: ['badge-info', 'قارب على الانتهاء'],
  };
  modal({
    title: `تقرير انتهاء الصلاحية (${days} يوم)`,
    size: 'max-w-3xl',
    body: `
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div class="kpi"><div class="kpi-value text-rose-600">${data.summary.expired}</div><div class="kpi-label">منتهي</div></div>
        <div class="kpi"><div class="kpi-value text-amber-600">${data.summary.critical}</div><div class="kpi-label">أقل من 7 أيام</div></div>
        <div class="kpi"><div class="kpi-value text-zain-700">${data.summary.warning}</div><div class="kpi-label">قارب على الانتهاء</div></div>
        <div class="kpi"><div class="kpi-value">${money(data.summary.value_at_risk)}</div><div class="kpi-label">قيمة المخزون المعرّض</div></div>
      </div>
      <div class="overflow-auto max-h-96"><table class="w-full">
        <thead><tr><th class="th">الصنف</th><th class="th">التصنيف</th><th class="th">الكمية</th><th class="th">تاريخ الصلاحية</th><th class="th">المتبقي</th><th class="th">الحالة</th></tr></thead>
        <tbody>${data.rows.map((r) => `<tr class="tr">
          <td class="td font-bold">${esc(r.name)}</td>
          <td class="td">${esc(r.category || '-')}</td>
          <td class="td">${num(r.quantity)}</td>
          <td class="td text-xs">${esc(r.expiry_date)}</td>
          <td class="td font-bold ${r.days_left < 0 ? 'text-rose-600' : 'text-amber-600'}">${r.days_left === null ? '-' : (r.days_left < 0 ? `منتهٍ منذ ${Math.abs(r.days_left)} يوم` : `${r.days_left} يوم`)}</td>
          <td class="td"><span class="badge ${(status[r.status] || status.warning)[0]}">${(status[r.status] || status.warning)[1]}</span></td>
        </tr>`).join('') || '<tr><td colspan="6" class="td text-center text-slate-400 py-8">لا توجد أصناف قاربت على الانتهاء</td></tr>'}</tbody>
      </table></div>`,
  });
}

function productForm(product, { categories, suppliers, currencies, onSave }) {
  const p = product || {};
  const industryFields = { supermarket: ['expiry_date'], bookstore: ['author'], spare_parts: ['part_number', 'brand'] }[state.settings.industry] || [];
  const baseCode = (currencies || []).find((c) => c.is_base)?.code || '';
  const foreignCurrencies = (currencies || []).filter((c) => !c.is_base);
  const priceRows = foreignCurrencies.map((c) => {
    const saved = (p.prices || {})[c.code] || {};
    return `
      <div class="grid grid-cols-4 gap-2 items-center border border-slate-100 rounded-xl p-2" data-price-row="${esc(c.code)}">
        <div class="font-bold text-sm text-slate-700">${esc(c.code)} <span class="text-[11px] text-slate-400">${esc(c.name)}</span></div>
        <input data-pcur="${esc(c.code)}" data-pk="sale_price" type="number" step="0.01" value="${saved.sale_price || 0}" class="field !py-1 !px-2 text-xs" placeholder="سعر البيع" />
        <input data-pcur="${esc(c.code)}" data-pk="cost_price" type="number" step="0.01" value="${saved.cost_price || 0}" class="field !py-1 !px-2 text-xs" placeholder="سعر التكلفة" />
        <input data-pcur="${esc(c.code)}" data-pk="wholesale_price" type="number" step="0.01" value="${saved.wholesale_price || 0}" class="field !py-1 !px-2 text-xs" placeholder="سعر الجملة" />
      </div>`;
  }).join('');
  modal({
    title: product ? `تعديل: ${p.name}` : 'صنف جديد',
    size: 'max-w-3xl',
    body: `
      <form id="prodForm" class="grid grid-cols-2 gap-4">
        ${field('اسم الصنف *', `<input name="name" value="${esc(p.name || '')}" class="field" required />`)}
        ${field('الباركود', `<input name="barcode" id="pfBarcode" value="${esc(p.barcode || '')}" class="field font-mono" placeholder="يتم توليده تلقائياً" />`)}
        <div class="col-span-2 card p-3 flex items-center gap-3">
          <div class="flex-1 min-w-0 overflow-auto" id="pfBarcodeBox">${p.barcode ? barcodeSvg(p.barcode, { width: 280 }) : `<div class="text-xs text-slate-400">أدخل باركود لعرض المعاينة مباشرةً</div>`}</div>
          <button type="button" id="pfBarcodePrint" class="btn btn-ghost btn-sm"><i class="bi bi-printer"></i> طباعة باركود</button>
        </div>
        ${field('الكود الداخلي / SKU', `<input name="sku" value="${esc(p.sku || '')}" class="field font-mono" placeholder="مثال: SKU-101" />`)}
        ${field('حجم العبوة', `<input name="package_size" value="${esc(p.package_size || '')}" class="field" placeholder="مثال: 9 لتر، 1 كجم" />`)}
        ${industryFields.includes('part_number') ? field('رقم القطعة', `<input name="part_number" value="${esc(p.part_number || '')}" class="field" />`) : ''}
        ${industryFields.includes('author') ? field('المؤلف', `<input name="author" value="${esc(p.author || '')}" class="field" />`) : ''}
        ${industryFields.includes('brand') ? field('الماركة', `<input name="brand" value="${esc(p.brand || '')}" class="field" />`) : ''}
        ${field('التصنيف', `<input name="category" list="catList" value="${esc(p.category || 'عام')}" class="field" /><datalist id="catList"><option value="عام"><option value="مشروبات"><option value="مواد غذائية"><option value="إلكترونيات"><option value="ملابس"><option value="أدوات منزلية">${(categories || []).map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>`)}
        ${field('وحدة القياس', `<input name="unit" list="unitList" value="${esc(p.unit || 'قطعة')}" class="field" /><datalist id="unitList"><option value="قطعة"><option value="متر"><option value="متر مربع"><option value="رول"><option value="طرد"><option value="كيلو"><option value="جرام"><option value="طن"><option value="لتر"><option value="سم"><option value="علبة"><option value="طاقم"><option value="كرتونة"></datalist>`)}
        <div class="col-span-2 card p-3 bg-indigo-50/50 border border-indigo-100 flex items-center justify-between gap-4">
          <label class="flex items-center gap-2 text-sm font-bold text-indigo-800">
            <input type="checkbox" name="is_meter_unit" ${p.is_meter_unit ? 'checked' : ''} class="w-4 h-4 accent-indigo-600" />
            صنف رول / يباع بالأمتار والمساحة (مطابع وخامات)
          </label>
          <div class="flex items-center gap-2">
            <input name="meter_length" type="number" step="0.01" value="${p.meter_length || 0}" class="field !py-1 !px-2 !w-24 text-xs" placeholder="طول (م)" title="طول الرول" />
            <span class="text-xs text-slate-400">×</span>
            <input name="meter_width" type="number" step="0.01" value="${p.meter_width || 0}" class="field !py-1 !px-2 !w-24 text-xs" placeholder="عرض (م)" title="عرض الرول" />
          </div>
        </div>
        ${field('سعر التكلفة', `<input name="cost_price" type="number" step="0.01" value="${p.cost_price || 0}" class="field" />`)}
        ${field('نسبة الربح %', `<input id="pfProfitMargin" name="profit_margin_pct" type="number" step="0.1" value="${p.profit_margin_pct ?? (p.cost_price && p.sale_price ? Math.round(((p.sale_price - p.cost_price) / p.cost_price) * 1000) / 10 : 0)}" class="field" placeholder="%" />`)}
        ${field('سعر البيع', `<input name="sale_price" type="number" step="0.01" value="${p.sale_price || 0}" class="field font-bold text-zain-700" />`)}
        ${field('سعر الجملة', `<input name="wholesale_price" type="number" step="0.01" value="${p.wholesale_price || 0}" class="field" />`)}
        ${field('الحد الأدنى للجملة (كمية)', `<input name="wholesale_min_qty" type="number" step="0.01" value="${p.wholesale_min_qty ?? 1}" class="field" />`)}
        ${field('الكمية الحالية', `<input name="quantity" type="number" step="0.001" value="${p.quantity || 0}" class="field" />`)}
        ${field('حد إعادة الطلب', `<input name="reorder_level" type="number" value="${p.reorder_level ?? 5}" class="field" />`)}
        ${field('موقع التخزين (الرف)', `<input name="shelf_location" value="${esc(p.shelf_location || '')}" class="field" placeholder="مثال: A1 رف 3" />`)}
        ${field('نسبة الضريبة %', `<input name="tax_rate" type="number" step="0.01" value="${p.tax_rate ?? 0}" class="field" />`)}
        ${field('المورد', `<select name="supplier_id" class="field"><option value="">—</option>${(suppliers || []).map((s) => `<option value="${s.id}" ${p.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`)}
        ${field('تاريخ الصلاحية', `<input name="expiry_date" type="date" value="${p.expiry_date || ''}" class="field" />`)}
        <div class="flex items-center gap-4 pt-6">
          <label class="flex items-center gap-2 text-sm font-bold text-slate-600"><input type="checkbox" name="track_expiry" ${p.track_expiry ? 'checked' : ''} class="w-4 h-4 accent-zain-500" /> تتبع الصلاحية</label>
          <label class="flex items-center gap-2 text-sm font-bold text-slate-600"><input type="checkbox" name="is_active" ${p.is_active === undefined || p.is_active ? 'checked' : ''} class="w-4 h-4 accent-emerald-500" /> فعال</label>
        </div>
        <div class="col-span-2">
          ${field('صورة الصنف', `<div class="flex items-center gap-3">
            <div id="pfImgBox" class="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 grid place-items-center overflow-hidden shrink-0">
              ${p.image ? `<img src="${esc(p.image)}" alt="صورة الصنف" class="w-full h-full object-cover" />` : '<i class="bi bi-image text-slate-300 text-2xl"></i>'}
            </div>
            <div class="flex-1">
              <input type="file" id="pfImage" accept="image/*" class="field text-xs" />
              <input type="hidden" name="image" id="pfImageData" value="${esc(p.image || '')}" />
              <p class="text-[11px] text-slate-400 mt-1">تُصغَّر الصورة تلقائياً قبل الحفظ (بحد أقصى 420 بكسل).</p>
            </div>
            <button type="button" id="pfImageClear" class="btn btn-ghost btn-sm shrink-0"><i class="bi bi-trash"></i> إزالة</button>
          </div>`)}
        </div>
        <div class="col-span-2">${field('ملاحظات', `<textarea name="description" class="field" rows="2">${esc(p.description || '')}</textarea>`)}</div>
        <div class="col-span-2">
          ${field('أسعار العملات الأخرى', `
            <div class="space-y-2">
              <div class="grid grid-cols-4 gap-2 px-2 text-[11px] font-bold text-slate-400">
                <span>العملة</span><span>سعر البيع</span><span>سعر التكلفة</span><span>سعر الجملة</span>
              </div>
              ${priceRows || `<p class="text-xs text-slate-400 p-2">لا توجد عملات غير أساسية. أضف عملات من شاشة الإدارة لتحديد أسعار متعددة لكل صنف.</p>`}
              ${priceRows ? `<p class="text-[11px] text-slate-400">السعر الأساسي لل currency ${esc(baseCode)} يبقى في حقول التكلفة/البيع/الجملة أعلاه.</p>` : ''}
            </div>`)}
        </div>
      </form>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="prodSave" class="btn btn-primary"><i class="bi bi-check2"></i> حفظ</button>`,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      const imgBox = wrap.querySelector('#pfImgBox');
      const imgData = wrap.querySelector('#pfImageData');
      const paintImage = (src) => {
        imgBox.innerHTML = src
          ? `<img src="${src}" alt="صورة الصنف" class="w-full h-full object-cover" />`
          : '<i class="bi bi-image text-slate-300 text-2xl"></i>';
      };
      wrap.querySelector('#pfImage').addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const dataUrl = await pickImageFile(file);
          imgData.value = dataUrl;
          paintImage(dataUrl);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      const barInput = wrap.querySelector('#pfBarcode');
      const barBox = wrap.querySelector('#pfBarcodeBox');
      const barPrint = wrap.querySelector('#pfBarcodePrint');
      if (barInput && barBox) {
        const updateBar = () => {
          const v = (barInput.value || '').trim();
          if (!v) { barBox.innerHTML = `<div class="text-xs text-slate-400">أدخل باركود لعرض المعاينة مباشرةً</div>`; return; }
          barBox.innerHTML = barcodeSvg(v, { width: 280 });
        };
        barInput.addEventListener('input', updateBar);
        updateBar();
      }
      if (barPrint && barInput) {
        barPrint.addEventListener('click', () => {
          const v = (barInput.value || '').trim();
          if (!v) { toast('أدخل باركود أولاً', 'error'); return; }
          const svg = barcodeSvg(v, { width: 400, height: 60 });
          const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>باركود</title><style>body{font-family:Cairo,Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fff}svg{max-width:100%}</style></head><body>${svg}</body></html>`;
          const w = window.open('', '_blank');
          if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch(e){} }, 300); }
        });
      }
      const costIn = wrap.querySelector('[name="cost_price"]');
      const saleIn = wrap.querySelector('[name="sale_price"]');
      const marginIn = wrap.querySelector('#pfProfitMargin');
      if (costIn && saleIn && marginIn) {
        marginIn.addEventListener('input', () => {
          const c = Number(costIn.value) || 0;
          const m = Number(marginIn.value) || 0;
          if (c > 0) saleIn.value = Math.round(c * (1 + m / 100));
        });
        costIn.addEventListener('input', () => {
          const c = Number(costIn.value) || 0;
          const m = Number(marginIn.value) || 0;
          if (c > 0 && m > 0) saleIn.value = Math.round(c * (1 + m / 100));
          else if (c > 0 && Number(saleIn.value) > 0) marginIn.value = Math.round(((Number(saleIn.value) - c) / c) * 1000) / 10;
        });
        saleIn.addEventListener('input', () => {
          const c = Number(costIn.value) || 0;
          const s = Number(saleIn.value) || 0;
          if (c > 0) marginIn.value = Math.round(((s - c) / c) * 1000) / 10;
        });
      }
      wrap.querySelector('#pfImageClear').addEventListener('click', () => {
        imgData.value = '';
        wrap.querySelector('#pfImage').value = '';
        paintImage('');
      });
      wrap.querySelector('#prodSave').addEventListener('click', async () => {
        const form = wrap.querySelector('#prodForm');
        if (!form.reportValidity()) return;
        const data = formToObject(form);
        data.is_meter_unit = form.querySelector('[name="is_meter_unit"]').checked ? 1 : 0;
        for (const k of ['cost_price', 'sale_price', 'wholesale_price', 'quantity', 'reorder_level', 'profit_margin_pct', 'wholesale_min_qty', 'tax_rate', 'meter_length', 'meter_width']) data[k] = Number(data[k]) || 0;
        const imageValue = imgData.value;
        delete data.image;
        const priceInputs = new Map();
        wrap.querySelectorAll('[data-pcur]').forEach((el) => {
          const code = el.dataset.pcur;
          if (!priceInputs.has(code)) priceInputs.set(code, {});
          priceInputs.get(code)[el.dataset.pk] = Number(el.value) || 0;
        });
        try {
          let savedId = product ? product.id : null;
          if (product) await api('PUT', `/api/products/${product.id}`, data);
          else {
            const res = await api('POST', '/api/products', data);
            savedId = res.product.id;
          }
          if (/^data:image\//.test(imageValue)) {
            await api('POST', `/api/products/${savedId}/image`, { data_url: imageValue });
          } else if (product && product.image && !imageValue) {
            await api('DELETE', `/api/products/${savedId}/image`);
          }
          for (const [code, vals] of priceInputs) {
            const has = vals.sale_price || vals.cost_price || vals.wholesale_price;
            const had = product && product.prices && product.prices[code];
            if (has) await api('PUT', `/api/products/${savedId}/prices`, { currency: code, ...vals });
            else if (had) await api('DELETE', `/api/products/${savedId}/prices/${code}`);
          }
          toast('تم الحفظ', 'success');
          close();
          onSave && onSave();
        } catch (e) { toast(e.message, 'error'); }
      });
    },
  });
}

function stockAdjust(product, onSave) {
  modal({
    title: `تسوية مخزون: ${product.name}`,
    size: 'max-w-md',
    body: `
      <div class="mb-3 text-sm text-slate-500">الكمية الحالية: <b>${num(product.quantity)}</b> ${esc(product.unit)}</div>
      <div class="mb-3">
        <label class="label">نوع الحركة</label>
        <div class="grid grid-cols-2 gap-2">
          <button data-dir="in" class="dir-btn btn btn-success">إضافة</button>
          <button data-dir="out" class="dir-btn btn btn-ghost">صرف</button>
        </div>
      </div>
      ${field('الكمية', '<input id="adjQty" type="number" value="1" class="field" />')}
      ${field('السبب', '<input id="adjReason" class="field" placeholder="جرد، تلف، استلام..." />')}`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="adjSave" class="btn btn-primary">تنفيذ</button>`,
    onMount(wrap, close) {
      let dir = 'in';
      wrap.querySelectorAll('.dir-btn').forEach((b) => b.addEventListener('click', () => {
        dir = b.dataset.dir;
        wrap.querySelectorAll('.dir-btn').forEach((x) => { x.className = 'dir-btn btn btn-ghost'; });
        b.className = `dir-btn btn ${dir === 'in' ? 'btn-success' : 'btn-danger'}`;
      }));
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#adjSave').addEventListener('click', async () => {
        try {
          await api('POST', `/api/products/${product.id}/adjust`, { qty: Number(wrap.querySelector('#adjQty').value), direction: dir, reason: wrap.querySelector('#adjReason').value });
          toast('تم تحديث المخزون', 'success');
          close();
          onSave && onSave();
        } catch (e) { toast(e.message, 'error'); }
      });
    },
  });
}

async function movements(productId) {
  const data = await api('GET', `/api/products/${productId}/movements`);
  modal({
    title: 'حركات المخزون',
    size: 'max-w-2xl',
    body: `<table class="w-full"><thead><tr><th class="th">التاريخ</th><th class="th">الحركة</th><th class="th">الكمية</th><th class="th">الرصيد</th><th class="th">السبب</th></tr></thead><tbody>${data.rows.map((m) => `<tr class="tr"><td class="td">${m.created_at}</td><td class="td">${m.direction === 'in' ? '<span class="badge badge-ok">إدخال</span>' : '<span class="badge badge-danger">إخراج</span>'}</td><td class="td">${num(m.qty)}</td><td class="td">${num(m.balance_after)}</td><td class="td">${esc(m.reason || '')}</td></tr>`).join('')}</tbody></table>`,
    footer: `<button data-close class="btn btn-ghost">إغلاق</button><button id="mvPrint" class="btn btn-primary"><i class="bi bi-printer"></i> طباعة حركة الصنف</button>`,
    onMount(wrap) {
      wrap.querySelector('#mvPrint').addEventListener('click', () => openPrint(`/api/print/product-movements/${productId}`));
    },
  });
}

function bulkForm(categories, onSave) {
  modal({
    title: 'تعديل أسعار جماعي',
    size: 'max-w-lg',
    body: `
      ${field('التصنيف', `<select id="bulkCategory" class="field"><option value="">كل الأصناف</option>${categories.map((x) => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}</select>`)}
      ${field('الحقل', `<select id="bulkField" class="field"><option value="sale_price">سعر البيع</option><option value="cost_price">سعر التكلفة</option><option value="wholesale_price">سعر الجملة</option></select>`)}
      ${field('نوع التعديل', `<select id="bulkMode" class="field"><option value="percent">نسبة %</option><option value="amount">قيمة</option></select>`)}
      ${field('القيمة', '<input id="bulkValue" type="number" value="10" class="field" />')}`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="bulkSave" class="btn btn-warning">تطبيق</button>`,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#bulkSave').addEventListener('click', async () => {
        try {
          const res = await api('POST', '/api/products/bulk-price', {
            category: wrap.querySelector('#bulkCategory').value || null,
            field: wrap.querySelector('#bulkField').value,
            mode: wrap.querySelector('#bulkMode').value,
            value: Number(wrap.querySelector('#bulkValue').value) || 0,
          });
          toast(`تم تحديث ${res.updated} صنف`, 'success');
          close();
          onSave && onSave();
        } catch (e) { toast(e.message, 'error'); }
      });
    },
  });
}


function labelsForm(productIds) {
  const quick = !!productIds;
  const presets = [
    { id: '50x30', w: 50, h: 30, label: '50×30 مم (ملابس وشائع)' },
    { id: '40x25', w: 40, h: 25, label: '40×25 مم (شريط رفوف قياسي)' },
    { id: '30x20', w: 30, h: 20, label: '30×20 مم (ملصق صغير)' },
    { id: '60x40', w: 60, h: 40, label: '60×40 مم (مخازن وتجزئة)' },
    { id: '70x50', w: 70, h: 50, label: '70×50 مم (كبير للأغذية)' },
    { id: '80x50', w: 80, h: 50, label: '80×50 مم (ملصق تفصيلي)' },
    { id: '100x150', w: 100, h: 150, label: '100×150 مم (بوليصة A6)' },
    { id: 'custom', w: 40, h: 30, label: 'مقاس مخصص' },
  ];

  modal({
    title: 'استوديو طباعة وتصميم الباركود والليبل',
    size: 'max-w-2xl',
    body: `
      <div class="space-y-4">
        ${quick ? '' : `<div>${field('أرقام الأصناف (مفصولة بفاصلة)', '<input id="lblIds" class="field" placeholder="مثال: 1, 2, 3 أو اتركه فارغاً لطباعة أول 50 صنف" />')}</div>`}

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="label">المقاس الجاهز</label>
            <select id="lblPreset" class="field">
              ${presets.map((p) => `<option value="${p.id}" ${p.id === '50x30' ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </div>
          <div>${field('العرض (مم)', '<input id="lblW" type="number" value="50" min="15" max="300" class="field" />')}</div>
          <div>${field('الارتفاع (مم)', '<input id="lblH" type="number" value="30" min="10" max="300" class="field" />')}</div>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="label">زاوية الدوران</label>
            <select id="lblRotate" class="field">
              <option value="0">0° (عادي)</option>
              <option value="90">90° (عمودي يمين)</option>
              <option value="180">180° (معكوس رأساً)</option>
              <option value="270">270° (عمودي يسار)</option>
            </select>
          </div>
          <div>${field('خط اسم الصنف (px)', '<input id="lblFontName" type="number" value="11" min="6" max="24" class="field" />')}</div>
          <div>${field('خط السعر (px)', '<input id="lblFontPrice" type="number" value="13" min="6" max="30" class="field" />')}</div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>${field('عدد النسخ لكل صنف', '<input id="lblRepeats" type="number" value="1" min="1" max="200" class="field" />')}</div>
          <div class="flex items-center pt-6">
            <label class="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" id="lblUseStockQty" class="w-4 h-4 accent-zain-600" />
              استخدام كمية المخزون كعدد نسخ تلقائياً
            </label>
          </div>
        </div>

        <div class="card p-3 bg-slate-50 border border-slate-200">
          <div class="text-xs font-bold text-slate-700 mb-2">عناصر وتصميم الليبل:</div>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblDual" class="w-4 h-4 accent-zain-600" /> طباعة مزدوجة (2 تحت بعض)</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblMirror" class="w-4 h-4 accent-zain-600" /> عكس الطباعة أفقياً</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblSpecialOffer" class="w-4 h-4 accent-rose-600" /> تصميم "عرض خاص"</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblShowBorder" checked class="w-4 h-4 accent-zain-600" /> إطار حول الليبل</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblShowLogo" class="w-4 h-4 accent-zain-600" /> شعار المتجر</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblShowStore" checked class="w-4 h-4 accent-zain-600" /> اسم المحل</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblShowPrice" checked class="w-4 h-4 accent-zain-600" /> السعر</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblShowDate" class="w-4 h-4 accent-zain-600" /> تاريخ اليوم</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblShowSize" checked class="w-4 h-4 accent-zain-600" /> الحجم / المقاس</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblShowExpiry" class="w-4 h-4 accent-zain-600" /> تاريخ الانتهاء</label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="lblPageBreak" class="w-4 h-4 accent-zain-600" /> كل ليبل في صفحة منفصلة</label>
          </div>
        </div>
      </div>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="lblPrintBtn" class="btn btn-primary"><i class="bi bi-printer"></i> بدء الطباعة</button>`,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      const selPreset = wrap.querySelector('#lblPreset');
      const inW = wrap.querySelector('#lblW');
      const inH = wrap.querySelector('#lblH');

      selPreset.addEventListener('change', () => {
        const found = presets.find((p) => p.id === selPreset.value);
        if (found && found.id !== 'custom') {
          inW.value = found.w;
          inH.value = found.h;
        }
      });

      wrap.querySelector('#lblPrintBtn').addEventListener('click', async () => {
        let ids = quick ? productIds : [];
        if (!quick) {
          const raw = (wrap.querySelector('#lblIds').value || '').trim();
          if (raw) ids = raw.split(',').map((x) => Number(x.trim())).filter((x) => x > 0);
          else {
            const list = await api('GET', '/api/products?page_size=50').catch(() => ({ rows: [] }));
            ids = (list.rows || []).map((x) => x.id);
          }
        }
        if (!ids.length) { toast('يرجى تحديد أو إدخال أصناف للطباعة', 'error'); return; }

        const payload = {
          items: ids.map((id) => ({ product_id: id })),
          width_mm: Number(inW.value) || 40,
          height_mm: Number(inH.value) || 30,
          rotate: Number(wrap.querySelector('#lblRotate').value) || 0,
          repeats: Number(wrap.querySelector('#lblRepeats').value) || 1,
          use_stock_qty: wrap.querySelector('#lblUseStockQty').checked,
          dual: wrap.querySelector('#lblDual').checked,
          mirror: wrap.querySelector('#lblMirror').checked,
          special_offer: wrap.querySelector('#lblSpecialOffer').checked,
          show_border: wrap.querySelector('#lblShowBorder').checked,
          show_logo: wrap.querySelector('#lblShowLogo').checked,
          show_store_name: wrap.querySelector('#lblShowStore').checked,
          show_price: wrap.querySelector('#lblShowPrice').checked,
          show_date: wrap.querySelector('#lblShowDate').checked,
          show_size_color: wrap.querySelector('#lblShowSize').checked,
          show_expiry: wrap.querySelector('#lblShowExpiry').checked,
          page_break: wrap.querySelector('#lblPageBreak').checked,
          name_font_size: Number(wrap.querySelector('#lblFontName').value) || 11,
          price_font_size: Number(wrap.querySelector('#lblFontPrice').value) || 13,
        };

        try {
          const res = await api('POST', '/api/print/labels?token=' + encodeURIComponent(state.token), payload);
          const html = typeof res === 'string' ? res : (res && res.html);
          if (html) {
            const w = window.open('', '_blank');
            if (w) {
              w.document.write(html);
              w.document.close();
            }
          }
          close();
        } catch (e) { toast(e.message, 'error'); }
      });
    },
  });
}

function importModal(onSave) {
  modal({
    title: 'الاستيراد والتحديث الذكي للأصناف (CSV / Excel / TSV)',
    size: 'max-w-3xl',
    body: `
      <div class="space-y-4">
        <div id="impDropZone" class="border-2 border-dashed border-indigo-200 bg-indigo-50/40 rounded-2xl p-6 text-center cursor-pointer hover:bg-indigo-50 transition">
          <i class="bi bi-cloud-arrow-up text-4xl text-indigo-500 mb-2 inline-block"></i>
          <div class="font-bold text-slate-800">اسحب وأفلت ملف الأصناف هنا، أو انقر للاختيار</div>
          <div class="text-xs text-slate-400 mt-1">يدعم ملفات CSV, TSV, TXT, JSON مع مطابقة ذكية تلقائية للأعمدة</div>
          <input type="file" id="impFileInput" accept=".csv,.tsv,.txt,.json" class="hidden" />
        </div>

        <div>
          <label class="label">أو الصق النص مباشرةً هنا</label>
          <textarea id="impRawText" class="field font-mono text-xs" rows="5" placeholder="الصق بيانات جدول الإكسل أو CSV هنا مباشرةً..."></textarea>
        </div>

        <div id="impPreviewWrap" class="hidden">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-slate-700">معاينة البيانات المطابقة (<span id="impCount" class="text-indigo-600 font-black">0</span> صنف)</span>
            <span class="text-[11px] text-slate-400">سيتم إضافة الأصناف الجديدة وتحديث الأسعار والمخزون للمنتجات الحالية</span>
          </div>
          <div class="overflow-auto max-h-48 border border-slate-200 rounded-xl">
            <table class="w-full text-xs">
              <thead class="bg-slate-100 font-bold text-slate-700">
                <tr><th class="p-2 text-right">الصنف</th><th class="p-2 text-right">الباركود</th><th class="p-2 text-right">SKU</th><th class="p-2 text-right">التكلفة</th><th class="p-2 text-right">البيع</th><th class="p-2 text-right">الكمية</th></tr>
              </thead>
              <tbody id="impPreviewBody"></tbody>
            </table>
          </div>
        </div>
      </div>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="impSubmitBtn" class="btn btn-primary" disabled><i class="bi bi-file-earmark-check"></i> تأكيد الاستيراد</button>`,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      const dropZone = wrap.querySelector('#impDropZone');
      const fileInput = wrap.querySelector('#impFileInput');
      const rawText = wrap.querySelector('#impRawText');
      const previewWrap = wrap.querySelector('#impPreviewWrap');
      const previewBody = wrap.querySelector('#impPreviewBody');
      const countEl = wrap.querySelector('#impCount');
      const submitBtn = wrap.querySelector('#impSubmitBtn');

      let parsedItems = [];

      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-indigo-500'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-indigo-500'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-indigo-500');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
      });
      rawText.addEventListener('input', () => parseAndPreview(rawText.value));

      function handleFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          rawText.value = e.target.result || '';
          parseAndPreview(rawText.value);
        };
        reader.readAsText(file);
      }

      function parseAndPreview(text) {
        const trimmed = (text || '').trim();
        parsedItems = [];
        if (!trimmed) {
          previewWrap.classList.add('hidden');
          submitBtn.disabled = true;
          return;
        }

        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            const data = JSON.parse(trimmed);
            parsedItems = Array.isArray(data) ? data : (data.items || data.products || []);
          } catch {}
        }

        if (!parsedItems.length) {
          const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (lines.length) {
            const firstLine = lines[0];
            const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.includes(';') ? ';' : ',');
            const rawRows = lines.map((l) => l.split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim()));

            let headerMap = null;
            let startIndex = 0;
            const headers = rawRows[0].map((h) => h.toLowerCase());
            const colMap = {};
            headers.forEach((h, idx) => {
              if (/اسم|name|title|product/.test(h)) colMap.name = idx;
              else if (/باركود|بار كود|barcode|upc|ean/.test(h)) colMap.barcode = idx;
              else if (/sku|كود|الرمز|رمز/.test(h)) colMap.sku = idx;
              else if (/بيع|sale|price/.test(h) && !/شراء|تكلفة|cost|جملة|wholesale/.test(h)) colMap.sale_price = idx;
              else if (/تكلفة|شراء|cost|buy/.test(h)) colMap.cost_price = idx;
              else if (/جملة|wholesale/.test(h)) colMap.wholesale_price = idx;
              else if (/كمية|quantity|qty|stock/.test(h)) colMap.quantity = idx;
              else if (/تصنيف|فئة|category/.test(h)) colMap.category = idx;
              else if (/وحدة|unit/.test(h)) colMap.unit = idx;
              else if (/عبوة|حجم|size|package/.test(h)) colMap.package_size = idx;
              else if (/رف|موقع|shelf|loc/.test(h)) colMap.shelf_location = idx;
            });

            if (colMap.name !== undefined) {
              headerMap = colMap;
              startIndex = 1;
            }

            for (let i = startIndex; i < rawRows.length; i++) {
              const r = rawRows[i];
              if (!r.length || (r.length === 1 && !r[0])) continue;
              if (headerMap) {
                const name = headerMap.name !== undefined ? r[headerMap.name] : '';
                if (!name) continue;
                parsedItems.push({
                  name,
                  barcode: headerMap.barcode !== undefined ? r[headerMap.barcode] : undefined,
                  sku: headerMap.sku !== undefined ? r[headerMap.sku] : undefined,
                  sale_price: headerMap.sale_price !== undefined ? Number(r[headerMap.sale_price]) || 0 : undefined,
                  cost_price: headerMap.cost_price !== undefined ? Number(r[headerMap.cost_price]) || 0 : undefined,
                  wholesale_price: headerMap.wholesale_price !== undefined ? Number(r[headerMap.wholesale_price]) || 0 : undefined,
                  quantity: headerMap.quantity !== undefined ? Number(r[headerMap.quantity]) || 0 : undefined,
                  category: headerMap.category !== undefined ? r[headerMap.category] : undefined,
                  unit: headerMap.unit !== undefined ? r[headerMap.unit] : undefined,
                  package_size: headerMap.package_size !== undefined ? r[headerMap.package_size] : undefined,
                  shelf_location: headerMap.shelf_location !== undefined ? r[headerMap.shelf_location] : undefined,
                });
              } else {
                const name = r[0];
                if (!name) continue;
                parsedItems.push({
                  name,
                  barcode: r[1] || undefined,
                  sale_price: Number(r[2]) || 0,
                  cost_price: Number(r[3]) || 0,
                  quantity: Number(r[4]) || 0,
                  category: r[5] || undefined,
                });
              }
            }
          }
        }

        if (parsedItems.length) {
          countEl.textContent = parsedItems.length;
          previewBody.innerHTML = parsedItems.slice(0, 5).map((p) => `
            <tr class="border-b border-slate-100 hover:bg-slate-50">
              <td class="p-2 font-bold">${esc(p.name)}</td>
              <td class="p-2 font-mono text-slate-500">${esc(p.barcode || '-')}</td>
              <td class="p-2 font-mono text-slate-500">${esc(p.sku || '-')}</td>
              <td class="p-2">${num(p.cost_price || 0)}</td>
              <td class="p-2 font-bold text-indigo-700">${num(p.sale_price || 0)}</td>
              <td class="p-2 font-bold">${num(p.quantity || 0)}</td>
            </tr>
          `).join('');
          previewWrap.classList.remove('hidden');
          submitBtn.disabled = false;
        } else {
          previewWrap.classList.add('hidden');
          submitBtn.disabled = true;
        }
      }

      submitBtn.addEventListener('click', async () => {
        if (!parsedItems.length) return;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="bi bi-hourglass-split animate-spin"></i> جاري الاستيراد...`;
        try {
          const res = await api('POST', '/api/products/bulk-import', { items: parsedItems });
          toast(`تم بنجاح: إضافة ${res.created} صنف وتحديث ${res.updated} صنف`, 'success');
          close();
          onSave && onSave();
        } catch (err) {
          toast(err.message, 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<i class="bi bi-file-earmark-check"></i> تأكيد الاستيراد`;
        }
      });
    },
  });
}
