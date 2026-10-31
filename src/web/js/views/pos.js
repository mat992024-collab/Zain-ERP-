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
  const autoSaved = localStorage.getItem('zain_auto_suspended_cart');
  if (autoSaved) {
    try {
      const parsed = JSON.parse(autoSaved);
      if (Array.isArray(parsed.cart) && parsed.cart.length) {
        state.cart = parsed.cart;
        if (parsed.cartMeta) state.cartMeta = { ...state.cartMeta, ...parsed.cartMeta };
      }
    } catch {}
    localStorage.removeItem('zain_auto_suspended_cart');
  }
  [products, customers] = await Promise.all([
    api('GET', '/api/products?page_size=300').then((r) => r.rows).catch(() => []),
    api('GET', '/api/customers?page_size=300').then((r) => r.rows).catch(() => []),
  ]);
  await loadCurrencies();
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

  const saveAuto = () => {
    try {
      if (state.cart && state.cart.length) {
        localStorage.setItem('zain_auto_suspended_cart', JSON.stringify({ cart: state.cart, cartMeta: state.cartMeta }));
      } else {
        localStorage.removeItem('zain_auto_suspended_cart');
      }
    } catch {}
  };
  window.addEventListener('beforeunload', saveAuto);
  if (window.__posCleanup) window.__posCleanup();
  document.addEventListener('keydown', globalScan);
  window.__posCleanup = () => {
    document.removeEventListener('keydown', globalScan);
    window.removeEventListener('beforeunload', saveAuto);
    saveAuto();
  };
}

function playScanBeep(success = true) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'sawtooth';
    osc.frequency.setValueAtTime(success ? 1760 : 440, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (success ? 0.08 : 0.2));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.09 : 0.22));
  } catch {}
}

function openCashDrawer() {
  playScanBeep(true);
  toast('تم فتح الدرج النقدي', 'info');
}

function globalScan(e) {
  if (window.location.hash.replace('#/', '') !== 'pos') return;
  const target = e.target;
  const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);
  if (e.key === 'F1') { e.preventDefault(); focusSearch(); return; }
  if (e.key === 'F2') {
    e.preventDefault();
    const sel = document.getElementById('posMode');
    if (sel) {
      sel.value = sel.value === 'wholesale' ? 'fast' : 'wholesale';
      state.cartMeta.pos_mode = sel.value;
      toast(sel.value === 'wholesale' ? 'وضع البيع بالجملة' : 'وضع البيع السريع', 'info');
      renderCart();
    }
    return;
  }
  if (e.key === 'F3') { e.preventDefault(); suspendCart(); return; }
  if (e.key === 'F4') { e.preventDefault(); openSuspended(); return; }
  if (e.key === 'F5') { e.preventDefault(); repeatLastSale(); return; }
  if (e.key === 'F6') {
    e.preventDefault();
    const disc = document.getElementById('posDiscount');
    if (disc) { disc.focus(); disc.select(); }
    return;
  }
  if (e.key === 'F7') {
    e.preventDefault();
    const clearBtn = document.getElementById('clearCart');
    if (clearBtn) clearBtn.click();
    return;
  }
  if (e.key === 'F8') {
    e.preventDefault();
    const cust = document.getElementById('posCustomer');
    if (cust) cust.focus();
    return;
  }
  if (e.key === 'F9') { e.preventDefault(); openPayment(); return; }
  if (e.key === 'F10') { e.preventDefault(); openCashDrawer(); return; }
  if (e.key === 'F11') {
    e.preventDefault();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
    return;
  }
  if (e.key === 'F12') { e.preventDefault(); repeatLastSale(); return; }
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
      ${foreignChips(p)}
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
        ${foreignChips(p)}
      </button>`)
    .join('');
  grid.querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => addProduct(products.find((p) => p.id === Number(btn.dataset.id))));
  });
}

export function addByCode(code) {
  const scale = parseScaleCode(code);
  if (scale) {
    const p = findScaleProduct(scale);
    if (p) { playScanBeep(true); addScaleProduct(p, scale); return; }
    api('GET', `/api/products/barcode/${encodeURIComponent(code)}`)
      .then((r) => { playScanBeep(true); products.unshift(r.product); addScaleProduct(r.product, scale); })
      .catch(() => { playScanBeep(false); toast('لم يتم العثور على صنف باركود الميزان', 'error'); });
    return;
  }
  const p = products.find((x) => String(x.barcode) === String(code) || String(x.part_number) === String(code));
  if (p) { playScanBeep(true); addProduct(p); toast(`أضيف: ${p.name}`, 'success'); return; }
  api('GET', `/api/products/barcode/${encodeURIComponent(code)}`)
    .then((r) => { playScanBeep(true); products.unshift(r.product); addProduct(r.product); toast(`أضيف: ${r.product.name}`, 'success'); })
    .catch(() => { playScanBeep(false); toast('لم يتم العثور على الصنف', 'error'); });
}

function parseScaleCode(code) {
  const s = state.settings || {};
  if (String(s.scale_enabled) !== '1') return null;
  const prefix = String(s.scale_prefix || '');
  const raw = String(code || '');
  if (!prefix || !raw.startsWith(prefix)) return null;
  const pluLen = Math.max(Number(s.scale_plu_len) || 5, 1);
  const valLen = Math.max(Number(s.scale_value_len) || 5, 1);
  const rest = raw.slice(prefix.length);
  if (rest.length < pluLen + valLen) return null;
  const plu = rest.slice(0, pluLen);
  const valueRaw = rest.slice(pluLen, pluLen + valLen);
  if (!/^\d+$/.test(plu) || !/^\d+$/.test(valueRaw)) return null;
  const decimals = Math.max(Number(s.scale_value_decimals) || 0, 0);
  return {
    plu,
    value: Number(valueRaw) / 10 ** decimals,
    mode: s.scale_mode === 'price' ? 'price' : 'weight',
  };
}

function findScaleProduct(scale) {
  const key = String(scale.plu).replace(/^0+/, '');
  return products.find((x) => [x.barcode, x.part_number, x.id]
    .some((v) => v !== null && v !== undefined && String(v).replace(/^0+/, '') === key));
}

function addScaleProduct(p, scale) {
  if (!(scale.value > 0)) { toast('قيمة غير صالحة في باركود الميزان', 'error'); return; }
  const stock = Number(p.quantity);
  if (scale.mode === 'weight') {
    const existing = state.cart.find((i) => i.product_id === p.id && i.scale === true);
    const nextQty = roundTo((existing ? existing.qty : 0) + scale.value, 3);
    if (Number.isFinite(stock) && nextQty > stock) {
      toast(`الكمية المتاحة من ${p.name} هي ${stock}`, 'error');
      return;
    }
    if (existing) existing.qty = nextQty;
    else state.cart.push({ product_id: p.id, name: p.name, unit: p.unit, qty: scale.value, unit_price: priceFor(p), cost_price: p.cost_price, discount: 0, tax_rate: Number(p.tax_rate) || 0, stock, scale: true });
  } else {
    state.cart.push({ product_id: p.id, name: p.name, unit: p.unit, qty: 1, unit_price: roundTo(scale.value, 2), cost_price: p.cost_price, discount: 0, tax_rate: Number(p.tax_rate) || 0, stock, scale: true });
  }
  renderCart();
  toast(`أضيف: ${p.name} — ${scale.mode === 'weight' ? roundTo(scale.value, 3) : money(scale.value)}`, 'success');
}

function priceFor(p, qty = 1) {
  const mode = state.cartMeta.pos_mode;
  const hasWholesale = Number(p.wholesale_price) > 0;
  const minQty = Number(p.wholesale_min_qty) || 1;
  if (hasWholesale && (mode === 'wholesale' || (qty >= minQty && minQty > 1))) return Number(p.wholesale_price);
  return Number(p.sale_price);
}

function foreignPriceOf(p, code, fallback) {
  const pr = p && p.prices ? p.prices[code] : null;
  if (pr && Number(pr.sale_price) > 0) return Number(pr.sale_price);
  return Number(fallback) || 0;
}

function foreignChips(p) {
  const codes = Object.keys(p.prices || {});
  if (!codes.length) return '';
  return `<div class="flex gap-1 flex-wrap mt-1">${codes.map((code) => {
    const c = currencies.find((x) => x.code === code);
    const val = roundTo(Number(p.prices[code].sale_price) || 0, c ? c.decimals : 2);
    return `<span class="badge badge-mute">${esc(code)} ${esc(String(val))}</span>`;
  }).join('')}</div>`;
}

function openMeterModal(p) {
  modal({
    title: `حساب الأمتار والمساحة: ${esc(p.name)}`,
    size: 'max-w-sm',
    body: `
      <div class="space-y-3">
        <div class="bg-indigo-50 p-3 rounded-xl text-xs text-indigo-700">
          سعر المتر: <b>${money(p.sale_price)}</b> | الوحدة: <b>${esc(p.unit)}</b>
        </div>
        <div class="grid grid-cols-2 gap-2">
          ${field('الطول (متر)', '<input id="mMtrLen" type="number" step="0.01" value="1" class="field font-bold" />')}
          ${field('العرض (متر)', '<input id="mMtrWid" type="number" step="0.01" value="1" class="field font-bold" />')}
        </div>
        <div class="grid grid-cols-2 gap-2">
          ${field('العدد / القطع', '<input id="mMtrCount" type="number" step="1" value="1" class="field font-bold" />')}
          ${field('إجمالي المساحة (م²)', '<input id="mMtrTotalArea" type="number" step="0.01" value="1" class="field font-bold bg-slate-50" readonly />')}
        </div>
      </div>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="mMtrAdd" class="btn btn-primary"><i class="bi bi-plus-circle"></i> إضافة للسلة</button>`,
    onMount(wrap, close) {
      const lIn = wrap.querySelector('#mMtrLen');
      const wIn = wrap.querySelector('#mMtrWid');
      const cIn = wrap.querySelector('#mMtrCount');
      const tot = wrap.querySelector('#mMtrTotalArea');
      const calc = () => {
        const l = Number(lIn.value) || 0;
        const w = Number(wIn.value) || 0;
        const count = Number(cIn.value) || 1;
        tot.value = roundTo(l * w * count, 3);
      };
      [lIn, wIn, cIn].forEach((el) => el.addEventListener('input', calc));
      wrap.querySelector('#mMtrAdd').addEventListener('click', () => {
        const l = Number(lIn.value) || 0;
        const w = Number(wIn.value) || 0;
        const count = Number(cIn.value) || 1;
        const area = roundTo(l * w * count, 3) || 1;
        state.cart.push({
          product_id: p.id,
          name: p.name,
          unit: p.unit,
          qty: area,
          dimensions: `${l}م × ${w}م (${count} ق)`,
          unit_price: priceFor(p, area),
          cost_price: p.cost_price,
          discount: 0,
          tax_rate: Number(p.tax_rate) || 0,
          stock: Number(p.quantity),
        });
        playScanBeep(true);
        renderCart();
        close();
      });
    },
  });
}

export function addProduct(p) {
  if (!p) return;
  const stock = Number(p.quantity);
  if (Number.isFinite(stock) && stock <= 0) {
    playScanBeep(false);
    toast(`نفد مخزون: ${p.name}`, 'error');
    return;
  }
  if (p.is_meter_unit || p.unit === 'متر' || p.unit === 'متر مربع') {
    openMeterModal(p);
    return;
  }
  const existing = state.cart.find((i) => i.product_id === p.id && !i.dimensions);
  if (existing) {
    if (Number.isFinite(stock) && existing.qty + 1 > stock) {
      playScanBeep(false);
      toast(`الكمية المتاحة من ${p.name} هي ${stock}`, 'error');
      return;
    }
    existing.qty += 1;
    if (!existing.manual_price) existing.unit_price = priceFor(p, existing.qty);
  } else {
    state.cart.push({ product_id: p.id, name: p.name, unit: p.unit, qty: 1, unit_price: priceFor(p, 1), cost_price: p.cost_price, discount: 0, tax_rate: Number(p.tax_rate) || 0, stock });
  }
  playScanBeep(true);
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
          ${i.dimensions ? `<div class="text-[11px] text-indigo-600 font-bold mt-0.5"><i class="bi bi-rulers"></i> ${esc(i.dimensions)}</div>` : ''}
          <div class="flex items-center gap-2 mt-1">
            <input type="number" value="${i.unit_price}" data-price="${idx}" class="field !py-1 !px-2 !w-24 text-xs" />
            <input type="number" value="${i.discount}" data-disc="${idx}" class="field !py-1 !px-2 !w-16 text-xs" placeholder="خصم" />
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button data-minus="${idx}" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">-</button>
          <input type="number" value="${i.qty}" data-qty="${idx}" step="${i.scale ? '0.001' : '1'}" class="field !py-1 !px-1 !w-14 text-center text-sm" />
          <button data-plus="${idx}" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">+</button>
        </div>
        <div class="w-24 text-left font-black text-sm text-zain-700">${money(i.qty * i.unit_price - i.discount)}</div>
        <button data-del="${idx}" class="text-rose-400 hover:text-rose-600"><i class="bi bi-x-lg"></i></button>
      </div>`)
    .join('');
  box.querySelectorAll('[data-qty]').forEach((el) => el.addEventListener('change', (e) => {
    const it = state.cart[+e.target.dataset.qty];
    const min = it.scale ? 0.001 : 1;
    it.qty = Math.max(min, Number(e.target.value) || min);
    const prod = products.find((x) => x.id === it.product_id);
    if (prod && !it.manual_price) it.unit_price = priceFor(prod, it.qty);
    renderCart();
  }));
  box.querySelectorAll('[data-price]').forEach((el) => el.addEventListener('change', async (e) => {
    const idx = +e.target.dataset.price;
    const item = state.cart[idx];
    const oldVal = item.unit_price;
    const newVal = Number(e.target.value) || 0;
    if (newVal !== oldVal && state.user && state.user.role === 'cashier') {
      const pin = prompt('تعديل السعر يتطلب كلمة مرور المدير:');
      if (!pin) { e.target.value = oldVal; return; }
      try {
        await api('POST', '/api/auth/verify-manager', { password: pin });
      } catch {
        toast('كلمة مرور المدير غير صحيحة', 'error');
        e.target.value = oldVal;
        return;
      }
    }
    item.unit_price = newVal;
    item.manual_price = true;
    renderCart();
  }));
  box.querySelectorAll('[data-disc]').forEach((el) => el.addEventListener('change', (e) => { state.cart[+e.target.dataset.disc].discount = Number(e.target.value) || 0; renderCart(); }));
  box.querySelectorAll('[data-plus]').forEach((el) => el.addEventListener('click', () => {
    const it = state.cart[+el.dataset.plus];
    if (it.scale) it.qty = roundTo(it.qty + 0.1, 3);
    else it.qty += 1;
    const prod = products.find((x) => x.id === it.product_id);
    if (prod && !it.manual_price) it.unit_price = priceFor(prod, it.qty);
    renderCart();
  }));
  box.querySelectorAll('[data-minus]').forEach((el) => el.addEventListener('click', () => {
    const it = state.cart[+el.dataset.minus];
    if (it.scale) it.qty = Math.max(0.001, roundTo(it.qty - 0.1, 3));
    else it.qty = Math.max(1, it.qty - 1);
    const prod = products.find((x) => x.id === it.product_id);
    if (prod && !it.manual_price) it.unit_price = priceFor(prod, it.qty);
    renderCart();
  }));
  box.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
    if (await confirmBox('هل أنت متأكد من حذف هذا الصنف من السلة؟')) {
      state.cart.splice(+el.dataset.del, 1);
      renderCart();
    }
  }));
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
        <div class="grid grid-cols-3 gap-2" id="pmRow">
          <button data-pm="cash" class="pm-btn btn btn-primary">نقدي</button>
          <button data-pm="vodafone_cash" class="pm-btn btn btn-ghost text-red-600 font-bold"><i class="bi bi-phone"></i> فودافون كاش</button>
          <button data-pm="card" class="pm-btn btn btn-ghost">بطاقة</button>
          <button data-pm="wallet" class="pm-btn btn btn-ghost">محفظة</button>
          <button data-pm="credit" class="pm-btn btn btn-ghost">آجل</button>
          <button data-pm="mixed" class="pm-btn btn btn-ghost">مختلط</button>
        </div>
      </div>
      <div id="singlePay">
        ${field('المبلغ المدفوع', `<input id="payAmount" type="number" value="${t.total}" class="field !text-lg font-bold" />`)}
      </div>
      <div id="mixedPay" class="hidden">
        <div class="grid grid-cols-2 gap-2">
          ${field('نقدي', `<input id="payCash" type="number" step="0.01" value="${t.total}" class="field font-bold" />`)}
          ${field('فودافون كاش', `<input id="payVodafone" type="number" step="0.01" value="0" class="field font-bold text-red-600" />`)}
          ${field('بطاقة', `<input id="payCard" type="number" step="0.01" value="0" class="field font-bold" />`)}
          ${field('محفظة', `<input id="payWallet" type="number" step="0.01" value="0" class="field font-bold" />`)}
        </div>
        <div class="flex items-center justify-between gap-2 mt-1">
          <button type="button" id="payFill" class="btn btn-ghost btn-sm"><i class="bi bi-magic"></i> توزيع الباقي نقداً</button>
          <div id="mixRemain" class="text-sm font-bold text-slate-500"></div>
        </div>
        <div class="text-[10px] text-slate-400 mt-1">الدفع المقسّم متاح بالعملة الأساسية فقط.</div>
      </div>
      <div id="changeBox" class="mt-3 text-center text-sm"></div>
      <div id="discountLine" class="mt-1 text-center text-[11px] text-slate-500"></div>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="confirmPay" class="btn btn-success"><i class="bi bi-check2-circle"></i> تأكيد وطباعة</button>`,
    onMount(wrap, close) {
      let method = 'cash';
      const singleBox = wrap.querySelector('#singlePay');
      const mixedBox = wrap.querySelector('#mixedPay');
      const amount = wrap.querySelector('#payAmount');
      const cashIn = wrap.querySelector('#payCash');
      const vodafoneIn = wrap.querySelector('#payVodafone');
      const cardIn = wrap.querySelector('#payCard');
      const walletIn = wrap.querySelector('#payWallet');
      const changeBox = wrap.querySelector('#changeBox');
      const mixRemain = wrap.querySelector('#mixRemain');
      const discountLine = wrap.querySelector('#discountLine');
      const curSel = wrap.querySelector('#payCurrency');
      const totalBox = wrap.querySelector('#payTotal');
      const baseLine = wrap.querySelector('#payBaseLine');
      const curOf = () => currencies.find((c) => c.code === (curSel ? curSel.value : base.code)) || base;
      const isForeign = () => !curOf().is_base;
      const itemPriceIn = (item, c) => {
        const p = products.find((x) => Number(x.id) === Number(item.product_id));
        return foreignPriceOf(p, c.code, item.unit_price);
      };
      const totalsIn = (c) => {
        if (c.is_base) {
          return { sub: t.sub, itemsDisc: t.itemsDisc, invDisc: Number(state.cartMeta.discount || 0), tax: t.tax, total: t.total };
        }
        const rate = Number(c.rate) || 1;
        const conv = (v) => (Number(v) || 0) / rate;
        let sub = 0;
        for (const item of state.cart) sub += itemPriceIn(item, c) * item.qty;
        const itemsDisc = state.cart.reduce((s, i) => s + conv(i.discount), 0);
        const invDisc = conv(Number(state.cartMeta.discount || 0));
        const tax = taxMode() === 'inclusive' ? 0 : conv(t.tax);
        const total = sub - itemsDisc - invDisc + tax;
        return { sub, itemsDisc, invDisc, tax, total };
      };
      const totalIn = () => {
        const c = curOf();
        const v = totalsIn(c);
        return c.is_base ? v.total : roundTo(v.total, c.decimals);
      };
      const symbolOf = () => {
        const c = curOf();
        return isForeign() ? (c.symbol || c.code) : (state.settings.currency_symbol || 'د.ع');
      };
      const mixedPaid = () => roundTo((Number(cashIn.value) || 0) + (Number(vodafoneIn ? vodafoneIn.value : 0) || 0) + (Number(cardIn.value) || 0) + (Number(walletIn.value) || 0), curOf().decimals);
      const update = () => {
        const cur = curOf();
        const totalF = totalIn();
        totalBox.textContent = money(totalF, symbolOf());
        const rate = Number(cur.rate) || 1;
        const baseEquivalent = cur.is_base ? t.total : roundTo(totalsIn(cur).total * rate, 2);
        baseLine.textContent = isForeign() ? `يعادل ${money(baseEquivalent)} بسعر 1 ${esc(cur.code)} = ${rate} ${esc(base.code)}` : '';
        const disc = [];
        if (t.itemsDisc) disc.push(`خصم أصناف ${money(t.itemsDisc)}`);
        if (Number(state.cartMeta.discount || 0)) disc.push(`خصم فاتورة ${money(Number(state.cartMeta.discount) || 0)}`);
        discountLine.textContent = disc.length ? `بند الخصم: ${disc.join(' + ')}` : '';
        if (method === 'mixed') {
          const paid = mixedPaid();
          const diff = roundTo(totalF - paid, 2);
          mixRemain.className = `text-sm font-bold ${diff > 0.009 ? 'text-amber-600' : 'text-emerald-600'}`;
          mixRemain.textContent = diff > 0.009 ? `الباقي: ${money(diff, symbolOf())}` : diff < -0.009 ? `المتبقي للعميل: ${money(-diff, symbolOf())}` : 'مكتمل';
          changeBox.innerHTML = '';
        } else {
          const paid = Number(amount.value) || 0;
          changeBox.innerHTML = paid >= totalF
            ? `<span class="text-emerald-600 font-bold">المتبقي للعميل: ${money(paid - totalF, symbolOf())}</span>`
            : `<span class="text-amber-600 font-bold">الباقي على العميل: ${money(totalF - paid, symbolOf())}</span>`;
        }
      };
      const setMethod = (next) => {
        if (next === 'mixed' && isForeign()) {
          toast('الدفع المقسّم متاح بالعملة الأساسية فقط', 'error');
          return;
        }
        method = next;
        wrap.querySelectorAll('.pm-btn').forEach((x) => { x.className = 'pm-btn btn btn-ghost'; });
        const btn = wrap.querySelector(`.pm-btn[data-pm="${method}"]`);
        if (btn) btn.className = 'pm-btn btn btn-primary';
        singleBox.classList.toggle('hidden', method === 'mixed');
        mixedBox.classList.toggle('hidden', method !== 'mixed');
        if (method === 'mixed') {
          cashIn.value = totalIn();
          if (vodafoneIn) vodafoneIn.value = 0;
          cardIn.value = 0;
          walletIn.value = 0;
        } else if (method === 'credit') {
          amount.value = 0;
        } else {
          amount.value = totalIn();
        }
        update();
      };
      amount.addEventListener('input', update);
      [cashIn, vodafoneIn, cardIn, walletIn].filter(Boolean).forEach((el) => el.addEventListener('input', update));
      const fillBtn = wrap.querySelector('#payFill');
      if (fillBtn) fillBtn.addEventListener('click', () => {
        const totalF = totalIn();
        const others = roundTo((Number(cardIn.value) || 0) + (Number(walletIn.value) || 0) + (Number(vodafoneIn ? vodafoneIn.value : 0) || 0), 2);
        cashIn.value = Math.max(roundTo(totalF - others, 2), 0);
        update();
      });
      if (curSel) {
        curSel.addEventListener('change', () => {
          if (method === 'mixed' && isForeign()) setMethod('cash');
          else if (method !== 'mixed') amount.value = method === 'credit' ? 0 : totalIn();
          update();
        });
      }
      update();
      wrap.querySelectorAll('.pm-btn').forEach((b) => b.addEventListener('click', () => setMethod(b.dataset.pm)));
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#confirmPay').addEventListener('click', async () => {
        const cur = curOf();
        const rate = Number(cur.rate) || 1;
        let paidForeign = 0;
        let paidBase = 0;
        let split = null;
        if (method === 'mixed') {
          split = [
            { method: 'cash', amount: roundTo(Number(cashIn.value) || 0, 2) },
            { method: 'vodafone_cash', amount: roundTo(Number(vodafoneIn ? vodafoneIn.value : 0) || 0, 2) },
            { method: 'card', amount: roundTo(Number(cardIn.value) || 0, 2) },
            { method: 'wallet', amount: roundTo(Number(walletIn.value) || 0, 2) },
          ].filter((p) => p.amount > 0);
          const sum = roundTo(split.reduce((s, p) => s + p.amount, 0), 2);
          if (sum <= 0) { toast('أدخل مبالغ الدفع المقسّم', 'error'); return; }
          if (sum < totalIn() - 0.01 && !state.cartMeta.customer_id) { toast('المبلغ المتبقي يتطلب اختيار عميل', 'error'); return; }
          paidBase = sum;
          paidForeign = sum;
        } else {
          paidForeign = Number(amount.value) || 0;
          paidBase = isForeign() ? roundTo(paidForeign * rate, 4) : paidForeign;
        }
        const items = state.cart.map((i) => ({
          product_id: i.product_id,
          qty: i.qty,
          unit_price: isForeign() ? roundTo(itemPriceIn(i, cur) * rate, 4) : i.unit_price,
          discount: i.discount,
        }));
        const send = (force) => submitSale(method, paidBase, force, cur.code, paidForeign, items, split);
        try {
          const res = await send(false);
          close();
          await afterSale(res);
        } catch (err) {
          if (err.code === 'CREDIT_LIMIT') {
            creditLimitWarning(err.details || {}, async () => {
              try {
                const res = await send(true);
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

function submitSale(method, paid, force, currencyCode, paidOriginal, itemsOverride, payments) {
  const branch = localStorage.getItem('zain_active_branch') || (state.user && state.user.branch) || 'فرع سموحة';
  return api('POST', '/api/sales', {
    items: itemsOverride || state.cart.map((i) => ({
      product_id: i.product_id,
      qty: i.qty,
      unit_price: i.unit_price,
      discount: i.discount,
      dimensions: i.dimensions || null,
      unit: i.unit || null,
    })),
    customer_id: state.cartMeta.customer_id || null,
    pos_mode: state.cartMeta.pos_mode,
    payment_method: method,
    paid,
    paid_original: paidOriginal === undefined ? null : paidOriginal,
    currency: currencyCode || null,
    discount: Number(state.cartMeta.discount) || 0,
    tax: taxMode() === 'manual' ? Number(state.cartMeta.tax) || 0 : null,
    shift_id: state.shift ? state.shift.id : null,
    branch,
    order_type: state.cartMeta.pos_mode === 'delivery' ? 'external_delivery' : (state.cartMeta.order_type || 'direct'),
    delivery_status: state.cartMeta.pos_mode === 'delivery' ? 'preparing' : 'completed',
    delivery_notes: state.cartMeta.delivery_notes || null,
    ...(payments ? { payments } : {}),
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
  try { localStorage.removeItem('zain_auto_suspended_cart'); } catch {}
  openCashDrawer();
  const invId = res.invoice.id;
  await Promise.all([
    refreshProducts(),
    api('GET', '/api/shifts/current').then((r) => { state.shift = r.shift; renderShiftBadge(); }).catch(() => {}),
  ]);
  renderCart();
  renderGrid('');
  toast(`تم إنشاء الفاتورة ${res.invoice.invoice_no}`, 'success');

  const waData = res.whatsapp || {};
  modal({
    title: `فاتورة مبيعات ${res.invoice.invoice_no}`,
    size: 'max-w-md',
    body: `
      <div class="text-center py-2 space-y-3">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 mb-1">
          <i class="bi bi-check-circle-fill text-3xl"></i>
        </div>
        <h4 class="text-lg font-bold text-slate-800">تم حفظ الفاتورة بنجاح</h4>
        <p class="text-sm text-slate-500">الإجمالي النهائي: <b class="text-emerald-700 text-base">${money(res.invoice.total)}</b></p>

        <div class="card p-3 bg-slate-50 border border-slate-200 text-right space-y-2 mt-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-700">إرسال تفاصيل الفاتورة للعميل عبر واتساب:</span>
            <i class="bi bi-whatsapp text-emerald-600 text-lg"></i>
          </div>
          <div class="flex gap-2">
            <input id="saleCustPhone" class="field flex-1 text-left ltr text-xs" placeholder="رقم هاتف العميل (مثال: 01012345678)" value="${esc(waData.phone || '')}" />
            <button id="saleSendWa" class="btn btn-success text-xs flex items-center gap-1">
              <i class="bi bi-whatsapp"></i> إرسال واتساب
            </button>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button id="saleCopyWa" class="btn btn-ghost btn-sm text-xs text-slate-600 flex items-center gap-1">
              <i class="bi bi-clipboard"></i> نسخ نص الفاتورة
            </button>
          </div>
        </div>
      </div>
    `,
    footer: `
      <div class="flex justify-between w-full">
        <button id="salePrintThermal" class="btn btn-primary flex items-center gap-1">
          <i class="bi bi-printer"></i> طباعة إيصال
        </button>
        <button data-cancel class="btn btn-ghost">فاتورة جديدة (ESC)</button>
      </div>
    `,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#salePrintThermal').addEventListener('click', () => {
        openPrint(`/api/print/thermal/${invId}?width=${state.settings.printer_type === 'thermal58' ? 58 : 80}`);
      });
      wrap.querySelector('#saleCopyWa').addEventListener('click', async () => {
        if (waData.text) {
          try {
            await navigator.clipboard.writeText(waData.text);
            toast('تم نسخ تفاصيل الفاتورة إلى الحافظة', 'success');
          } catch { toast('تعذر النسخ', 'error'); }
        }
      });
      wrap.querySelector('#saleSendWa').addEventListener('click', () => {
        const p = wrap.querySelector('#saleCustPhone').value.trim();
        if (!p) {
          toast('يرجى إدخال رقم هاتف العميل', 'warning');
          return;
        }
        let cleanP = p.replace(/[^0-9+]/g, '');
        if (cleanP.startsWith('+')) cleanP = cleanP.substring(1);
        if (/^01[0125]\d{8}$/.test(cleanP)) cleanP = '2' + cleanP;
        const url = `https://wa.me/${cleanP}?text=${encodeURIComponent(waData.text || '')}`;
        window.open(url, '_blank');
      });
    },
  });
}

function renderShiftBadge() {
  const el = document.getElementById('shiftText');
  if (el) el.textContent = state.shift ? `وردية مفتوحة` : `فتح وردية`;
}
