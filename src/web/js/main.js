import { api, state, money, num, esc, toast, modal, field, hasPerm, applyTheme, toggleTheme } from './core.js';
import * as Pos from './views/pos.js';
import { renderProducts, renderInventory } from './views/inventory.js';
import { renderCustomers, renderSuppliers } from './views/contacts.js';
import { renderSales, renderPurchases } from './views/sales.js';
import { renderAccounting, renderShifts } from './views/accounting.js';
import { renderAi, renderReports } from './views/ai.js';
import { renderAdmin, openSettings } from './views/admin.js';
import { renderReminders } from './views/reminders.js';
import { renderActivity } from './views/activity.js';
import { openSearchPalette } from './views/search.js';
import { renderWorkOrders } from './views/work_orders.js';

const NAV = [
  { key: 'dashboard', name: 'لوحة التحكم', icon: 'bi-speedometer2', perm: null, route: 'dashboard' },
  { key: 'work-orders', name: 'أوامر الشغل والطباعة', icon: 'bi-printer', perm: null, route: 'work-orders' },
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
  { key: 'reminders', name: 'التذكيرات', icon: 'bi-megaphone', perm: 'reminders.view', module: 'reminders', route: 'reminders' },
  { key: 'activity', name: 'سجل النشاط', icon: 'bi-clock-history', perm: 'activity.view', route: 'activity' },
  { key: 'admin', name: 'الإدارة والصلاحيات', icon: 'bi-shield-lock', perm: 'admin.users', module: 'admin', route: 'admin' },
];

const ROUTES = {
  dashboard: renderDashboard,
  'work-orders': renderWorkOrders,
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
  reminders: renderReminders,
  activity: renderActivity,
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
  try { applyTheme(localStorage.getItem('zain_theme') || 'light'); } catch { }
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
  authEl.style.display = '';
  mainEl.classList.add('hidden');
  mainEl.style.display = 'none';
}

async function enterApp() {
  const me = await api('GET', '/api/auth/me');
  state.user = me.user || me;
  const settingsRes = await api('GET', '/api/settings');
  state.settings = settingsRes.settings;
  state.modules = settingsRes.modules || [];
  applyTheme(state.settings.theme === 'dark' ? 'dark' : 'light');
  await refreshShift();

  authEl.classList.add('hidden');
  authEl.style.display = 'none';
  mainEl.classList.remove('hidden');
  mainEl.style.display = '';
  buildNav();

  document.getElementById('userInfo').textContent = state.user.full_name || state.user.username;
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('settingsBtn').onclick = () => openSettings();
  document.getElementById('shiftBtn').onclick = shiftAction;
  document.getElementById('posBtnTop').onclick = () => { location.hash = '#/pos'; };
  document.getElementById('refreshBtn').onclick = () => navigate(currentRoute(), true);
  document.getElementById('themeBtn').onclick = () => toggleTheme();
  document.getElementById('searchBtn').onclick = () => openSearchPalette();
  const bBtn = document.getElementById('branchSelectorBtn');
  if (bBtn) bBtn.onclick = openBranchSelector;
  const mBtn = document.getElementById('mobileSyncBtn');
  if (mBtn) mBtn.onclick = openMobileSyncModal;
  const oBtn = document.getElementById('ownerPinBtn');
  if (oBtn) oBtn.onclick = openOwnerReportsModal;
  const cBtn = document.getElementById('cloudSyncBtn');
  if (cBtn) cBtn.onclick = openCloudSyncModal;
  const lBtn = document.getElementById('licenseBtn');
  if (lBtn) lBtn.onclick = openLicenseModal;
  updateBranchBadge();
  updateLicenseBadge();
  window.onhashchange = () => navigate(currentRoute());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openSearchPalette();
    }
  });
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
  mainEl.style.display = 'none';
  authEl.classList.remove('hidden');
  authEl.style.display = '';
}

function shiftAction() {
  if (state.shift) {
    const expected = Number(state.shift.expected_cash) || 0;
    modal({
      title: 'إغلاق الوردية ومطابقة النقدية',
      size: 'max-w-md',
      body: `
        <div class="space-y-3 text-xs">
          <div class="p-3 bg-[var(--color-bg)] rounded-lg flex items-center justify-between border border-[var(--color-border)]">
            <span class="text-[var(--color-text-mute)]">النقدية المتوقعة في الدرج:</span>
            <strong class="font-mono text-sm font-bold text-[var(--color-primary)]">${money(expected)}</strong>
          </div>
          ${field('النقد الفعلي المعدود في الدرج *', `<input id="clBalance" type="number" step="0.01" class="field w-full font-mono font-bold text-sm" value="${expected.toFixed(0)}" />`)}
          <div id="clDiffBadge" class="text-xs font-bold text-emerald-600 text-center py-1">الدرج مطابق ✓</div>
          ${field('ملاحظات وتبرير العجز (مطلوبة عند وجود عجز) *', '<textarea id="clNotes" rows="2" class="field w-full" placeholder="اكتب سبب العجز إن وُجد أو أي ملاحظات تخص الوردية..."></textarea>')}
        </div>`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="clSave" class="btn btn-danger flex items-center gap-1.5"><i class="bi bi-lock-fill"></i> تأكيد الإغلاق وإرسال التقرير</button>`,
      onMount(wrap, close) {
        const balIn = wrap.querySelector('#clBalance');
        const diffBadge = wrap.querySelector('#clDiffBadge');
        const notesIn = wrap.querySelector('#clNotes');

        const updateDiff = () => {
          const actual = Number(balIn.value) || 0;
          const diff = actual - expected;
          if (diff < -0.01) {
            diffBadge.className = 'text-xs font-bold text-rose-500 text-center py-1 bg-rose-50 dark:bg-rose-950/30 rounded';
            diffBadge.textContent = `يوجد عجز بقيمة ${money(-diff)} — كتابة سبب العجز مطلوبة أدناه`;
          } else if (diff > 0.01) {
            diffBadge.className = 'text-xs font-bold text-blue-500 text-center py-1 bg-blue-50 dark:bg-blue-950/30 rounded';
            diffBadge.textContent = `يوجد زيادة في الدرج بقيمة ${money(diff)}`;
          } else {
            diffBadge.className = 'text-xs font-bold text-emerald-600 text-center py-1 bg-emerald-50 dark:bg-emerald-950/30 rounded';
            diffBadge.textContent = 'الدرج مطابق تماماً للحسابات ✓';
          }
        };

        balIn.addEventListener('input', updateDiff);
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#clSave').addEventListener('click', async () => {
          const actual = Number(balIn.value) || 0;
          const notes = notesIn.value.trim();
          if (actual < expected - 0.01 && !notes) {
            toast('يوجد عجز في الخزينة: يرجى كتابة سبب العجز في الملاحظات قبل الإغلاق', 'error');
            notesIn.focus();
            return;
          }
          try {
            const closeRes = await api('POST', `/api/shifts/${state.shift.id}/close`, { closing_balance: actual, notes });
            toast('تم إغلاق الوردية بنجاح', 'success');
            close();
            await refreshShift();
            if (closeRes && closeRes.whatsapp) openShiftWhatsAppModal(closeRes.whatsapp);
          } catch (e) {
            toast(e.message, 'error');
          }
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

let activeDashBranch = 'all';

async function renderDashboard(c) {
  const q = activeDashBranch !== 'all' ? `?branch=${encodeURIComponent(activeDashBranch)}` : '';
  const d = await api('GET', `/api/dashboard/overview${q}`);
  const reminders = hasPerm('reminders.view') ? await api('GET', '/api/reminders/daily').catch(() => null) : null;
  const maxDay = Math.max(1, ...(d.charts || []).map((x) => Number(x.total)));

  c.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)]">
        <div>
          <h2 class="text-xl font-black">لوحة التحكم ومتابعة الفروع</h2>
          <p class="text-xs text-[var(--color-text-mute)] mt-0.5">مؤشرات الأداء اللحظية، صافي الأرباح، وأوامر الشغل</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-[var(--color-text-mute)]"><i class="bi bi-geo-alt me-1"></i>عرض فرع:</span>
          <select id="dashBranchSel" class="field text-xs font-bold py-1 px-3">
            <option value="all" ${activeDashBranch === 'all' ? 'selected' : ''}>جميع الفروع (مقارنة شاملة)</option>
            ${(d.branches || []).map((b) => `<option value="${esc(b.name)}" ${activeDashBranch === b.name ? 'selected' : ''}>${esc(b.name)} (${esc(b.code)})</option>`).join('')}
          </select>
        </div>
      </div>

      ${d.branches && d.branches.length > 1 && activeDashBranch === 'all' ? `
        <div class="space-y-2">
          <div class="text-xs font-black text-[var(--color-text-mute)] flex items-center gap-1.5">
            <i class="bi bi-arrow-left-right text-[var(--color-primary)]"></i>
            <span>مقارنة أداء الفرعين اليوم</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${d.branches.map((b) => `
              <div class="card p-4 space-y-3 border-t-4 border-t-[var(--color-primary)]">
                <div class="flex items-center justify-between pb-2 border-b border-[var(--color-border)]">
                  <div class="flex items-center gap-2">
                    <span class="badge badge-info font-bold">${esc(b.code)}</span>
                    <strong class="text-sm font-black">${esc(b.name)}</strong>
                  </div>
                  <span class="badge badge-ok text-[11px] font-mono">${num(b.sales_today_count)} فواتير اليوم</span>
                </div>
                <div class="grid grid-cols-2 gap-3 text-xs">
                  <div class="p-2.5 rounded-lg bg-[var(--color-bg)]">
                    <div class="text-[var(--color-text-mute)] text-[11px]">مبيعات اليوم</div>
                    <div class="text-base font-black text-[var(--color-primary)] mt-0.5">${money(b.sales_today)}</div>
                  </div>
                  <div class="p-2.5 rounded-lg bg-[var(--color-bg)]">
                    <div class="text-[var(--color-text-mute)] text-[11px]">صافي أرباح اليوم</div>
                    <div class="text-base font-black text-emerald-600 mt-0.5">${money(b.profit_today)}</div>
                  </div>
                  <div class="p-2.5 rounded-lg bg-[var(--color-bg)]">
                    <div class="text-[var(--color-text-mute)] text-[11px]">مبيعات الشهر</div>
                    <div class="text-sm font-black text-[var(--color-text)] mt-0.5">${money(b.sales_month)}</div>
                  </div>
                  <div class="p-2.5 rounded-lg bg-[var(--color-bg)]">
                    <div class="text-[var(--color-text-mute)] text-[11px]">أوامر الشغل الحية</div>
                    <div class="text-sm font-black text-amber-600 mt-0.5">${num((b.work_orders && b.work_orders.in_progress) || 0)} قيد التنفيذ · ${num((b.work_orders && b.work_orders.ready) || 0)} جاهز</div>
                  </div>
                </div>
                ${b.top_products && b.top_products.length ? `
                  <div class="pt-2 border-t border-[var(--color-border)]">
                    <div class="text-[11px] font-bold text-[var(--color-text-mute)] mb-1">الأكثر مبيعاً في الفرع:</div>
                    <div class="flex flex-wrap gap-1.5">
                      ${b.top_products.slice(0, 3).map((p) => `<span class="badge badge-mute text-[10px]">${esc(p.name)} (${num(p.total_qty)})</span>`).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="kpi-row">
        <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-cart-check"></i></div><div><div class="kpi-value">${money(d.sales_today)}</div><div class="kpi-label">مبيعات اليوم (${num(d.sales_today_count)})</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-graph-up-arrow"></i></div><div><div class="kpi-value">${money(d.profit_today || 0)}</div><div class="kpi-label">صافي أرباح اليوم</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-indigo-100 text-indigo-700"><i class="bi bi-calendar-month"></i></div><div><div class="kpi-value">${money(d.sales_month)}</div><div class="kpi-label">مبيعات الشهر</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-clock-history"></i></div><div><div class="kpi-value">${num((d.work_orders_summary && d.work_orders_summary.in_progress) || 0)}</div><div class="kpi-label">أوامر قيد التنفيذ</div></div></div>
      </div>

      <div class="kpi-row">
        <div class="kpi"><div class="kpi-icon bg-teal-100 text-teal-700"><i class="bi bi-bell"></i></div><div><div class="kpi-value">${num((d.work_orders_summary && d.work_orders_summary.ready) || 0)}</div><div class="kpi-label">أوامر جاهزة للتسليم</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-person-lines-fill"></i></div><div><div class="kpi-value">${money(d.debtors)}</div><div class="kpi-label">ديون العملاء</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-cyan-100 text-cyan-700"><i class="bi bi-truck"></i></div><div><div class="kpi-value">${money(d.creditors)}</div><div class="kpi-label">مستحقات الموردين</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-receipt-cutoff"></i></div><div><div class="kpi-value">${money(d.expenses_today)}</div><div class="kpi-label">مصروفات اليوم</div></div></div>
      </div>

      ${reminders ? `
        <div class="card p-4 border-r-4 border-r-zain-500 flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3">
            <i class="bi bi-megaphone text-2xl text-zain-600"></i>
            <div>
              <div class="font-black">تذكير اليوم — ${esc(reminders.date)}</div>
              <div class="text-xs text-slate-500 mt-0.5">
                ${reminders.sections.length ? reminders.sections.map((s) => `<span class="badge badge-mute mr-1">${esc(s.title)}: ${s.items.length}</span>`).join('') : 'لا توجد تنبيهات اليوم'}
              </div>
            </div>
          </div>
          <a href="#/reminders" class="btn btn-primary btn-sm"><i class="bi bi-arrow-left-circle"></i> عرض التذكير</a>
        </div>
      ` : ''}

      <div class="grid grid-cols-12 gap-4">
        <div class="col-span-12 lg:col-span-7 card p-4">
          <div class="font-black mb-4 flex items-center gap-2"><i class="bi bi-bar-chart text-zain-600"></i> مبيعات آخر 7 أيام</div>
          <div class="flex items-end gap-3 h-52">
            ${d.charts && d.charts.length ? d.charts.map((x) => `
              <div class="flex-1 flex flex-col items-center justify-end gap-1 group" title="${money(x.total)}">
                <span class="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">${money(x.total, '')}</span>
                <div class="w-full bg-gradient-to-t from-zain-600 to-indigo-400 rounded-t-lg transition hover:brightness-110" style="height:${Math.max(4, (Number(x.total) / maxDay) * 100)}%"></div>
                <span class="text-[10px] text-slate-400 font-mono">${esc(String(x.day).slice(5))}</span>
              </div>
            `).join('') : '<div class="w-full text-center text-slate-400 py-12">لا توجد مبيعات في الفترة المحددة</div>'}
          </div>
        </div>
        <div class="col-span-12 lg:col-span-5 card">
          <div class="p-4 border-b border-slate-100 font-black flex items-center justify-between">
            <span>أحدث الفواتير</span>
            <a href="#/sales" class="text-xs font-bold text-[var(--color-primary)]">عرض الكل</a>
          </div>
          <div class="overflow-auto max-h-[46vh]">
            <table class="w-full text-xs">
              <thead><tr><th class="th">الفاتورة</th><th class="th">العميل</th><th class="th">الفرع</th><th class="th">الإجمالي</th></tr></thead>
              <tbody>
                ${d.recent && d.recent.length ? d.recent.map((r) => `
                  <tr class="tr">
                    <td class="td font-mono font-bold text-zain-700">${esc(r.invoice_no)}</td>
                    <td class="td font-semibold">${esc(r.customer_name || 'نقدي')}</td>
                    <td class="td"><span class="badge badge-mute text-[10px]">${esc(r.branch || 'الرئيسي')}</span></td>
                    <td class="td font-bold">${money(r.total)}</td>
                  </tr>
                `).join('') : '<tr><td colspan="4" class="td text-center text-slate-400 py-8">لا توجد فواتير</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  const bSel = c.querySelector('#dashBranchSel');
  if (bSel) {
    bSel.addEventListener('change', (e) => {
      activeDashBranch = e.target.value;
      renderDashboard(c);
    });
  }
}

function currentBranch() {
  return localStorage.getItem('zain_active_branch') || (state.user && state.user.branch) || state.settings.active_branch || 'فرع سموحة';
}

function updateBranchBadge() {
  const el = document.getElementById('currentBranchName');
  if (el) el.textContent = currentBranch();
}

function openBranchSelector() {
  const raw = state.settings.branches || '["الفرع الرئيسي","فرع سموحة","فرع ميت غمر"]';
  let list = ['الفرع الرئيسي', 'فرع سموحة', 'فرع ميت غمر'];
  try { list = JSON.parse(raw); } catch {}
  const cur = currentBranch();
  modal({
    title: 'تحديد فرع العمل النشط',
    size: 'max-w-md',
    body: `
      <div class="space-y-3">
        <div class="text-xs text-slate-500 mb-2">اختر الفرع الذي تعمل عليه لتسجيل الفواتير والورديات باسمه:</div>
        <div class="space-y-2">
          ${list.map((b) => `
            <button data-branch="${esc(b)}" class="w-full p-3 rounded-xl border text-right font-bold flex items-center justify-between transition-all ${b === cur ? 'bg-indigo-50 border-indigo-400 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 hover:bg-slate-50'}">
              <span><i class="bi bi-geo-alt-fill text-indigo-500 ml-2"></i> ${esc(b)}</span>
              ${b === cur ? '<span class="badge badge-ok">النشط حالياً</span>' : ''}
            </button>
          `).join('')}
        </div>
      </div>`,
    footer: `<button data-cancel class="btn btn-ghost">إغلاق</button>`,
    onMount(wrap, close) {
      wrap.querySelectorAll('[data-branch]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.branch;
          localStorage.setItem('zain_active_branch', val);
          state.activeBranch = val;
          updateBranchBadge();
          toast(`تم التبديل إلى ${val}`, 'success');
          close();
        });
      });
    },
  });
}

async function openMobileSyncModal() {
  let net = { port: 4782, mobile_url: `http://${location.hostname}:4782/`, preferred_ip: location.hostname };
  try {
    net = await api('GET', '/api/system/network-info');
  } catch {}
  modal({
    title: 'المتابعة من الهاتف المحمول',
    size: 'max-w-md',
    body: `
      <div class="space-y-4 text-center">
        <div class="w-14 h-14 mx-auto grid place-items-center rounded-2xl bg-emerald-100 text-emerald-700 text-2xl">
          <i class="bi bi-phone"></i>
        </div>
        <div>
          <div class="font-black text-lg">لوحة المالك والمتابعة السريعة</div>
          <p class="text-xs text-slate-500 mt-1">تأكد أن هاتفك متصل بنفس شبكة الواي فاي للكمبيوتر، ثم افتح الرابط التالي:</p>
        </div>
        <div class="card p-3 bg-slate-50 border border-slate-200">
          <div class="text-xs text-slate-400 font-mono">رابط الوصول المحلي:</div>
          <div class="font-mono font-black text-base text-indigo-700 select-all my-1" id="mobUrlText">${esc(net.mobile_url)}</div>
          <button id="copyMobUrl" class="btn btn-ghost btn-sm mt-1"><i class="bi bi-clipboard"></i> نسخ الرابط</button>
        </div>
        <div class="p-3 rounded-xl bg-amber-50 text-amber-800 text-xs text-right space-y-1">
          <div><i class="bi bi-check-circle-fill text-amber-600"></i> بدون إنترنت — يعمل بالكامل عبر شبكة الراوتر / الواي فاي المحلية.</div>
          <div><i class="bi bi-shield-check text-amber-600"></i> متاح للمالك لمتابعة مبيعات فرع سموحة ومتغمر والمخزون مباشرة.</div>
        </div>
      </div>`,
    footer: `<button data-cancel class="btn btn-primary w-full">تم</button>`,
    onMount(wrap) {
      wrap.querySelector('#copyMobUrl').addEventListener('click', () => {
        navigator.clipboard.writeText(net.mobile_url);
        toast('تم نسخ الرابط بنجاح', 'success');
      });
    },
  });
}

async function openOwnerReportsModal() {
  let pin = '';
  if (state.user && state.user.role !== 'admin' && !hasPerm('*')) {
    pin = prompt('أدخل الرقم السري للمالك (PIN):');
    if (!pin) return;
  }
  let data;
  try {
    data = await api('GET', `/api/reports/owner-summary${pin ? `?pin=${encodeURIComponent(pin)}` : ''}`);
  } catch (err) {
    toast(err.message || 'غير مصرح بالاطلاع على أرباح المالك', 'error');
    return;
  }
  const s = data.summary || {};
  modal({
    title: 'تقارير المالك السرية — الأرباح والسيولة',
    size: 'max-w-xl',
    body: `
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="card p-4 bg-emerald-50 border border-emerald-200 text-center">
            <div class="text-xs font-bold text-emerald-600">صافي ربح النشاط</div>
            <div class="text-2xl font-black text-emerald-800 mt-1">${money(s.net_profit)}</div>
            <div class="text-[11px] text-emerald-600 mt-0.5">هامش الربح: ${s.margin_pct || 0}%</div>
          </div>
          <div class="card p-4 bg-indigo-50 border border-indigo-200 text-center">
            <div class="text-xs font-bold text-indigo-600">إجمالي المبيعات</div>
            <div class="text-2xl font-black text-indigo-800 mt-1">${money(s.total_revenue)}</div>
            <div class="text-[11px] text-indigo-600 mt-0.5">${num(s.sales_count)} فاتورة بيع</div>
          </div>
        </div>
        <div class="card p-3">
          <div class="font-bold text-xs text-slate-500 mb-2">توزيع السيولة النقدية والمحافظ الإلكترونية:</div>
          <div class="grid grid-cols-4 gap-2 text-center text-xs">
            ${(data.payments || []).map((p) => {
              const label = { cash: 'نقدي', vodafone_cash: 'فودافون كاش', card: 'بطاقات', wallet: 'محفظة' }[p.method] || p.method;
              const isVodafone = p.method === 'vodafone_cash';
              return `
                <div class="p-2 rounded-lg ${isVodafone ? 'bg-red-50 text-red-700 font-bold border border-red-200' : 'bg-slate-50 text-slate-700'}">
                  <div>${esc(label)}</div>
                  <div class="font-black text-sm mt-0.5">${money(p.amount)}</div>
                </div>`;
            }).join('')}
          </div>
        </div>
        <div class="card p-3">
          <div class="font-bold text-xs text-slate-500 mb-2">حجم المبيعات حسب الفرع (سموحة / متغمر / الرئيسي):</div>
          <div class="space-y-1.5">
            ${(data.branches || []).map((b) => `
              <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-xs">
                <span class="font-bold"><i class="bi bi-geo-alt-fill text-indigo-500 ml-1"></i> ${esc(b.branch)}</span>
                <span class="text-slate-500">${num(b.count)} عملية</span>
                <span class="font-black text-indigo-700">${money(b.total)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>`,
    footer: `<button data-cancel class="btn btn-primary w-full">إغلاق</button>`,
  });
}

async function openCloudSyncModal() {
  let status = { enabled: false, url: '', status: 'idle', pending: 0, synced: 0, failed: 0 };
  try {
    status = await api('GET', '/api/sync/status');
  } catch {}
  modal({
    title: 'المزامنة السحابية للفروع (Cloud Sync)',
    size: 'max-w-md',
    body: `
      <div class="space-y-4 text-center">
        <div class="w-16 h-16 rounded-2xl bg-cyan-100 text-cyan-700 grid place-items-center text-3xl mx-auto shadow-sm">
          <i class="bi bi-cloud-arrow-up"></i>
        </div>
        <div>
          <div class="font-black text-lg">محرك المزامنة السحابية للفروع</div>
          <p class="text-xs text-slate-500 mt-1">نظام Offline-First: يبيع بدون إنترنت وعند توفر الشبكة يزامن البيانات تلقائياً مع السيرفر المركزي وفروع سموحة ومتغمر.</p>
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="card p-2 bg-amber-50 border border-amber-200">
            <div class="text-[11px] text-amber-600 font-bold">بانتظار المزامنة</div>
            <div class="text-lg font-black text-amber-700" id="syncPendingCount">${num(status.pending)}</div>
          </div>
          <div class="card p-2 bg-emerald-50 border border-emerald-200">
            <div class="text-[11px] text-emerald-600 font-bold">تمت مزامنته</div>
            <div class="text-lg font-black text-emerald-700">${num(status.synced)}</div>
          </div>
          <div class="card p-2 bg-slate-50 border border-slate-200">
            <div class="text-[11px] text-slate-500 font-bold">الحالة</div>
            <div class="text-sm font-bold text-slate-700 mt-1">${status.status === 'synced' ? 'متزامن' : status.status === 'offline' ? 'أوفلاين' : 'جاهز'}</div>
          </div>
        </div>
        <div class="text-right space-y-2 card p-3 bg-slate-50 border border-slate-200">
          <label class="label text-xs font-bold text-slate-600">عنوان السيرفر السحابي (Supabase / REST Endpoint):</label>
          <input id="syncCloudUrl" value="${esc(status.url || '')}" class="field font-mono text-xs" placeholder="https://api.yourcloud.com/sync" />
          <div class="flex gap-2 mt-2">
            <button id="saveSyncConfig" class="btn btn-ghost btn-sm flex-1"><i class="bi bi-floppy"></i> حفظ الإعدادات</button>
            <button id="triggerSyncNow" class="btn btn-primary btn-sm flex-1"><i class="bi bi-arrow-repeat"></i> مزامنة الآن</button>
          </div>
        </div>
      </div>`,
    footer: `<button data-cancel class="btn btn-ghost w-full">إغلاق</button>`,
    onMount(wrap, close) {
      wrap.querySelector('#saveSyncConfig').addEventListener('click', async () => {
        const url = wrap.querySelector('#syncCloudUrl').value.trim();
        try {
          await api('POST', '/api/sync/config', { url, enabled: !!url });
          toast('تم حفظ إعدادات السيرفر السحابي', 'success');
        } catch (e) {
          toast(e.message, 'error');
        }
      });
      wrap.querySelector('#triggerSyncNow').addEventListener('click', async () => {
        const btn = wrap.querySelector('#triggerSyncNow');
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-arrow-clockwise animate-spin"></i> جاري المزامنة...';
        try {
          const res = await api('POST', '/api/sync/trigger');
          if (res.ok) {
            toast(`تمت المزامنة بنجاح (${res.synced} عنصر)`, 'success');
            const pendingEl = wrap.querySelector('#syncPendingCount');
            if (pendingEl) pendingEl.textContent = String(res.pending || 0);
          } else {
            toast(res.error || 'تعذر الاتصال بالسيرفر السحابي (العمل مستمر أوفلاين)', 'warning');
          }
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> مزامنة الآن';
        }
      });
    },
  });
}

function openShiftWhatsAppModal(wa) {
  modal({
    title: 'تقرير إغلاق الوردية والواتساب للمدير',
    size: 'max-w-md',
    body: `
      <div class="space-y-3">
        <div class="flex items-center gap-2 text-emerald-800 bg-emerald-50 p-3 rounded-xl border border-emerald-200">
          <i class="bi bi-whatsapp text-2xl text-emerald-600"></i>
          <div>
            <div class="font-bold">تم إغلاق الوردية وتجهيز التقرير</div>
            <div class="text-xs text-emerald-700">يمكنك إرسال التقرير التفصيلي لرقم المدير بالواتساب أو نسخه فوراً.</div>
          </div>
        </div>
        <div class="field-group">
          <label class="label">رقم هاتف المدير (واتساب):</label>
          <input id="shiftMgrPhone" class="field text-left ltr" value="${esc(wa.phone || '')}" placeholder="01012345678" />
        </div>
        <div class="field-group">
          <label class="label">تفاصيل التقرير المرسل:</label>
          <textarea id="shiftWaText" class="field text-xs font-mono h-40 bg-slate-50" readonly>${esc(wa.text || '')}</textarea>
        </div>
      </div>
    `,
    footer: `
      <div class="flex justify-between w-full">
        <button id="shiftSendWa" class="btn btn-success flex items-center gap-1"><i class="bi bi-whatsapp"></i> إرسال لواتساب المدير</button>
        <div class="flex gap-2">
          <button id="shiftCopyWa" class="btn btn-ghost text-slate-700"><i class="bi bi-clipboard"></i> نسخ التقرير</button>
          <button data-cancel class="btn btn-ghost">إغلاق</button>
        </div>
      </div>
    `,
    onMount(wModal, cModal) {
      wModal.querySelector('[data-cancel]').addEventListener('click', cModal);
      wModal.querySelector('#shiftCopyWa').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(wa.text);
          toast('تم نسخ التقرير للحافظة', 'success');
        } catch { toast('تعذر النسخ', 'error'); }
      });
      wModal.querySelector('#shiftSendWa').addEventListener('click', () => {
        const p = wModal.querySelector('#shiftMgrPhone').value.trim();
        let cleanP = p.replace(/[^0-9+]/g, '');
        if (cleanP.startsWith('+')) cleanP = cleanP.substring(1);
        if (/^01[0125]\d{8}$/.test(cleanP)) cleanP = '2' + cleanP;
        const url = `https://wa.me/${cleanP}?text=${encodeURIComponent(wa.text)}`;
        window.open(url, '_blank');
      });
    },
  });
}

async function openLicenseModal() {
  let status = { status: 'trial', days_left: 14, type_label: 'تجريبي', machine_id: 'ZAIN-...' };
  try {
    status = await api('GET', '/api/license/status');
  } catch {}

  const isExpired = status.status === 'expired';
  const isActive = status.status === 'active';

  modal({
    title: 'ترخيص وتفعيل نظام زين ERP',
    size: 'max-w-md',
    body: `
      <div class="space-y-4">
        <div class="p-3 rounded-xl border ${isActive ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : isExpired ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-900'}">
          <div class="flex items-center justify-between">
            <span class="font-bold text-sm">حالة الترخيص الحالية:</span>
            <span class="badge ${isActive ? 'badge-ok' : isExpired ? 'badge-danger' : 'badge-warn'} font-bold">
              ${isActive ? 'مفعّل بنجاح' : isExpired ? 'منتهي الصلاحية' : 'نسخة تجريبية'}
            </span>
          </div>
          <div class="text-xs mt-2 space-y-1">
            <div class="flex justify-between"><span>النوع:</span><b>${esc(status.type_label || 'تجريبي')}</b></div>
            <div class="flex justify-between"><span>تاريخ الانتهاء:</span><b>${esc(status.expires_at || '-')}</b></div>
            ${!isActive ? `<div class="flex justify-between"><span>الأيام المتبقية:</span><b>${status.days_left || 0} يوم</b></div>` : ''}
          </div>
        </div>

        <div class="space-y-1">
          <label class="label">معرّف هذا الجهاز (Machine ID):</label>
          <div class="flex gap-2">
            <input id="licMachId" class="field flex-1 font-mono text-center font-bold text-sky-700 bg-slate-50" value="${esc(status.machine_id || '')}" readonly />
            <button id="licCopyMach" class="btn btn-ghost text-xs" title="نسخ المعرف"><i class="bi bi-clipboard"></i> نسخ</button>
          </div>
          <p class="text-xs text-slate-500">قم بإعطاء هذا المعرّف للإدارة أو مسؤول النظام لتوليد كود التفعيل المناسب لجهازك.</p>
        </div>

        <div class="space-y-1 pt-1 border-t border-slate-200">
          <label class="label">رمز التفعيل (License Key):</label>
          <input id="licKeyInput" class="field font-mono text-center uppercase tracking-wider text-xs" placeholder="ZACT-XXXX-XXXX-XXXX-M20261130-XXXXXXXX" />
        </div>
      </div>
    `,
    footer: `
      <div class="flex justify-between w-full">
        <button id="licActivateBtn" class="btn btn-primary flex items-center gap-1">
          <i class="bi bi-shield-check"></i> تفعيل النظام
        </button>
        <button data-cancel class="btn btn-ghost">إلغاء</button>
      </div>
    `,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      wrap.querySelector('#licCopyMach').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(status.machine_id);
          toast('تم نسخ معرّف الجهاز إلى الحافظة', 'success');
        } catch { toast('تعذر النسخ', 'error'); }
      });
      wrap.querySelector('#licActivateBtn').addEventListener('click', async () => {
        const key = wrap.querySelector('#licKeyInput').value.trim();
        if (!key) {
          toast('يرجى إدخال رمز التفعيل أولاً', 'warning');
          return;
        }
        try {
          await api('POST', '/api/license/activate', { key });
          toast('تم تفعيل النظام بنجاح!', 'success');
          close();
          await updateLicenseBadge();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    },
  });
}

async function updateLicenseBadge() {
  const licText = document.getElementById('licenseText');
  const licBtn = document.getElementById('licenseBtn');
  if (!licBtn) return;
  try {
    const st = await api('GET', '/api/license/status');
    if (st.status === 'active') {
      if (licText) licText.textContent = `${st.type_label}`;
      licBtn.className = 'btn btn-ghost !bg-emerald-50 !text-emerald-800 !border-emerald-200 text-xs font-bold';
    } else if (st.status === 'trial') {
      if (licText) licText.textContent = `تجريبي (${st.days_left}ي)`;
      licBtn.className = 'btn btn-ghost !bg-amber-50 !text-amber-800 !border-amber-200 text-xs font-bold';
    } else {
      if (licText) licText.textContent = `انتهى الترخيص!`;
      licBtn.className = 'btn btn-ghost !bg-rose-50 !text-rose-800 !border-rose-200 text-xs font-bold';
    }
  } catch {}
}

window.ZainApp = { navigate, enterApp, state };
