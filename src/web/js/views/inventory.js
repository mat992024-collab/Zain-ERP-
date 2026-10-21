import { api, state, money, num, esc, toast, modal, confirmBox, field, openPrint, debounce, formToObject } from '../core.js';

const BULK_FIELDS = ['name', 'barcode', 'part_number', 'author', 'category', 'brand', 'unit', 'cost_price', 'sale_price', 'wholesale_price', 'quantity', 'reorder_level', 'expiry_date', 'supplier_id', 'track_expiry', 'is_active', 'description'];

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
  const categories = await api('GET', '/api/products/categories').then((r) => r.categories).catch(() => []);
  const suppliers = await api('GET', '/api/suppliers?page_size=200').then((r) => r.rows).catch(() => []);

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
        <button id="pLabel" class="btn btn-ghost"><i class="bi bi-tags"></i> ملصقات باركود</button>
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

  const load = async () => {
    const q = new URLSearchParams({ page, page_size: 50, search, category, low_stock: lowOnly ? '1' : '0' });
    const data = await api('GET', '/api/products?' + q.toString());
    const rows = data.rows;
    c.querySelector('#pCount').textContent = `العدد الكلي: ${data.total}`;
    c.querySelector('#pPage').textContent = `صفحة ${page}`;
    c.querySelector('#pBody').innerHTML = rows.length
      ? rows.map((p) => `
        <tr class="tr">
          <td class="td"><div class="font-bold text-slate-800">${esc(p.name)}</div><div class="text-[11px] text-slate-400">${esc(p.author || p.part_number || '')}</div></td>
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
    c.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => productForm(rows.find((x) => x.id === +b.dataset.edit), { categories, suppliers, onSave: load })));
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
  c.querySelector('#pAdd').addEventListener('click', () => productForm(null, { categories, suppliers, onSave: load }));
  c.querySelector('#pBulk').addEventListener('click', () => bulkForm(categories, load));
  c.querySelector('#pLabel').addEventListener('click', () => labelsForm(null));

  load();
}

function productForm(product, { categories, suppliers, onSave }) {
  const p = product || {};
  const industryFields = { supermarket: ['expiry_date'], bookstore: ['author'], spare_parts: ['part_number', 'brand'] }[state.settings.industry] || [];
  modal({
    title: product ? `تعديل: ${p.name}` : 'صنف جديد',
    size: 'max-w-3xl',
    body: `
      <form id="prodForm" class="grid grid-cols-2 gap-4">
        ${field('اسم الصنف *', `<input name="name" value="${esc(p.name || '')}" class="field" required />`)}
        ${field('الباركود', `<input name="barcode" value="${esc(p.barcode || '')}" class="field font-mono" placeholder="يتم توليده تلقائياً" />`)}
        ${industryFields.includes('part_number') ? field('رقم القطعة', `<input name="part_number" value="${esc(p.part_number || '')}" class="field" />`) : ''}
        ${industryFields.includes('author') ? field('المؤلف', `<input name="author" value="${esc(p.author || '')}" class="field" />`) : ''}
        ${industryFields.includes('brand') ? field('الماركة', `<input name="brand" value="${esc(p.brand || '')}" class="field" />`) : ''}
        ${field('التصنيف', `<input name="category" list="catList" value="${esc(p.category || 'عام')}" class="field" /><datalist id="catList">${(categories || []).map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>`)}
        ${field('وحدة القياس', `<input name="unit" value="${esc(p.unit || 'قطعة')}" class="field" />`)}
        ${field('سعر التكلفة', `<input name="cost_price" type="number" value="${p.cost_price || 0}" class="field" />`)}
        ${field('سعر البيع', `<input name="sale_price" type="number" value="${p.sale_price || 0}" class="field" />`)}
        ${field('سعر الجملة', `<input name="wholesale_price" type="number" value="${p.wholesale_price || 0}" class="field" />`)}
        ${field('الكمية', `<input name="quantity" type="number" value="${p.quantity || 0}" class="field" />`)}
        ${field('حد إعادة الطلب', `<input name="reorder_level" type="number" value="${p.reorder_level ?? 5}" class="field" />`)}
        ${field('المورد', `<select name="supplier_id" class="field"><option value="">—</option>${(suppliers || []).map((s) => `<option value="${s.id}" ${p.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`)}
        ${field('تاريخ الصلاحية', `<input name="expiry_date" type="date" value="${p.expiry_date || ''}" class="field" />`)}
        <div class="flex items-center gap-4 pt-6">
          <label class="flex items-center gap-2 text-sm font-bold text-slate-600"><input type="checkbox" name="track_expiry" ${p.track_expiry ? 'checked' : ''} class="w-4 h-4 accent-zain-500" /> تتبع الصلاحية</label>
          <label class="flex items-center gap-2 text-sm font-bold text-slate-600"><input type="checkbox" name="is_active" ${p.is_active === undefined || p.is_active ? 'checked' : ''} class="w-4 h-4 accent-emerald-500" /> فعال</label>
        </div>
        <div class="col-span-2">${field('ملاحظات', `<textarea name="description" class="field" rows="2">${esc(p.description || '')}</textarea>`)}</div>
      </form>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="prodSave" class="btn btn-primary"><i class="bi bi-check2"></i> حفظ</button>`,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#prodSave').addEventListener('click', async () => {
        const form = wrap.querySelector('#prodForm');
        if (!form.reportValidity()) return;
        const data = formToObject(form);
        for (const k of ['cost_price', 'sale_price', 'wholesale_price', 'quantity', 'reorder_level']) data[k] = Number(data[k]) || 0;
        try {
          if (product) await api('PUT', `/api/products/${product.id}`, data);
          else await api('POST', '/api/products', data);
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
  modal({
    title: 'طباعة ملصقات الباركود',
    size: 'max-w-lg',
    body: `
      ${quick ? '' : `<div class="mb-3">${field('أرقام الأصناف (مفصولة بفاصلة)', '<input id="lblIds" class="field" placeholder="1,2,3" />')}</div>`}
      <div class="mb-3">${field('عدد النسخ لكل صنف', `<input id="lblRepeats" type="number" value="1" min="1" max="50" class="field" />`)}</div>
      <p class="text-xs text-slate-400">سيتم فتح نافذة طباعة تحتوي على ملصقات BarCode (Code128) بحسب مقاس الملصق المحدد في الإعدادات.</p>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="lblPrint" class="btn btn-primary"><i class="bi bi-printer"></i> طباعة</button>`,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#lblPrint').addEventListener('click', async () => {
        const ids = quick ? productIds : wrap.querySelector('#lblIds').value.split(',').map((x) => Number(x.trim())).filter(Boolean);
        if (!ids.length) { toast('أدخل أرقام الأصناف', 'error'); return; }
        const repeats = Number(wrap.querySelector('#lblRepeats').value) || 1;
        try {
          const res = await api('POST', '/api/print/labels?token=' + encodeURIComponent(state.token), { items: ids.map((id) => ({ product_id: id })), repeats });
          if (res.html) {
            const w = window.open('', '_blank');
            w.document.write(res.html);
            w.document.close();
          }
          close();
        } catch (e) { toast(e.message, 'error'); }
      });
    },
  });
}
