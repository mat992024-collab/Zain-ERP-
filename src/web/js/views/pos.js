import { api, state, money, esc, toast, modal, field, openPrint, debounce, confirmBox } from '../core.js';

const SUSPEND_KEY = 'zain_suspended_carts';

let products = [];
let customers = [];
let quick = [];
let lowStock = [];
let currencies = [];
let scanBuffer = '';
let scanTimer = null;
let lastKeyTime = 0;

function roundTo(value, decimals) {
  const factor = 10 ** Math.min(Math.max(Number(decimals) || 0, 0), 4);
  return Math.round((Number(value) || 0) * factor) / factor;
}

async function loadCurrencies() {
  const r = await api('GET', '/api/currencies').catch(() => null);
  currencies = r ? (r.rows || []).filter((c) => c.is_active) : [];
  return currencies;
}

export async function render(c) {
  state.cart = [];
  state.cartMeta = { customer_id: '', pos_mode: state.settings.default_pos_mode || 'fast', payment_method: 'cash', discount: 0, tax: 0, paid: '' };
  [products, customers] = await Promise.all([
    api('GET', '/api/products?page_size=300').then((r) => r.rows).catch(() => []),
    api('GET', '/api/customers?page_size=300').then((r) => r.rows).catch(() => []),
  ]);
  const [q, l] = await Promise.all([
    api('GET', '/api/products/quick?limit=12').then((r) => r.rows).catch(() => []),
    api('GET', '/api/products/low-stock?limit=12').then((r) => r.rows).catch(() => []),
  ]);
  quick = q;
  lowStock = l;

  c.innerHTML = `
    <div class="grid grid-cols-12 gap-4 h-[calc(100vh-112px)]">
      <div class="col-span-7 flex flex-col gap-4">
        <div class="card p-4">
          <div class="flex gap-2">
            <div class="relative flex-1">
              <i class="bi bi-upc-scan absolute top-1/2 -translate-y-1/2 right-3.5 text-zain-500 text-lg"></i>
              <input id="posSearch" class="field !pr-11 !py-3 text-base" placeholder="امسح الباركود أو ابحث عن صنف (F1)..." autocomplete="off" />
            </div>
            <select id="posMode" class="field !w-36">
              <option value="fast" ${state.cartMeta.pos_mode === 'fast' ? 'selected' : ''}>بيع سريع</option>
              <option value="retail" ${state.cartMeta.pos_mode === 'retail' ? 'selected' : ''}>تجزئة</option>
              <option value="wholesale" ${state.cartMeta.pos_mode === 'wholesale' ? 'selected' : ''}>جملة</option>
            </select>
          </div>
          <div id="searchHint" class="text-[11px] text-slate-400 mt-2">قارئ الباركود جاهز — يمكنك المسح مباشرة في أي وقت</div>
        </div>

        <div class="card p-3">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-black text-slate-700"><i class="bi bi-lightning-charge-fill text-amber-500"></i> أصناف سريعة</div>
            <div class="hidden xl:flex items-center gap-2 text-[10px] text-slate-400">
              <kbd class="kbd">F1</kbd> بحث <kbd class="kbd">F3</kbd> تعليق <kbd class="kbd">F4</kbd> معلّقة
              <kbd class="kbd">F5</kbd> تكرار <kbd class="kbd">F9</kbd> دفع
            </div>
          </div>
          <div id="quickItems" class="flex gap-2 mt-2 overflow-x-auto pb-1"></div>
        </div>

        <div id="lowStockBar"></div>

        <div class="card flex-1 overflow-auto p-4">
          <div id="productGrid" class="grid grid-cols-3 gap-3"></div>
        </div>
      </div>

      <div class="col-span-5 card flex flex-col">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div class="font-black text-slate-800"><i class="bi bi-cart3 text-zain-500"></i> سلة البيع</div>
          <div class="flex items-center gap-1">
            <button id="repeatSale" class="btn btn-ghost btn-sm" title="تكرار آخر فاتورة (F5)"><i class="bi bi-arrow-repeat"></i> تكرار</button>
            <button id="suspendCart" class="btn btn-ghost btn-sm" title="تعليق السلة (F3)"><i class="bi bi-pause-circle"></i> تعليق</button>
            <button id="openSuspended" class="btn btn-ghost btn-sm" title="السلال المعلّقة (F4)"><i class="bi bi-collection"></i> معلّقة <span id="suspendCount" class="badge badge-info">0</span></button>
            <button id="clearCart" class="btn btn-ghost btn-sm text-rose-500"><i class="bi bi-trash3"></i> تفريغ</button>
          </div>
        </div>
        <div id="cartItems" class="flex-1 overflow-auto p-3 space-y-2"></div>
        <div class="p-4 border-t border-slate-100 space-y-3 bg-slate-50">
          <select id="posCustomer" class="field">
            <option value="">عميل نقدي</option>
            ${customers.map((cu) => `<option value="${cu.id}">${esc(cu.name)}${cu.balance ? ` (${money(cu.balance)})` : ''}</option>`).join('')}
          </select>
          <div class="grid grid-cols-2 gap-2">
            <div>${field('خصم الفاتورة', '<input name="discount" id="posDiscount" type="number" value="0" class="field" />')}</div>
            <div>${field('الضريبة', '<input name="tax" id="posTax" type="number" value="0" class="field" />')}</div>
          </div>
          <div class="bg-white rounded-xl p-3 space-y-1.5 text-sm">
            <div class="flex justify-between text-slate-500"><span>الإجمالي الفرعي</span><span id="sumSub">0</span></div>
            <div class="flex justify-between text-slate-500"><span>الخصم</span><span id="sumDisc">0</span></div>
            <div class="flex justify-between text-slate-500"><span>الضريبة <span id="taxModeHint" class="text-xs"></span></span><span id="sumTax">0</span></div>
            <div class="flex justify-between font-black text-lg text-zain-700 pt-2 border-t border-dashed border-slate-200"><span>المجموع</span><span id="sumTotal">0</span></div>
          </div>
          <button id="payBtn" class="btn btn-success w-full !py-3 text-base"><i class="bi bi-cash-coin"></i> إتمام البيع (F9)</button>
        </div>
      </div>
    </div>`;

  const search = c.querySelector('#posSearch');
  search.addEventListener('input', debounce((e) => renderGrid(e.target.value), 120));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = e.target.value.trim();
      if (!code) return;
      addByCode(code);
      e.target.value = '';
      renderGrid('');
    }
    if (e.key === 'Escape') {
      e.target.value = '';
      renderGrid('');
    }
  });
  c.querySelector('#posMode').addEventListener('change', (e) => {
    state.cartMeta.pos_mode = e.target.value;
    renderCart();
  });
  c.querySelector('#posCustomer').addEventListener('change', (e) => { state.cartMeta.customer_id = e.target.value; });
  c.querySelector('#posDiscount').addEventListener('input', (e) => { state.cartMeta.discount = Number(e.target.value) || 0; renderCart(); });
  c.querySelector('#posTax').addEventListener('input', (e) => { if (taxMode() !== 'manual') return; state.cartMeta.tax = Number(e.target.value) || 0; renderCart(); });
  c.querySelector('#clearCart').addEventListener('click', async () => {
    if (!state.cart.length) return;
    if (await confirmBox('هل تريد تفريغ السلة؟')) { state.cart = []; renderCart(); }
  });
  c.querySelector('#payBtn').addEventListener('click', openPayment);
  c.querySelector('#repeatSale').addEventListener('click', repeatLastSale);
  c.querySelector('#suspendCart').addEventListener('click', suspendCart);
  c.querySelector('#openSuspended').addEventListener('click', openSuspended);
  renderGrid('');
  renderQuick();
  renderLowStock();
  renderCart();
  updateSuspendCount();
  setTimeout(() => search.focus(), 100);

  if (window.__posCleanup) window.__posCleanup();
  document.addEventListener('keydown', globalScan);
  window.__posCleanup = () => document.removeEventListener('keydown', globalScan);
}

function globalScan(e) {
  if (window.location.hash.replace('#/', '') !== 'pos') return;
  const target = e.target;
  const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);
  if (e.key === 'F9') { e.preventDefault(); openPayment(); return; }
  if (e.key === 'F1' || e.key === 'F2') { e.preventDefault(); focusSearch(); return; }
  if (e.key === 'F3') { e.preventDefault(); suspendCart(); return; }
  if (e.key === 'F4') { e.preventDefault(); openSuspended(); return; }
  if (e.key === 'F5') { e.preventDefault(); repeatLastSale(); return; }
  if (e.key === 'Escape' && target && target.id === 'posSearch') { target.value = ''; renderGrid(''); return; }
  if (!typing && e.key.length === 1) {
    const now = Date.now();
    if (now - lastKeyTime > 400) scanBuffer = '';
    lastKeyTime = now;
    scanBuffer += e.key;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (scanBuffer.length >= 4) {
        addByCode(scanBuffer);
        scanBuffer = '';
      }
    }, 120);
  }
}

function focusSearch() {
  const el = document.getElementById('posSearch');
  if (el) { el.focus(); el.select(); }
}

function renderQuick() {
  const box = document.getElementById('quickItems');
  if (!box) return;
  if (!quick.length) { box.innerHTML = '<div class="text-[11px] text-slate-400 py-1">لا توجد أصناف سريعة بعد</div>'; return; }
  box.innerHTML = quick.map((p) => `
    <button data-qid="${p.id}" class="shrink-0 border border-slate-200 rounded-xl px-3 py-2 text-right hover:border-zain-400 hover:bg-zain-50 transition-colors">
      ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" class="w-8 h-8 rounded-lg object-cover border border-slate-200 mb-1" />` : ''}
      <div class="text-[11px] font-bold text-slate-700 max-w-[130px] truncate">${esc(p.name)}</div>
      <div class="text-[11px] font-black text-zain-600 mt-0.5">${money(p.sale_price)}</div>
      <div class="text-[10px] text-slate-400">${p.sold ? `مبيع ${Number(p.sold).toFixed(0)}` : 'جديد'}</div>
    </button>`).join('');
  box.querySelectorAll('[data-qid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = products.find((x) => x.id === Number(btn.dataset.qid)) || quick.find((x) => x.id === Number(btn.dataset.qid));
      addProduct(p);
    });
  });
}

function renderLowStock() {
  const bar = document.getElementById('lowStockBar');
  if (!bar) return;
  if (!lowStock.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = `
    <div class="card !border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between gap-3">
      <div class="text-[12px] font-bold text-amber-700 flex items-center gap-2 min-w-0">
        <i class="bi bi-exclamation-triangle-fill"></i>
        <span class="truncate">${lowStock.length} صنف تحت الحد: ${esc(lowStock.slice(0, 4).map((p) => `${p.name} (${p.quantity})`).join('، '))}${lowStock.length > 4 ? ' …' : ''}</span>
      </div>
      <button id="lowStockMore" class="btn btn-warning btn-sm shrink-0">عرض الكل</button>
    </div>`;
  bar.querySelector('#lowStockMore').addEventListener('click', () => {
    modal({
      title: 'الأصناف التي وصلت للحد الأدنى',
      size: 'max-w-lg',
      body: `
        <table class="w-full text-sm">
          <thead><tr><th class="th">الصنف</th><th class="th">المتاح</th><th class="th">الحد الأدنى</th><th class="th">النقص</th></tr></thead>
          <tbody>
            ${lowStock.map((p) => `
              <tr>
                <td class="td">${esc(p.name)}</td>
                <td class="td font-black text-amber-600">${p.quantity}</td>
                <td class="td">${p.reorder_level}</td>
                <td class="td">${Math.max(0, p.reorder_level - p.quantity)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`,
    });
  });
}

function renderGrid(term) {
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  const t = (term || '').trim().toLowerCase();
  const list = (t
    ? products.filter((p) => (p.name || '').toLowerCase().includes(t) || String(p.barcode || '').toLowerCase().includes(t) || String(p.part_number || '').toLowerCase().includes(t))
    : products
  ).slice(0, 60);
  if (!list.length) {
    grid.innerHTML = '<div class="col-span-3 text-center text-slate-400 py-10">لا توجد نتائج</div>';
    return;
  }
  grid.innerHTML = list
    .map((p) => `
      <button data-id="${p.id}" class="card p-3 text-right hover:border-zain-400 hover:shadow-md transition-all ${p.quantity <= 0 ? 'opacity-60' : ''}">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" class="w-full h-20 object-cover rounded-lg mb-2 bg-slate-50" />` : ''}
        <div class="font-bold text-sm text-slate-800 line-clamp-2 h-10 overflow-hidden">${esc(p.name)}</div>
        <div class="text-[10px] text-slate-400 font-mono mt-1">${esc(p.barcode || p.part_number || '')}</div>
        <div class="flex items-center justify-between mt-2">
          <span class="font-black text-zain-600">${money(p.sale_price)}</span>
          <span class="badge ${p.quantity <= p.reorder_level ? 'badge-warn' : 'badge-mute'}">${p.quantity}</span>
        </div>
      </button>`)
    .join('');
  grid.querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => addProduct(products.find((p) => p.id === Number(btn.dataset.id))));
  });
}

export function addByCode(code) {
  const p = products.find((x) => String(x.barcode) === String(code) || String(x.part_number) === String(code));
  if (p) { addProduct(p); toast(`أضيف: ${p.name}`, 'success'); return; }
  api('GET', `/api/products/barcode/${encodeURIComponent(code)}`)
    .then((r) => { products.unshift(r.product); addProduct(r.product); toast(`أضيف: ${r.product.name}`, 'success'); })
    .catch(() => toast('لم يتم العثور على الصنف', 'error'));
}

function priceFor(p) {
  const mode = state.cartMeta.pos_mode;
  if (mode === 'wholesale' && Number(p.wholesale_price)) return Number(p.wholesale_price);
  return Number(p.sale_price);
}

export function addProduct(p) {
  if (!p) return;
  const stock = Number(p.quantity);
  if (Number.isFinite(stock) && stock <= 0) {
    toast(`نفد مخزون: ${p.name}`, 'error');
    return;
  }
  const existing = state.cart.find((i) => i.product_id === p.id);
  if (existing) {
    if (Number.isFinite(stock) && existing.qty + 1 > stock) {
      toast(`الكمية المتاحة من ${p.name} هي ${stock}`, 'error');
      return;
    }
    existing.qty += 1;
  } else {
    state.cart.push({ product_id: p.id, name: p.name, unit: p.unit, qty: 1, unit_price: priceFor(p), cost_price: p.cost_price, discount: 0, tax_rate: Number(p.tax_rate) || 0, stock });
  }
  renderCart();
}

function renderCart() {
  const box = document.getElementById('cartItems');
  if (!box) return;
  if (!state.cart.length) {
    box.innerHTML = '<div class="text-center text-slate-400 py-16"><i class="bi bi-basket text-4xl"></i><div class="font-bold mt-2">السلة فارغة</div><div class="text-xs mt-1">امسح الباركود أو اختر صنفاً</div></div>';
    updateTotals();
    return;
  }
  box.innerHTML = state.cart
    .map((i, idx) => `
      <div class="card p-3 flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="font-bold text-sm truncate">${esc(i.name)}</div>
          <div class="flex items-center gap-2 mt-1">
            <input type="number" value="${i.unit_price}" data-price="${idx}" class="field !py-1 !px-2 !w-24 text-xs" />
            <input type="number" value="${i.discount}" data-disc="${idx}" class="field !py-1 !px-2 !w-16 text-xs" placeholder="خصم" />
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button data-minus="${idx}" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">-</button>
          <input type="number" value="${i.qty}" data-qty="${idx}" class="field !py-1 !px-1 !w-14 text-center text-sm" />
          <button data-plus="${idx}" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">+</button>
        </div>
        <div class="w-24 text-left font-black text-sm text-zain-700">${money(i.qty * i.unit_price - i.discount)}</div>
        <button data-del="${idx}" class="text-rose-400 hover:text-rose-600"><i class="bi bi-x-lg"></i></button>
      </div>`)
    .join('');
  box.querySelectorAll('[data-qty]').forEach((el) => el.addEventListener('change', (e) => { state.cart[+e.target.dataset.qty].qty = Math.max(1, Number(e.target.value) || 1); renderCart(); }));
  box.querySelectorAll('[data-price]').forEach((el) => el.addEventListener('change', (e) => { state.cart[+e.target.dataset.price].unit_price = Number(e.target.value) || 0; renderCart(); }));
  box.querySelectorAll('[data-disc]').forEach((el) => el.addEventListener('change', (e) => { state.cart[+e.target.dataset.disc].discount = Number(e.target.value) || 0; renderCart(); }));
  box.querySelectorAll('[data-plus]').forEach((el) => el.addEventListener('click', () => { state.cart[+el.dataset.plus].qty += 1; renderCart(); }));
  box.querySelectorAll('[data-minus]').forEach((el) => el.addEventListener('click', () => { const i = state.cart[+el.dataset.minus]; i.qty = Math.max(1, i.qty - 1); renderCart(); }));
  box.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => { state.cart.splice(+el.dataset.del, 1); renderCart(); }));
  updateTotals();
}

function taxMode() {
  return state.settings.tax_mode || 'manual';
}

function computedTax() {
  const mode = taxMode();
  if (mode === 'manual') return Number(state.cartMeta.tax || 0);
  let total = 0;
  for (const item of state.cart) {
    const rate = Number(item.tax_rate) || 0;
    if (rate <= 0) continue;
    const net = item.qty * item.unit_price - item.discount;
    total += mode === 'inclusive' ? net - net / (1 + rate / 100) : net * rate / 100;
  }
  return Math.round(total * 100) / 100;
}

function totals() {
  const sub = state.cart.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const itemsDisc = state.cart.reduce((s, i) => s + i.discount, 0);
  const tax = computedTax();
  const total = taxMode() === 'inclusive' ? sub - itemsDisc - Number(state.cartMeta.discount || 0) : sub - itemsDisc - Number(state.cartMeta.discount || 0) + tax;
  return { sub, itemsDisc, tax, total };
}

function updateTotals() {
  const t = totals();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = money(v); };
  set('sumSub', t.sub);
  set('sumDisc', t.itemsDisc + Number(state.cartMeta.discount || 0));
  set('sumTax', t.tax);
  set('sumTotal', t.total);
  const taxInput = document.getElementById('posTax');
  const hint = document.getElementById('taxModeHint');
  if (hint) {
    const mode = taxMode();
    hint.textContent = mode === 'auto' ? '(تلقائي)' : mode === 'inclusive' ? '(ضمن السعر)' : '(يدوي)';
  }
  if (taxInput && taxMode() !== 'manual') {
    taxInput.value = String(t.tax);
    taxInput.readOnly = true;
    taxInput.classList.add('bg-slate-100');
  }
}

function loadSuspended() {
  try {
    const raw = localStorage.getItem(SUSPEND_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveSuspended(list) {
  try { localStorage.setItem(SUSPEND_KEY, JSON.stringify(list.slice(-10))); } catch { }
}

function updateSuspendCount() {
  const el = document.getElementById('suspendCount');
  if (el) el.textContent = String(loadSuspended().length);
}

function suspendCart() {
  if (!state.cart.length) { toast('السلة فارغة', 'error'); return; }
  const list = loadSuspended();
  list.push({
    id: Date.now(),
    at: new Date().toISOString(),
    items: state.cart.map((i) => ({ ...i })),
    meta: { ...state.cartMeta },
    total: totals().total,
  });
  saveSuspended(list);
  state.cart = [];
  state.cartMeta = { ...state.cartMeta, customer_id: '', discount: 0, tax: 0 };
  const customerEl = document.getElementById('posCustomer');
  if (customerEl) customerEl.value = '';
  const disc = document.getElementById('posDiscount');
  if (disc) disc.value = '0';
  const tax = document.getElementById('posTax');
  if (tax) tax.value = '0';
  renderCart();
  updateSuspendCount();
  toast('تم تعليق السلة — يمكنك استئنافها لاحقاً', 'success');
}

function openSuspended() {
  const list = loadSuspended();
  modal({
    title: 'السلال المعلّقة',
    size: 'max-w-lg',
    body: list.length ? `
      <div class="space-y-2">
        ${list.map((s) => `
          <div class="card p-3 flex items-center justify-between gap-3" data-sus="${s.id}">
            <div class="min-w-0">
              <div class="font-bold text-sm truncate">${s.items.length} صنف — ${money(s.total)}</div>
              <div class="text-[11px] text-slate-400">${esc(s.items.map((i) => i.name).slice(0, 3).join('، '))} · ${new Date(s.at).toLocaleString('ar-IQ')}</div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button data-resume="${s.id}" class="btn btn-primary btn-sm">استئناف</button>
              <button data-drop="${s.id}" class="btn btn-ghost btn-sm text-rose-500"><i class="bi bi-trash3"></i></button>
            </div>
          </div>`).join('')}
      </div>` : '<div class="text-center text-slate-400 py-8 text-sm">لا توجد سلال معلّقة</div>',
    onMount(wrap, close) {
      wrap.querySelectorAll('[data-resume]').forEach((btn) => btn.addEventListener('click', () => {
        resumeCart(Number(btn.dataset.resume));
        close();
      }));
      wrap.querySelectorAll('[data-drop]').forEach((btn) => btn.addEventListener('click', () => {
        saveSuspended(loadSuspended().filter((s) => s.id !== Number(btn.dataset.drop)));
        updateSuspendCount();
        close();
        openSuspended();
      }));
    },
  });
}

async function resumeCart(id) {
  const list = loadSuspended();
  const entry = list.find((s) => s.id === id);
  if (!entry) return;
  saveSuspended(list.filter((s) => s.id !== id));
  state.cart = entry.items.map((i) => ({ ...i }));
  state.cartMeta = { ...state.cartMeta, ...entry.meta };
  const customerEl = document.getElementById('posCustomer');
  if (customerEl) customerEl.value = state.cartMeta.customer_id || '';
  const disc = document.getElementById('posDiscount');
  if (disc) disc.value = String(state.cartMeta.discount || 0);
  const tax = document.getElementById('posTax');
  if (tax) tax.value = String(state.cartMeta.tax || 0);
  const mode = document.getElementById('posMode');
  if (mode) mode.value = state.cartMeta.pos_mode || 'fast';
  await refreshProducts();
  renderCart();
  updateSuspendCount();
  toast('تم استئناف السلة', 'success');
}

async function repeatLastSale() {
  try {
    const res = await api('GET', '/api/sales/last');
    let added = 0;
    let missing = 0;
    for (const it of res.items) {
      let p = products.find((x) => x.id === it.product_id);
      if (!p) {
        p = await api('GET', `/api/products/${it.product_id}`).then((r) => r.product).catch(() => null);
        if (p) products.unshift(p);
      }
      if (!p) { missing += 1; continue; }
      const qty = Math.max(1, Number(it.qty) || 1);
      const existing = state.cart.find((i) => i.product_id === p.id);
      if (existing) existing.qty += qty;
      else state.cart.push({ product_id: p.id, name: p.name, unit: p.unit, qty, unit_price: Number(it.unit_price) || priceFor(p), cost_price: p.cost_price, discount: Number(it.discount) || 0, tax_rate: Number(p.tax_rate) || 0, stock: p.quantity });
      added += 1;
    }
    if (!added) { toast(missing ? 'أصناف الفاتورة السابقة لم تعد متوفرة' : 'تعذر تحميل الفاتورة', 'error'); return; }
    renderCart();
    toast(`تم تحميل فاتورة ${res.invoice.invoice_no} (${added} صنف)${missing ? ` — ${missing} صنف غير متوفر` : ''}`, 'success');
  } catch (err) {
    toast(err.message || 'لا توجد فاتورة سابقة', 'error');
  }
}

async function refreshProducts() {
  try {
    const r = await api('GET', '/api/products?page_size=300');
    products = r.rows;
  } catch { }
}

function openPayment() {
  if (!state.cart.length) { toast('السلة فارغة', 'error'); return; }
  const t = totals();
  loadCurrencies().then(() => openPaymentModal(t));
}

function openPaymentModal(t) {
  const base = currencies.find((c) => c.is_base) || { code: 'IQD', symbol: state.settings.currency_symbol || 'د.ع', rate: 1, decimals: 0 };
  const hasForeign = currencies.some((c) => !c.is_base);
  modal({
    title: 'إتمام عملية البيع',
    size: 'max-w-md',
    body: `
      <div class="bg-zain-50 rounded-xl p-4 text-center mb-4">
        <div class="text-xs text-zain-600 font-bold">المبلغ المطلوب</div>
        <div class="text-3xl font-black text-zain-700" id="payTotal">${money(t.total)}</div>
        <div class="text-[11px] text-slate-500 mt-1" id="payBaseLine"></div>
      </div>
      ${hasForeign ? field('عملة الدفع', `<select id="payCurrency" class="field">${currencies.map((c) => `<option value="${esc(c.code)}" ${c.is_base ? 'selected' : ''}>${esc(c.code)} — ${esc(c.name)} (${esc(c.symbol || c.code)})</option>`).join('')}</select>`) : ''}
      <div class="mb-3">
        <label class="label">طريقة الدفع</label>
        <div class="grid grid-cols-3 gap-2">
          <button data-pm="cash" class="pm-btn btn btn-primary">نقدي</button>
          <button data-pm="card" class="pm-btn btn btn-ghost">بطاقة</button>
          <button data-pm="credit" class="pm-btn btn btn-ghost">آجل</button>
        </div>
      </div>
      ${field('المبلغ المدفوع', `<input id="payAmount" type="number" value="${t.total}" class="field !text-lg font-bold" />`)}
      <div id="changeBox" class="mt-3 text-center text-sm"></div>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="confirmPay" class="btn btn-success"><i class="bi bi-check2-circle"></i> تأكيد وطباعة</button>`,
    onMount(wrap, close) {
      let method = 'cash';
      const amount = wrap.querySelector('#payAmount');
      const changeBox = wrap.querySelector('#changeBox');
      const curSel = wrap.querySelector('#payCurrency');
      const totalBox = wrap.querySelector('#payTotal');
      const baseLine = wrap.querySelector('#payBaseLine');
      const curOf = () => currencies.find((c) => c.code === (curSel ? curSel.value : base.code)) || base;
      const isForeign = () => !curOf().is_base;
      const totalIn = () => {
        const c = curOf();
        return isForeign() ? roundTo(t.total / (Number(c.rate) || 1), c.decimals) : t.total;
      };
      const symbolOf = () => {
        const c = curOf();
        return isForeign() ? (c.symbol || c.code) : (state.settings.currency_symbol || 'د.ع');
      };
      const update = () => {
        const cur = curOf();
        const totalF = totalIn();
        totalBox.textContent = money(totalF, symbolOf());
        baseLine.textContent = isForeign() ? `يعادل ${money(t.total)} بسعر 1 ${esc(cur.code)} = ${Number(cur.rate) || 1} ${esc(base.code)}` : '';
        const paid = Number(amount.value) || 0;
        changeBox.innerHTML = paid >= totalF
          ? `<span class="text-emerald-600 font-bold">المتبقي للعميل: ${money(paid - totalF, symbolOf())}</span>`
          : `<span class="text-amber-600 font-bold">الباقي على العميل: ${money(totalF - paid, symbolOf())}</span>`;
      };
      amount.addEventListener('input', update);
      if (curSel) {
        curSel.addEventListener('change', () => {
          amount.value = method === 'credit' ? 0 : totalIn();
          update();
        });
      }
      update();
      wrap.querySelectorAll('.pm-btn').forEach((b) => b.addEventListener('click', () => {
        method = b.dataset.pm;
        wrap.querySelectorAll('.pm-btn').forEach((x) => { x.className = 'pm-btn btn btn-ghost'; });
        b.className = 'pm-btn btn btn-primary';
        if (method === 'credit') amount.value = 0;
        else amount.value = totalIn();
        update();
      }));
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#confirmPay').addEventListener('click', async () => {
        const paidForeign = Number(amount.value) || 0;
        const cur = curOf();
        const rate = Number(cur.rate) || 1;
        const paidBase = isForeign() ? roundTo(paidForeign * rate, 4) : paidForeign;
        try {
          const res = await submitSale(method, paidBase, false, cur.code, paidForeign);
          close();
          await afterSale(res);
        } catch (err) {
          if (err.code === 'CREDIT_LIMIT') {
            creditLimitWarning(err.details || {}, async () => {
              try {
                const res = await submitSale(method, paidBase, true, cur.code, paidForeign);
                close();
                await afterSale(res);
              } catch (e2) { toast(e2.message, 'error'); }
            });
            return;
          }
          toast(err.message, 'error');
        }
      });
    },
  });
}

function submitSale(method, paid, force, currencyCode, paidOriginal) {
  return api('POST', '/api/sales', {
    items: state.cart.map((i) => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price, discount: i.discount })),
    customer_id: state.cartMeta.customer_id || null,
    pos_mode: state.cartMeta.pos_mode,
    payment_method: method,
    paid,
    paid_original: paidOriginal === undefined ? null : paidOriginal,
    currency: currencyCode || null,
    discount: Number(state.cartMeta.discount) || 0,
    tax: taxMode() === 'manual' ? Number(state.cartMeta.tax) || 0 : null,
    shift_id: state.shift ? state.shift.id : null,
    ...(force ? { force_credit_limit: true } : {}),
  });
}

function creditLimitWarning(details, onConfirm) {
  modal({
    title: 'تجاوز حد ائتمان العميل',
    size: 'max-w-sm',
    body: `
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm space-y-2">
        <div class="flex justify-between"><span class="text-slate-500">العميل</span><b>${esc(details.customer || '-')}</b></div>
        <div class="flex justify-between"><span class="text-slate-500">حد الائتمان</span><b>${money(details.limit || 0)}</b></div>
        <div class="flex justify-between"><span class="text-slate-500">الرصيد الحالي</span><b>${money(details.current || 0)}</b></div>
        <div class="flex justify-between"><span class="text-slate-500">الرصيد بعد البيع</span><b class="text-rose-600">${money(details.projected || 0)}</b></div>
        <div class="flex justify-between border-t border-amber-200 pt-2"><span class="text-slate-500">التجاوز</span><b class="text-rose-600">${money(details.over || 0)}</b></div>
      </div>
      <p class="text-xs text-slate-500 mt-3">يمكن المتابعة فقط من قبل من يملك صلاحية إدارة الفواتير، وسيُسجَّل التجاوز في سجل النشاط.</p>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء البيع</button><button id="clOk" class="btn btn-warning">متابعة رغم التجاوز</button>`,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#clOk').addEventListener('click', () => { close(); onConfirm(); });
    },
  });
}

async function afterSale(res) {
  state.cart = [];
  const invId = res.invoice.id;
  await Promise.all([
    refreshProducts(),
    api('GET', '/api/shifts/current').then((r) => { state.shift = r.shift; renderShiftBadge(); }).catch(() => {}),
  ]);
  renderCart();
  renderGrid('');
  toast(`تم إنشاء الفاتورة ${res.invoice.invoice_no}`, 'success');
  if (confirm('طباعة الفاتورة الآن؟')) openPrint(`/api/print/thermal/${invId}?width=${state.settings.printer_type === 'thermal58' ? 58 : 80}`);
}

function renderShiftBadge() {
  const el = document.getElementById('shiftText');
  if (el) el.textContent = state.shift ? `وردية مفتوحة` : `فتح وردية`;
}
