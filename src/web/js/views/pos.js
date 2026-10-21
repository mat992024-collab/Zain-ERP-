import { api, state, money, esc, toast, modal, field, openPrint, debounce, formToObject } from '../core.js';

let products = [];
let customers = [];
let scanBuffer = '';
let scanTimer = null;
let lastKeyTime = 0;

export async function render(c) {
  state.cart = [];
  state.cartMeta = { customer_id: '', pos_mode: state.settings.default_pos_mode || 'fast', payment_method: 'cash', discount: 0, paid: '' };
  [products, customers] = await Promise.all([
    api('GET', '/api/products?page_size=300').then((r) => r.rows).catch(() => []),
    api('GET', '/api/customers?page_size=300').then((r) => r.rows).catch(() => []),
  ]);

  c.innerHTML = `
    <div class="grid grid-cols-12 gap-4 h-[calc(100vh-112px)]">
      <div class="col-span-7 flex flex-col gap-4">
        <div class="card p-4">
          <div class="flex gap-2">
            <div class="relative flex-1">
              <i class="bi bi-upc-scan absolute top-1/2 -translate-y-1/2 right-3.5 text-zain-500 text-lg"></i>
              <input id="posSearch" class="field !pr-11 !py-3 text-base" placeholder="امسح الباركود أو ابحث عن صنف (F2)..." autocomplete="off" />
            </div>
            <select id="posMode" class="field !w-36">
              <option value="fast" ${state.cartMeta.pos_mode === 'fast' ? 'selected' : ''}>بيع سريع</option>
              <option value="retail" ${state.cartMeta.pos_mode === 'retail' ? 'selected' : ''}>تجزئة</option>
              <option value="wholesale" ${state.cartMeta.pos_mode === 'wholesale' ? 'selected' : ''}>جملة</option>
            </select>
          </div>
          <div id="searchHint" class="text-[11px] text-slate-400 mt-2">قارئ الباركود جاهز — يمكنك المسح مباشرة في أي وقت</div>
        </div>
        <div class="card flex-1 overflow-auto p-4">
          <div id="productGrid" class="grid grid-cols-3 gap-3"></div>
        </div>
      </div>

      <div class="col-span-5 card flex flex-col">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <div class="font-black text-slate-800"><i class="bi bi-cart3 text-zain-500"></i> سلة البيع</div>
          <button id="clearCart" class="btn btn-ghost btn-sm text-rose-500"><i class="bi bi-trash3"></i> تفريغ</button>
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
  });
  c.querySelector('#posMode').addEventListener('change', (e) => {
    state.cartMeta.pos_mode = e.target.value;
    renderCart();
  });
  c.querySelector('#posCustomer').addEventListener('change', (e) => { state.cartMeta.customer_id = e.target.value; });
  c.querySelector('#posDiscount').addEventListener('input', (e) => { state.cartMeta.discount = Number(e.target.value) || 0; renderCart(); });
  c.querySelector('#posTax').addEventListener('input', (e) => { state.cartMeta.tax = Number(e.target.value) || 0; renderCart(); });
  c.querySelector('#clearCart').addEventListener('click', () => { state.cart = []; renderCart(); });
  c.querySelector('#payBtn').addEventListener('click', openPayment);
  renderGrid('');
  renderCart();
  setTimeout(() => search.focus(), 100);

  document.addEventListener('keydown', globalScan);
  c.addEventListener('DOMNodeRemoved', () => document.removeEventListener('keydown', globalScan));
  window.__posCleanup = () => document.removeEventListener('keydown', globalScan);

  function globalScan(e) {
    if (window.location.hash.replace('#/', '') !== 'pos') return;
    const target = e.target;
    const inSearch = target && target.id === 'posSearch';
    if (e.key === 'F9') { e.preventDefault(); openPayment(); return; }
    if (e.key === 'F2') { e.preventDefault(); search.focus(); return; }
    if (!inSearch && e.key.length === 1) {
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
}

function renderGrid(term) {
  const grid = document.getElementById('productGrid');
  const t = (term || '').trim().toLowerCase();
  const list = (t
    ? products.filter((p) => (p.name || '').toLowerCase().includes(t) || (p.barcode || '').includes(t) || (p.part_number || '').toLowerCase().includes(t))
    : products
  ).slice(0, 60);
  if (!list.length) {
    grid.innerHTML = '<div class="col-span-3 text-center text-slate-400 py-10">لا توجد نتائج</div>';
    return;
  }
  grid.innerHTML = list
    .map((p) => `
      <button data-id="${p.id}" class="card p-3 text-right hover:border-zain-400 hover:shadow-md transition-all ${p.quantity <= 0 ? 'opacity-60' : ''}">
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
  const existing = state.cart.find((i) => i.product_id === p.id);
  if (existing) existing.qty += 1;
  else state.cart.push({ product_id: p.id, name: p.name, unit: p.unit, qty: 1, unit_price: priceFor(p), cost_price: p.cost_price, discount: 0, stock: p.quantity });
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

function totals() {
  const sub = state.cart.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const itemsDisc = state.cart.reduce((s, i) => s + i.discount, 0);
  const total = sub - itemsDisc - Number(state.cartMeta.discount || 0) + Number(state.cartMeta.tax || 0);
  return { sub, itemsDisc, total };
}

function updateTotals() {
  const t = totals();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = money(v); };
  set('sumSub', t.sub);
  set('sumDisc', t.itemsDisc + Number(state.cartMeta.discount || 0));
  set('sumTotal', t.total);
}

function openPayment() {
  if (!state.cart.length) { toast('السلة فارغة', 'error'); return; }
  const t = totals();
  modal({
    title: 'إتمام عملية البيع',
    size: 'max-w-md',
    body: `
      <div class="bg-zain-50 rounded-xl p-4 text-center mb-4">
        <div class="text-xs text-zain-600 font-bold">المبلغ المطلوب</div>
        <div class="text-3xl font-black text-zain-700">${money(t.total)}</div>
      </div>
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
      const update = () => {
        const paid = Number(amount.value) || 0;
        changeBox.innerHTML = paid >= t.total
          ? `<span class="text-emerald-600 font-bold">المتبقي للعميل: ${money(paid - t.total)}</span>`
          : `<span class="text-amber-600 font-bold">الباقي على العميل: ${money(t.total - paid)}</span>`;
      };
      amount.addEventListener('input', update);
      update();
      wrap.querySelectorAll('.pm-btn').forEach((b) => b.addEventListener('click', () => {
        method = b.dataset.pm;
        wrap.querySelectorAll('.pm-btn').forEach((x) => { x.className = 'pm-btn btn btn-ghost'; });
        b.className = 'pm-btn btn btn-primary';
        if (method === 'credit') amount.value = 0;
        else amount.value = t.total;
        update();
      }));
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#confirmPay').addEventListener('click', async () => {
        try {
          const res = await api('POST', '/api/sales', {
            items: state.cart.map((i) => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price, discount: i.discount })),
            customer_id: state.cartMeta.customer_id || null,
            pos_mode: state.cartMeta.pos_mode,
            payment_method: method,
            paid: Number(amount.value) || 0,
            discount: Number(state.cartMeta.discount) || 0,
            tax: Number(state.cartMeta.tax) || 0,
            shift_id: state.shift ? state.shift.id : null,
          });
          close();
          state.cart = [];
          const invId = res.invoice.id;
          await Promise.all([
            api('GET', '/api/products?page_size=300').then((r) => { products = r.rows; }).catch(() => {}),
            api('GET', '/api/shifts/current').then((r) => { state.shift = r.shift; renderShiftBadge(); }).catch(() => {}),
          ]);
          renderCart();
          renderGrid('');
          toast(`تم إنشاء الفاتورة ${res.invoice.invoice_no}`, 'success');
          if (confirm('طباعة الفاتورة الآن؟')) openPrint(`/api/print/thermal/${invId}?width=${state.settings.printer_type === 'thermal58' ? 58 : 80}`);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}

function renderShiftBadge() {
  const el = document.getElementById('shiftText');
  if (el) el.textContent = state.shift ? `وردية مفتوحة` : 'فتح وردية';
}
