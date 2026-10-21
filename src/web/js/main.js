import { api, state, money, num, esc, toast, modal, field, hasPerm } from './core.js';
import * as Pos from './views/pos.js';
import { renderProducts, renderInventory } from './views/inventory.js';
import { renderCustomers, renderSuppliers } from './views/contacts.js';
import { renderSales, renderPurchases } from './views/sales.js';
import { renderAccounting, renderShifts } from './views/accounting.js';
import { renderAi, renderReports } from './views/ai.js';
import { renderAdmin, openSettings } from './views/admin.js';

const NAV = [
  { key: 'dashboard', name: 'لوحة التحكم', icon: 'bi-speedometer2', perm: null, route: 'dashboard' },
  { key: 'pos', name: 'نقاط البيع', icon: 'bi-cart-check', perm: 'pos.sell', module: 'pos', route: 'pos' },
  { key: 'sales', name: 'فواتير البيع', icon: 'bi-receipt', perm: 'sales.write', module: 'pos', route: 'sales' },
  { key: 'purchases', name: 'المشتريات', icon: 'bi-bag-plus', perm: 'purchases.write', module: 'inventory', route: 'purchases' },
  { key: 'inventory', name: 'المخزون والأصناف', icon: 'bi-box-seam', perm: 'inventory.write', module: 'inventory', route: 'inventory' },
  { key: 'customers', name: 'العملاء', icon: 'bi-people', perm: 'customers.write', module: 'customers', route: 'customers' },
  { key: 'suppliers', name: 'الموردون', icon: 'bi-truck', perm: 'suppliers.write', module: 'suppliers', route: 'suppliers' },
  { key: 'accounting', name: 'المحاسبة والمالية', icon: 'bi-wallet2', perm: 'accounting.write', module: 'accounting', route: 'accounting' },
  { key: 'shifts', name: 'الورديات', icon: 'bi-clock-history', perm: 'pos.shift', module: 'pos', route: 'shifts' },
  { key: 'ai', name: 'الذكاء الاصطناعي', icon: 'bi-cpu', perm: 'ai.use', module: 'ai', route: 'ai' },
  { key: 'reports', name: 'التقارير', icon: 'bi-bar-chart-line', perm: 'accounting.write', module: 'reports', route: 'reports' },
  { key: 'admin', name: 'الإدارة والصلاحيات', icon: 'bi-shield-lock', perm: 'admin.users', module: 'admin', route: 'admin' },
];

const ROUTES = {
  dashboard: renderDashboard,
  pos: (c) => Pos.render(c),
  sales: renderSales,
  purchases: renderPurchases,
  inventory: renderInventory,
  products: renderProducts,
  customers: renderCustomers,
  suppliers: renderSuppliers,
  accounting: renderAccounting,
  shifts: renderShifts,
  ai: renderAi,
  reports: renderReports,
  admin: renderAdmin,
};

const app = document.getElementById('app');
const authEl = document.getElementById('auth');
const mainEl = document.getElementById('main');
const content = document.getElementById('content');
const navEl = document.getElementById('nav');

boot();

async function boot() {
  document.getElementById('loginError').classList.add('hidden');
  const form = document.querySelector('#auth form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const errEl = document.getElementById('loginError');
    btn.disabled = true;
    try {
      const data = await api('POST', '/api/auth/login', {
        username: form.querySelector('input[type=text], input:not([type=password])').value,
        password: form.querySelector('input[type=password]').value,
      });
      state.token = data.token || data.session?.token;
      if (state.token) localStorage.setItem('zain_token', state.token);
      await enterApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });

  if (state.token) {
    try {
      await api('GET', '/api/auth/me');
      await enterApp();
      return;
    } catch { localStorage.removeItem('zain_token'); state.token = null; }
  }
  authEl.classList.remove('hidden');
  mainEl.classList.add('hidden');
}

async function enterApp() {
  const me = await api('GET', '/api/auth/me');
  state.user = me.user || me;
  const settingsRes = await api('GET', '/api/settings');
  state.settings = settingsRes.settings;
  state.modules = settingsRes.modules || [];
  await refreshShift();

  authEl.classList.add('hidden');
  mainEl.classList.remove('hidden');
  buildNav();

  document.getElementById('userInfo').textContent = state.user.full_name || state.user.username;
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('settingsBtn').onclick = () => openSettings();
  document.getElementById('shiftBtn').onclick = shiftAction;
  document.getElementById('posBtnTop').onclick = () => { location.hash = '#/pos'; };
  document.getElementById('refreshBtn').onclick = () => navigate(currentRoute(), true);
  window.onhashchange = () => navigate(currentRoute());
  navigate(currentRoute());
}

async function refreshShift() {
  try {
    const res = await api('GET', '/api/shifts/current');
    state.shift = res.shift;
  } catch { state.shift = null; }
  const txt = document.getElementById('shiftText');
  if (txt) txt.textContent = state.shift ? 'وردية مفتوحة' : 'الورديات';
}

function allowed(item) {
  if (item.perm === null) return true;
  if (!hasPerm(item.perm)) return false;
  if (item.module && state.modules.length) {
    const m = state.modules.find((x) => x.key === item.module);
    if (m && !m.enabled) return false;
  }
  return true;
}

function buildNav() {
  const items = NAV.filter(allowed);
  navEl.innerHTML = items.map((i) => `
    <a href="#/${i.route}" data-nav="${i.route}" class="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold text-indigo-100 hover:bg-white/10 transition">
      <i class="bi ${i.icon} text-lg"></i><span>${esc(i.name)}</span>
    </a>`).join('');
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return ROUTES[hash] ? hash : (NAV.filter(allowed)[0] || { route: 'dashboard' }).route;
}

let rendering = false;
async function navigate(route, force) {
  const key = ROUTES[route] ? route : 'dashboard';
  if (rendering) return;
  rendering = true;
  try {
    navEl.querySelectorAll('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === key;
      a.className = `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold transition ${on ? 'bg-white text-indigo-700 shadow' : 'text-indigo-100 hover:bg-white/10'}`;
    });
    const item = NAV.find((n) => n.route === key);
    document.getElementById('pageTitle').textContent = item ? item.name : 'Zain';
    if (!ROUTES[key]) { content.innerHTML = `<div class="card p-10 text-center text-slate-400">هذه الوحدة غير متاحة لصلاحياتك</div>`; return; }
    content.innerHTML = `<div class="p-10 text-center text-slate-400"><i class="bi bi-arrow-repeat animate-spin text-2xl"></i></div>`;
    await ROUTES[key](content);
  } catch (e) {
    content.innerHTML = `<div class="card p-10 text-center text-rose-500 font-bold">${esc(e.message)}</div>`;
    toast(e.message, 'error');
  } finally {
    rendering = false;
  }
}

async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch {}
  localStorage.removeItem('zain_token');
  state.token = null;
  state.user = null;
  location.hash = '';
  mainEl.classList.add('hidden');
  authEl.classList.remove('hidden');
}

function shiftAction() {
  if (state.shift) {
    modal({
      title: 'إغلاق الوردية',
      size: 'max-w-sm',
      body: `${field('المتوقع في الصندوق', `<input class="field" value="${money(state.shift.expected_cash)}" readonly />`)}
        ${field('النقد المعدود عند الإغلاق', `<input id="clBalance" type="number" class="field" value="${Number(state.shift.expected_cash).toFixed(0)}" />`)}
        ${field('ملاحظات', '<input id="clNotes" class="field" />')}`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="clSave" class="btn btn-danger">إغلاق الوردية</button>`,
      onMount(wrap, close) {
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#clSave').addEventListener('click', async () => {
          try {
            await api('POST', `/api/shifts/${state.shift.id}/close`, { closing_balance: Number(wrap.querySelector('#clBalance').value), notes: wrap.querySelector('#clNotes').value });
            toast('تم إغلاق الوردية', 'success'); close(); await refreshShift();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  } else {
    modal({
      title: 'فتح وردية جديدة',
      size: 'max-w-sm',
      body: `${field('الرصيد الافتتاحي', '<input id="opBalance" type="number" value="0" class="field" />')}
        ${field('الفرع', '<input id="opBranch" class="field" value="main" />')}
        ${field('ملاحظات', '<input id="opNotes" class="field" />')}`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="opSave" class="btn btn-primary">فتح الوردية</button>`,
      onMount(wrap, close) {
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#opSave').addEventListener('click', async () => {
          try {
            await api('POST', '/api/shifts/open', { opening_balance: Number(wrap.querySelector('#opBalance').value), branch: wrap.querySelector('#opBranch').value, notes: wrap.querySelector('#opNotes').value });
            toast('تم فتح الوردية', 'success'); close(); await refreshShift();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }
}

async function renderDashboard(c) {
  const d = await api('GET', '/api/dashboard/overview');
  const maxDay = Math.max(1, ...d.charts.map((x) => Number(x.total)));
  c.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-cart-check"></i></div><div><div class="kpi-value">${money(d.sales_today)}</div><div class="kpi-label">مبيعات اليوم (${num(d.sales_today_count)})</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-wallet2"></i></div><div><div class="kpi-value">${money(d.cash_balance)}</div><div class="kpi-label">رصيد الخزنة</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-indigo-100 text-indigo-700"><i class="bi bi-calendar-month"></i></div><div><div class="kpi-value">${money(d.sales_month)}</div><div class="kpi-label">مبيعات الشهر</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-exclamation-triangle"></i></div><div><div class="kpi-value">${num(d.low_stock)}</div><div class="kpi-label">أصناف منخفضة</div></div></div>
    </div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-icon bg-slate-100 text-slate-600"><i class="bi bi-box-seam"></i></div><div><div class="kpi-value">${money(d.stock_value)}</div><div class="kpi-label">قيمة المخزون</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-person-lines-fill"></i></div><div><div class="kpi-value">${money(d.debtors)}</div><div class="kpi-label">ديون العملاء</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-cyan-100 text-cyan-700"><i class="bi bi-truck"></i></div><div><div class="kpi-value">${money(d.creditors)}</div><div class="kpi-label">مستحقات الموردين</div></div></div>
      <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-receipt-cutoff"></i></div><div><div class="kpi-value">${money(d.expenses_today)}</div><div class="kpi-label">مصروفات اليوم</div></div></div>
    </div>
    <div class="grid grid-cols-12 gap-4">
      <div class="col-span-7 card p-4">
        <div class="font-black mb-4 flex items-center gap-2"><i class="bi bi-bar-chart text-zain-600"></i> مبيعات آخر 7 أيام</div>
        <div class="flex items-end gap-3 h-52">
          ${d.charts.length ? d.charts.map((x) => `<div class="flex-1 flex flex-col items-center justify-end gap-1 group" title="${money(x.total)}">
            <span class="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">${money(x.total, '')}</span>
            <div class="w-full bg-gradient-to-t from-zain-600 to-indigo-400 rounded-t-lg" style="height:${Math.max(4, (Number(x.total) / maxDay) * 100)}%"></div>
            <span class="text-[10px] text-slate-400">${esc(String(x.day).slice(5))}</span></div>`).join('') : '<div class="w-full text-center text-slate-400">لا توجد مبيعات</div>'}
        </div>
      </div>
      <div class="col-span-5 card">
        <div class="p-4 border-b border-slate-100 font-black">أحدث الفواتير</div>
        <div class="overflow-auto max-h-[46vh]"><table class="w-full">
          <thead><tr><th class="th">الفاتورة</th><th class="th">العميل</th><th class="th">الإجمالي</th></tr></thead>
          <tbody>${d.recent.length ? d.recent.map((r) => `<tr class="tr"><td class="td font-mono text-xs font-bold text-zain-700">${esc(r.invoice_no)}</td><td class="td">${esc(r.customer_name || 'نقدي')}</td><td class="td font-bold">${money(r.total)}</td></tr>`).join('') : '<tr><td colspan="3" class="td text-center text-slate-400 py-8">لا توجد فواتير</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
}

window.ZainApp = { navigate, enterApp, state };
