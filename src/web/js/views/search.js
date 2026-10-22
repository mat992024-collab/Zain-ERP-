import { api, state, esc, money, num, modal, debounce } from '../core.js';

const TYPE_LABELS = { sale: 'بيع', return_sale: 'مرتجع بيع', purchase: 'شراء', return_purchase: 'مرتجع شراء' };

function group(icon, title, rows, render) {
  if (!rows.length) return '';
  return `
    <div class="mb-4">
      <div class="text-xs font-black text-slate-500 mb-2 flex items-center gap-2"><i class="bi ${icon}"></i> ${title} <span class="badge badge-mute">${rows.length}</span></div>
      <div class="space-y-1">${rows.map(render).join('')}</div>
    </div>`;
}

function itemRow(icon, main, sub, attrs) {
  return `
    <button ${attrs} class="w-full text-right flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-zain-50 transition">
      <span class="w-8 h-8 grid place-items-center rounded-lg bg-slate-100 text-slate-500 shrink-0"><i class="bi ${icon}"></i></span>
      <span class="flex-1 min-w-0">
        <span class="block font-bold text-sm text-slate-700 truncate">${main}</span>
        <span class="block text-xs text-slate-400 truncate">${sub}</span>
      </span>
    </button>`;
}

export function openSearchPalette() {
  const existing = document.querySelector('#gsInput');
  if (existing) { existing.focus(); return; }
  modal({
    title: 'بحث سريع',
    size: 'max-w-2xl',
    body: `
      <div class="relative">
        <i class="bi bi-search absolute top-1/2 -translate-y-1/2 right-3.5 text-slate-400"></i>
        <input id="gsInput" class="field !pr-11 !py-3 text-base" autocomplete="off" placeholder="ابحث عن صنف أو عميل أو مورد أو فاتورة..." />
      </div>
      <div id="gsResults" class="mt-4 max-h-[58vh] overflow-auto">
        <div class="text-center text-slate-400 text-sm py-8">اكتب كلمة للبحث في الأصناف والعملاء والموردين والفواتير</div>
      </div>
      <div class="text-[11px] text-slate-400 mt-3 flex items-center gap-3">
        <span><b class="badge badge-mute">Esc</b> إغلاق</span>
        <span><b class="badge badge-mute">Ctrl</b> + <b class="badge badge-mute">K</b> فتح البحث</span>
      </div>`,
    onMount: (wrap, close) => {
      const input = wrap.querySelector('#gsInput');
      const box = wrap.querySelector('#gsResults');
      const go = (view, q, route) => {
        state.pendingSearch = { view, q };
        close();
        location.hash = route;
      };
      const render = async () => {
        const q = input.value.trim();
        if (!q) {
          box.innerHTML = '<div class="text-center text-slate-400 text-sm py-8">اكتب كلمة للبحث في الأصناف والعملاء والموردين والفواتير</div>';
          return;
        }
        const data = await api('GET', '/api/search?q=' + encodeURIComponent(q));
        if (!data.total) {
          box.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">لا توجد نتائج مطابقة لـ «${esc(q)}»</div>`;
          return;
        }
        box.innerHTML = [
          group('bi-box-seam', 'الأصناف', data.products, (r) => itemRow(
            'bi-box-seam',
            esc(r.name),
            `${esc(r.sku || r.barcode || '')} ${r.category ? '· ' + esc(r.category) : ''} · كمية ${num(r.quantity)} · ${money(r.sale_price)}`,
            `data-go="inventory" data-q="${esc(r.name)}"`
          )),
          group('bi-people', 'العملاء', data.customers, (r) => itemRow(
            'bi-person',
            esc(r.name),
            `${esc(r.phone || 'بدون هاتف')} · الرصيد ${money(r.balance)}`,
            `data-go="customers" data-q="${esc(r.name)}"`
          )),
          group('bi-truck', 'الموردون', data.suppliers, (r) => itemRow(
            'bi-building',
            esc(r.name),
            `${esc(r.phone || 'بدون هاتف')} · الرصيد ${money(r.balance)}`,
            `data-go="suppliers" data-q="${esc(r.name)}"`
          )),
          group('bi-receipt', 'الفواتير', data.invoices, (r) => itemRow(
            'bi-receipt',
            esc(r.invoice_no),
            `${esc(TYPE_LABELS[r.type] || r.type)} · ${esc(r.partner)} · ${esc(String(r.created_at).slice(0, 10))} · ${money(r.total)}`,
            `data-go="sales" data-q="${esc(r.invoice_no)}"`
          )),
        ].join('');
        box.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
          const view = b.dataset.go;
          const route = { inventory: '#/inventory', customers: '#/customers', suppliers: '#/suppliers', sales: '#/sales' }[view];
          go(view, b.dataset.q, route);
        }));
      };
      input.addEventListener('input', debounce(render, 220));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const first = box.querySelector('[data-go]');
          if (first) first.click();
        }
      });
    },
  });
}
