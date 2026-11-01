import { api, state, money, num, esc, toast, modal, field, hasPerm } from '../core.js';

let currentView = 'cards';
let currentFilter = { status: '', branch: '', priority: '', search: '', page: 1 };
let branchesList = [];
let cachedOrders = [];
let autoRefreshTimer = null;
let lastMaxOrderId = 0;

function isTechUser() {
  return state.user && (state.user.role === 'technician' || state.user.role === 'designer');
}

function playOrderAlertBeep(isUrgent) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isUrgent ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(isUrgent ? 880 : 587.33, ctx.currentTime);
    if (isUrgent) {
      osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.15);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    }
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isUrgent ? 0.35 : 0.2));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (isUrgent ? 0.35 : 0.2));
  } catch {}
}

export async function renderWorkOrders(container) {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  const isTech = isTechUser();

  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold tracking-tight">أوامر الشغل والطباعة</h1>
            ${isTech ? `<span class="badge badge-info text-xs px-2.5 py-1 flex items-center gap-1"><i class="bi bi-tools"></i> شاشة الورشة والفنيين</span>` : ''}
          </div>
          <p class="text-xs text-[var(--color-text-mute)] mt-0.5">متابعة مراحل التنفيذ، المقاسات، الخامات، والتسليم بين الفروع</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="badge badge-ok text-xs px-2.5 py-1.5 flex items-center gap-1.5" title="يتم فحص الطلبات الجديدة تلقائياً كل 15 ثانية">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span>تحديث حي (15ث)</span>
          </span>
          <div class="inline-flex rounded-lg border border-[var(--color-border)] p-0.5 bg-[var(--color-bg)]">
            <button id="woViewCards" class="px-3 py-1.5 text-xs font-semibold rounded-md transition ${currentView === 'cards' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-mute)] hover:text-[var(--color-text)]'}">
              <i class="bi bi-kanban me-1"></i> كروت المتابعة
            </button>
            <button id="woViewTable" class="px-3 py-1.5 text-xs font-semibold rounded-md transition ${currentView === 'table' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-mute)] hover:text-[var(--color-text)]'}">
              <i class="bi bi-table me-1"></i> جدول الطلبات
            </button>
          </div>
          ${!isTech ? `
            <button id="woAddBtn" class="btn btn-primary btn-sm flex items-center gap-1.5">
              <i class="bi bi-plus-lg"></i>
              <span>أمر شغل جديد</span>
            </button>
          ` : ''}
        </div>
      </div>

      <div id="woStats" class="kpi-row grid grid-cols-2 md:grid-cols-5 gap-3"></div>

      <div class="card p-3 flex flex-wrap items-center gap-2 text-xs">
        <div class="flex-1 min-w-[200px] relative">
          <input id="woSearch" type="search" placeholder="بحث برقم الطلب، اسم العميل، الهاتف، أو البيان..." value="${esc(currentFilter.search)}" class="field w-full pe-8" />
          <i class="bi bi-search absolute left-2.5 top-2.5 text-[var(--color-text-mute)] pointer-events-none"></i>
        </div>
        <select id="woBranchFilter" class="field min-w-[140px]">
          <option value="">جميع الفروع</option>
        </select>
        <select id="woStatusFilter" class="field min-w-[130px]">
          <option value="">جميع المراحل</option>
          <option value="in_progress">قيد التنفيذ</option>
          <option value="ready">جاهز للتسليم</option>
          <option value="delivered">تم التسليم</option>
          <option value="cancelled">ملغي</option>
        </select>
        <select id="woPriorityFilter" class="field min-w-[120px]">
          <option value="">جميع الأولويات</option>
          <option value="normal">عادي</option>
          <option value="high">عالي</option>
          <option value="urgent">مستعجل طوارئ</option>
        </select>
        <button id="woResetFilter" class="btn btn-ghost btn-sm" title="إعادة الضبط">
          <i class="bi bi-arrow-counterclockwise"></i>
        </button>
      </div>

      <div id="woContent"></div>
    </div>
  `;

  await loadBranches();
  setupEvents(container);
  await refresh(container);

  if (!autoRefreshTimer) {
    autoRefreshTimer = setInterval(() => {
      const activeEl = document.getElementById('woContent');
      if (!activeEl) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
        return;
      }
      refresh(container, true);
    }, 15000);
    if (autoRefreshTimer && typeof autoRefreshTimer.unref === 'function') {
      autoRefreshTimer.unref();
    }
  }
}

async function loadBranches() {
  try {
    const res = await api('GET', '/api/branches');
    branchesList = res.rows || [];
    const sel = document.getElementById('woBranchFilter');
    if (sel) {
      sel.innerHTML = '<option value="">جميع الفروع</option>' + branchesList.map((b) => `<option value="${esc(b.name)}" ${currentFilter.branch === b.name ? 'selected' : ''}>${esc(b.name)} (${esc(b.code)})</option>`).join('');
    }
  } catch (err) {
    branchesList = [{ name: 'الفرع الرئيسي', code: 'B1' }, { name: 'الفرع الثاني', code: 'B2' }];
  }
}

function setupEvents(container) {
  const cardsBtn = container.querySelector('#woViewCards');
  const tableBtn = container.querySelector('#woViewTable');
  cardsBtn.addEventListener('click', () => {
    currentView = 'cards';
    cardsBtn.className = 'px-3 py-1.5 text-xs font-semibold rounded-md transition bg-[var(--color-primary)] text-white';
    tableBtn.className = 'px-3 py-1.5 text-xs font-semibold rounded-md transition text-[var(--color-text-mute)] hover:text-[var(--color-text)]';
    renderOrdersView(container);
  });
  tableBtn.addEventListener('click', () => {
    currentView = 'table';
    tableBtn.className = 'px-3 py-1.5 text-xs font-semibold rounded-md transition bg-[var(--color-primary)] text-white';
    cardsBtn.className = 'px-3 py-1.5 text-xs font-semibold rounded-md transition text-[var(--color-text-mute)] hover:text-[var(--color-text)]';
    renderOrdersView(container);
  });

  let searchDebounce = null;
  container.querySelector('#woSearch').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      currentFilter.search = e.target.value.trim();
      currentFilter.page = 1;
      refresh(container);
    }, 300);
  });

  container.querySelector('#woBranchFilter').addEventListener('change', (e) => {
    currentFilter.branch = e.target.value;
    currentFilter.page = 1;
    refresh(container);
  });

  container.querySelector('#woStatusFilter').addEventListener('change', (e) => {
    currentFilter.status = e.target.value;
    currentFilter.page = 1;
    refresh(container);
  });

  container.querySelector('#woPriorityFilter').addEventListener('change', (e) => {
    currentFilter.priority = e.target.value;
    currentFilter.page = 1;
    refresh(container);
  });

  container.querySelector('#woResetFilter').addEventListener('click', () => {
    currentFilter = { status: '', branch: '', priority: '', search: '', page: 1 };
    container.querySelector('#woSearch').value = '';
    container.querySelector('#woBranchFilter').value = '';
    container.querySelector('#woStatusFilter').value = '';
    container.querySelector('#woPriorityFilter').value = '';
    refresh(container);
  });

  const addBtn = container.querySelector('#woAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      openOrderModal(null, () => refresh(container));
    });
  }
}

async function refresh(container, silent = false) {
  const contentEl = container.querySelector('#woContent');
  const statsEl = container.querySelector('#woStats');
  if (!contentEl) return;
  if (!silent) {
    contentEl.innerHTML = '<div class="card p-8 text-center text-sm text-[var(--color-text-mute)]"><i class="bi bi-arrow-repeat animate-spin text-xl block mb-2"></i>جاري تحميل أوامر الشغل...</div>';
  }

  try {
    const q = new URLSearchParams();
    if (currentFilter.status) q.set('status', currentFilter.status);
    if (currentFilter.branch) q.set('branch', currentFilter.branch);
    if (currentFilter.priority) q.set('priority', currentFilter.priority);
    if (currentFilter.search) q.set('search', currentFilter.search);
    q.set('page_size', '100');

    const [ordersRes, statsRes] = await Promise.all([
      api('GET', `/api/work-orders?${q.toString()}`),
      api('GET', `/api/work-orders/stats${currentFilter.branch ? '?branch=' + encodeURIComponent(currentFilter.branch) : ''}`)
    ]);

    const newOrdersList = ordersRes.rows || [];
    const currentMaxId = newOrdersList.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0);

    if (lastMaxOrderId > 0 && currentMaxId > lastMaxOrderId) {
      const arrived = newOrdersList.filter((o) => (Number(o.id) || 0) > lastMaxOrderId);
      if (arrived.length > 0) {
        const hasUrgent = arrived.some((o) => o.priority === 'urgent');
        playOrderAlertBeep(hasUrgent);
        toast(hasUrgent ? 'تنبيه عاجل: وصل أمر شغل طوارئ جديد للورشة!' : 'وصل أمر شغل جديد للورشة', hasUrgent ? 'error' : 'ok');
      }
    }
    if (currentMaxId > 0) {
      lastMaxOrderId = Math.max(lastMaxOrderId, currentMaxId);
    }

    cachedOrders = newOrdersList;
    if (statsEl) renderStats(statsEl, statsRes);
    renderOrdersView(container);
  } catch (err) {
    if (!silent && contentEl) {
      contentEl.innerHTML = `<div class="card p-6 text-center text-sm text-[var(--color-danger)]">حدث خطأ أثناء تحميل البيانات: ${esc(err.message)}</div>`;
    }
  }
}

function renderStats(statsEl, stats) {
  const sMap = {};
  for (const row of stats.byStatus || []) sMap[row.status] = row.count;

  statsEl.innerHTML = `
    <div class="kpi">
      <div class="kpi-icon text-blue-500"><i class="bi bi-layers"></i></div>
      <div class="kpi-value">${num(stats.totalOrders || 0)}</div>
      <div class="kpi-label">إجمالي الطلبات</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon text-amber-500"><i class="bi bi-clock-history"></i></div>
      <div class="kpi-value">${num(sMap['in_progress'] || 0)}</div>
      <div class="kpi-label">قيد التنفيذ</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon text-emerald-500"><i class="bi bi-check2-circle"></i></div>
      <div class="kpi-value">${num(sMap['ready'] || 0)}</div>
      <div class="kpi-label">جاهز للتسليم</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon text-indigo-500"><i class="bi bi-box2-heart"></i></div>
      <div class="kpi-value">${num(sMap['delivered'] || 0)}</div>
      <div class="kpi-label">تم التسليم</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon text-rose-500"><i class="bi bi-exclamation-triangle"></i></div>
      <div class="kpi-value">${num(stats.urgentOrders || 0)}</div>
      <div class="kpi-label">طلبات عاجلة</div>
    </div>
  `;
}

function renderOrdersView(container) {
  const contentEl = container.querySelector('#woContent');
  if (!contentEl) return;
  if (currentView === 'cards') {
    renderKanban(contentEl, container);
  } else {
    renderTable(contentEl, container);
  }
}

const STAGES = [
  { key: 'in_progress', title: 'قيد التنفيذ', color: 'amber', icon: 'bi-gear-wide-connected' },
  { key: 'ready', title: 'جاهز للتسليم', color: 'emerald', icon: 'bi-bell-fill' },
  { key: 'delivered', title: 'تم التسليم والتحصيل', color: 'indigo', icon: 'bi-check-all' },
  { key: 'cancelled', title: 'ملغي', color: 'slate', icon: 'bi-x-circle' },
];

function renderKanban(contentEl, container) {
  const groups = { in_progress: [], ready: [], delivered: [], cancelled: [] };
  for (const o of cachedOrders) {
    if (groups[o.status]) groups[o.status].push(o);
    else groups.in_progress.push(o);
  }

  contentEl.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
      ${STAGES.map((s) => `
        <div class="card p-3 space-y-3 bg-[var(--color-bg)]/50">
          <div class="flex items-center justify-between pb-2 border-b border-[var(--color-border)]">
            <div class="flex items-center gap-2 font-bold text-sm">
              <i class="bi ${s.icon} text-${s.color}-500"></i>
              <span>${s.title}</span>
            </div>
            <span class="badge badge-mute text-xs px-2 py-0.5 font-bold">${num(groups[s.key].length)}</span>
          </div>
          <div class="space-y-2.5 max-h-[calc(100vh-280px)] overflow-y-auto pe-1">
            ${groups[s.key].length === 0 ? `<div class="p-6 text-center text-xs text-[var(--color-text-mute)] border border-dashed border-[var(--color-border)] rounded-lg">لا توجد طلبات</div>` : ''}
            ${groups[s.key].map((o) => renderOrderCard(o)).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  bindOrderActions(contentEl, container);
}

function renderOrderCard(o) {
  const isUrgent = o.priority === 'urgent' || o.priority === 'high';
  const hasRemaining = Number(o.remaining) > 0;
  const isTech = isTechUser();

  return `
    <div class="card p-3 space-y-2.5 text-xs border-r-4 ${isUrgent ? 'border-r-rose-500 shadow-sm' : 'border-r-[var(--color-primary)]'} hover:shadow-md transition bg-[var(--color-surface)]">
      <div class="flex items-start justify-between gap-1">
        <div>
          <span class="font-mono font-bold text-[var(--color-primary)]">${esc(o.order_no)}</span>
          <h3 class="font-bold text-sm text-[var(--color-text)] mt-0.5">${esc(o.title)}</h3>
        </div>
        <div class="flex flex-col items-end gap-1">
          <span class="badge ${isUrgent ? 'badge-danger' : 'badge-mute'} text-[10px]">${o.priority === 'urgent' ? 'طوارئ' : o.priority === 'high' ? 'عالي' : 'عادي'}</span>
          <span class="badge badge-info text-[10px]">${esc(o.branch_name)}</span>
        </div>
      </div>

      <div class="text-[var(--color-text-mute)] flex items-center justify-between">
        <span><i class="bi bi-person me-1"></i>${esc(o.customer_name)}</span>
        ${o.customer_phone ? `<span dir="ltr"><i class="bi bi-telephone me-1"></i>${esc(o.customer_phone)}</span>` : ''}
      </div>

      <div class="p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] space-y-1">
        <div class="flex items-center justify-between font-mono text-[11px]">
          <span class="text-[var(--color-text-mute)]">المقاس:</span>
          <strong class="text-[var(--color-text)]">${num(o.width)}م × ${num(o.height)}م (${num(o.quantity)} قطع)</strong>
        </div>
        ${o.total_area > 0 ? `
          <div class="flex items-center justify-between font-mono text-[11px]">
            <span class="text-[var(--color-text-mute)]">المساحة:</span>
            <span class="font-bold text-[var(--color-primary)]">${num(o.total_area)} م²</span>
          </div>
        ` : ''}
        ${o.material ? `
          <div class="flex items-center justify-between text-[11px] pt-1 border-t border-[var(--color-border)]/50">
            <span class="text-[var(--color-text-mute)]">الخامة:</span>
            <strong class="text-[var(--color-text)]">${esc(o.material)}</strong>
          </div>
        ` : ''}
      </div>

      ${!isTech ? `
        <div class="pt-1.5 border-t border-[var(--color-border)] flex items-center justify-between font-semibold">
          <span>الإجمالي: <strong class="text-[var(--color-text)]">${money(o.total_price)}</strong></span>
          ${hasRemaining ? `<span class="text-rose-500">متبقي: ${money(o.remaining)}</span>` : `<span class="text-emerald-500 text-[11px]">خالص بالكامل</span>`}
        </div>
      ` : ''}

      ${o.delivery_date ? `
        <div class="text-[10px] text-[var(--color-text-mute)] flex items-center gap-1">
          <i class="bi bi-calendar-event"></i>
          <span>التسليم: ${esc(o.delivery_date)}</span>
        </div>
      ` : ''}

      ${o.notes ? `
        <div class="p-1.5 bg-amber-500/10 rounded text-[11px] text-amber-600 dark:text-amber-400">
          <i class="bi bi-sticky me-1"></i>${esc(o.notes)}
        </div>
      ` : ''}

      ${o.transferred_from_branch ? `
        <div class="text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-1 rounded">
          <i class="bi bi-arrow-left-right me-1"></i>محول من: ${esc(o.transferred_from_branch)}
        </div>
      ` : ''}

      ${isTech && o.status === 'in_progress' ? `
        <button class="btn btn-success btn-sm w-full py-2 font-bold flex items-center justify-center gap-1.5 shadow-sm" data-wo-status="${o.id}" data-target-status="ready">
          <i class="bi bi-check2-circle text-base"></i>
          <span>تم الانتهاء والطباعة جاهزة للاستلام</span>
        </button>
      ` : ''}

      ${isTech && o.design_file ? `
        <a href="${esc(o.design_file)}" target="_blank" download="design_${o.order_no}" class="btn btn-primary btn-sm w-full py-1.5 font-bold flex items-center justify-center gap-1.5">
          <i class="bi bi-file-earmark-arrow-down"></i>
          <span>تحميل ملف التصميم</span>
        </a>
      ` : ''}

      ${!isTech ? `
        <div class="pt-2 flex items-center justify-between gap-1 border-t border-[var(--color-border)]">
          <div class="flex items-center gap-1">
            ${o.status === 'in_progress' ? `
              <button class="btn btn-success btn-sm text-[11px] py-1 px-2" data-wo-status="${o.id}" data-target-status="ready" title="تحويل إلى جاهز للتسليم">
                <i class="bi bi-check2"></i> جاهز
              </button>
            ` : ''}
            ${o.status === 'ready' ? `
              <button class="btn btn-primary btn-sm text-[11px] py-1 px-2" data-wo-status="${o.id}" data-target-status="delivered" title="تسليم الطلب للعميل">
                <i class="bi bi-box2"></i> تسليم
              </button>
              <button class="btn btn-ghost btn-sm text-[11px] py-1 px-2 text-emerald-600" data-wo-whatsapp="${o.id}" title="إشعار العميل على الواتساب">
                <i class="bi bi-whatsapp"></i>
              </button>
            ` : ''}
            ${o.design_file ? `
              <a href="${esc(o.design_file)}" target="_blank" class="btn btn-ghost btn-sm text-[11px] py-1 px-2" title="عرض ملف التصميم">
                <i class="bi bi-file-earmark-image"></i>
              </a>
            ` : ''}
          </div>
          <div class="flex items-center gap-1">
            <button class="btn btn-ghost btn-sm text-[11px] py-1 px-1.5" data-wo-transfer="${o.id}" title="نقل إلى فرع آخر">
              <i class="bi bi-arrow-left-right"></i>
            </button>
            <button class="btn btn-ghost btn-sm text-[11px] py-1 px-1.5" data-wo-edit="${o.id}" title="تعديل التفاصيل">
              <i class="bi bi-pencil"></i>
            </button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderTable(contentEl, container) {
  const isTech = isTechUser();

  contentEl.innerHTML = `
    <div class="card overflow-x-auto">
      <table class="w-full text-xs text-right">
        <thead class="bg-[var(--color-bg)] text-[var(--color-text-mute)] border-b border-[var(--color-border)]">
          <tr>
            <th class="th p-2.5">رقم الطلب</th>
            <th class="th p-2.5">العميل</th>
            <th class="th p-2.5">عنوان العمل والمقاس</th>
            <th class="th p-2.5">الخامة</th>
            <th class="th p-2.5">الفرع</th>
            <th class="th p-2.5">الحالة</th>
            <th class="th p-2.5">الأولوية</th>
            ${!isTech ? `
              <th class="th p-2.5">الإجمالي</th>
              <th class="th p-2.5">المتبقي</th>
            ` : ''}
            <th class="th p-2.5">موعد التسليم</th>
            <th class="th p-2.5 text-center">إجراءات</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--color-border)]">
          ${cachedOrders.length === 0 ? `<tr><td colspan="${isTech ? 9 : 11}" class="p-8 text-center text-sm text-[var(--color-text-mute)]">لا توجد أوامر شغل مسجلة</td></tr>` : ''}
          ${cachedOrders.map((o) => `
            <tr class="hover:bg-[var(--color-bg)]/40 transition">
              <td class="td p-2.5 font-mono font-bold text-[var(--color-primary)]">${esc(o.order_no)}</td>
              <td class="td p-2.5">
                <div class="font-bold">${esc(o.customer_name)}</div>
                <div class="text-[10px] text-[var(--color-text-mute)]" dir="ltr">${esc(o.customer_phone || '')}</div>
              </td>
              <td class="td p-2.5">
                <div class="font-semibold">${esc(o.title)}</div>
                ${o.total_area > 0 ? `<div class="text-[10px] text-[var(--color-text-mute)] font-mono">${num(o.width)}×${num(o.height)}م (${num(o.total_area)}م² × ${num(o.quantity)})</div>` : ''}
              </td>
              <td class="td p-2.5 font-semibold text-[var(--color-text)]">${esc(o.material || '-')}</td>
              <td class="td p-2.5"><span class="badge badge-info">${esc(o.branch_name)}</span></td>
              <td class="td p-2.5">${statusBadge(o.status)}</td>
              <td class="td p-2.5"><span class="badge ${o.priority === 'urgent' ? 'badge-danger' : o.priority === 'high' ? 'badge-warn' : 'badge-mute'}">${o.priority === 'urgent' ? 'طوارئ' : o.priority === 'high' ? 'عالي' : 'عادي'}</span></td>
              ${!isTech ? `
                <td class="td p-2.5 font-bold">${money(o.total_price)}</td>
                <td class="td p-2.5 font-bold ${Number(o.remaining) > 0 ? 'text-rose-500' : 'text-emerald-500'}">${money(o.remaining)}</td>
              ` : ''}
              <td class="td p-2.5 text-[11px] text-[var(--color-text-mute)]">${esc(o.delivery_date || '-')}</td>
              <td class="td p-2.5 text-center">
                <div class="flex items-center justify-center gap-1">
                  ${o.status === 'in_progress' ? `
                    <button class="btn btn-success btn-sm py-1 px-2 text-[11px]" data-wo-status="${o.id}" data-target-status="ready" title="تم الانتهاء وجاهز للتسليم">
                      <i class="bi bi-check2"></i> ${isTech ? 'جاهز' : ''}
                    </button>
                  ` : ''}
                  ${!isTech && o.status === 'ready' ? `
                    <button class="btn btn-primary btn-sm py-1 px-2 text-[11px]" data-wo-status="${o.id}" data-target-status="delivered" title="تسليم">
                      <i class="bi bi-box2"></i>
                    </button>
                    <button class="btn btn-ghost btn-sm py-1 px-2 text-[11px] text-emerald-600" data-wo-whatsapp="${o.id}" title="واتساب">
                      <i class="bi bi-whatsapp"></i>
                    </button>
                  ` : ''}
                  ${o.design_file ? `
                    <a href="${esc(o.design_file)}" target="_blank" download="design_${o.order_no}" class="btn btn-ghost btn-sm py-1 px-2 text-[11px]" title="تحميل أو عرض التصميم">
                      <i class="bi bi-file-earmark-image"></i>
                    </a>
                  ` : ''}
                  ${!isTech ? `
                    <button class="btn btn-ghost btn-sm py-1 px-2 text-[11px]" data-wo-transfer="${o.id}" title="نقل لفرع">
                      <i class="bi bi-arrow-left-right"></i>
                    </button>
                    <button class="btn btn-ghost btn-sm py-1 px-2 text-[11px]" data-wo-edit="${o.id}" title="تعديل">
                      <i class="bi bi-pencil"></i>
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  bindOrderActions(contentEl, container);
}

function statusBadge(status) {
  if (status === 'in_progress') return '<span class="badge badge-warn">قيد التنفيذ</span>';
  if (status === 'ready') return '<span class="badge badge-ok">جاهز للتسليم</span>';
  if (status === 'delivered') return '<span class="badge badge-info">تم التسليم</span>';
  return '<span class="badge badge-mute">ملغي</span>';
}

function bindOrderActions(contentEl, container) {
  contentEl.querySelectorAll('[data-wo-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.woStatus;
      const target = btn.dataset.targetStatus;
      try {
        await api('PATCH', `/api/work-orders/${id}/status`, { status: target });
        toast('تم تحديث حالة الطلب بنجاح', 'ok');
        refresh(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  contentEl.querySelectorAll('[data-wo-whatsapp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.woWhatsapp;
      const order = cachedOrders.find((x) => String(x.id) === String(id));
      if (!order) return;
      openWhatsAppModal(order);
    });
  });

  contentEl.querySelectorAll('[data-wo-transfer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.woTransfer;
      const order = cachedOrders.find((x) => String(x.id) === String(id));
      if (!order) return;
      openTransferModal(order, () => refresh(container));
    });
  });

  contentEl.querySelectorAll('[data-wo-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.woEdit;
      const order = cachedOrders.find((x) => String(x.id) === String(id));
      openOrderModal(order, () => refresh(container));
    });
  });
}

function openOrderModal(order, onSaved) {
  const isEdit = !!order;
  const m = modal({
    title: isEdit ? `تعديل أمر شغل: ${order.order_no}` : 'تسجيل أمر شغل وطباعة جديد',
    content: `
      <form id="woForm" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${field('اسم العميل *', '<input id="woCustName" type="text" class="field w-full" required value="' + esc((order && order.customer_name) || '') + '" placeholder="مثال: شركة النور أو أحمد محمود" />')}
          ${field('رقم هاتف العميل', '<input id="woCustPhone" type="tel" dir="ltr" class="field w-full" value="' + esc((order && order.customer_phone) || '') + '" placeholder="010xxxxxxxx" />')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2">
            ${field('عنوان أو بيان العمل *', '<input id="woTitle" type="text" class="field w-full" required value="' + esc((order && order.title) || '') + '" placeholder="مثال: يافطة بنر 3×1 متر أو طباعة 500 كرت شخصي" />')}
          </div>
          <div>
            ${field('الفرع المسؤول', '<select id="woBranch" class="field w-full">' + branchesList.map((b) => `<option value="${esc(b.name)}" ${order && order.branch_name === b.name ? 'selected' : ''}>${esc(b.name)}</option>`).join('') + '</select>')}
          </div>
        </div>

        <div class="p-3 bg-[var(--color-bg)] rounded-lg space-y-3 border border-[var(--color-border)]">
          <div class="flex items-center justify-between">
            <span class="font-bold text-[var(--color-text)]"><i class="bi bi-rulers me-1"></i>حاسبة المقاسات والأمتار المربعة</span>
            <span id="woAreaBadge" class="badge badge-info text-xs font-mono font-bold">0.00 م²</span>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            ${field('الطول (متر)', '<input id="woWidth" type="number" step="0.01" min="0" class="field w-full font-mono" value="' + (order ? order.width : '') + '" placeholder="مثال: 2.5" />')}
            ${field('الارتفاع (متر)', '<input id="woHeight" type="number" step="0.01" min="0" class="field w-full font-mono" value="' + (order ? order.height : '') + '" placeholder="مثال: 1.2" />')}
            ${field('الكمية (قطع)', '<input id="woQty" type="number" step="1" min="1" class="field w-full font-mono" value="' + (order ? order.quantity : '1') + '" />')}
            ${field('نوع الخامة', '<input id="woMaterial" type="text" class="field w-full" value="' + esc((order && order.material) || '') + '" placeholder="بنر، فليكس، فينيل، كوشيه..." />')}
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${field('سعر بيع المتر / القطعة', '<input id="woUnitPrice" type="number" step="0.01" class="field w-full font-mono" value="' + (order ? order.unit_price : '') + '" placeholder="0" />')}
          ${field('إجمالي السعر *', '<input id="woTotalPrice" type="number" step="0.01" required class="field w-full font-mono font-bold" value="' + (order ? order.total_price : '') + '" placeholder="0" />')}
          ${field('العربون المدفوع', '<input id="woDeposit" type="number" step="0.01" class="field w-full font-mono text-emerald-600" value="' + (order ? order.deposit : '0') + '" />')}
          ${field('المبلغ المتبقي', '<input id="woRemaining" type="number" step="0.01" readonly class="field w-full font-mono font-bold text-rose-500 bg-[var(--color-bg)]" value="' + (order ? order.remaining : '0') + '" />')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            ${field('درجة الأهمية', '<select id="woPriority" class="field w-full"><option value="normal" ' + (order && order.priority === 'normal' ? 'selected' : '') + '>عادي</option><option value="high" ' + (order && order.priority === 'high' ? 'selected' : '') + '>عالي</option><option value="urgent" ' + (order && order.priority === 'urgent' ? 'selected' : '') + '>مستعجل طوارئ</option></select>')}
          </div>
          <div class="md:col-span-2">
            ${field('موعد التسليم المتوقع', '<input id="woDeliveryDate" type="datetime-local" class="field w-full" value="' + esc((order && order.delivery_date ? order.delivery_date.replace(' ', 'T') : '')) + '" />')}
          </div>
        </div>

        <div>
          ${field('إرفاق ملف أو صورة التصميم', '<div class="flex items-center gap-2"><input id="woDesignInput" type="file" accept="image/*,.pdf" class="field w-full text-xs" /><input id="woDesignFile" type="hidden" value="' + esc((order && order.design_file) || '') + '" /><div id="woDesignPreview" class="min-w-[40px] text-center">' + (order && order.design_file ? '<a href="' + esc(order.design_file) + '" target="_blank" class="text-xs text-[var(--color-primary)] font-bold">عرض</a>' : '') + '</div></div>')}
        </div>

        <div>
          ${field('ملاحظات إضافية للفني أو الورشة', '<textarea id="woNotes" rows="2" class="field w-full" placeholder="ملاحظات تفريغ، تركيب سلوفان، حلقات معدنية...">' + esc((order && order.notes) || '') + '</textarea>')}
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
          <button type="button" class="btn btn-ghost" data-close>إلغاء</button>
          <button type="submit" class="btn btn-primary">حفظ وتأكيد</button>
        </div>
      </form>
    `
  });

  const form = m.panel.querySelector('#woForm');
  const wEl = form.querySelector('#woWidth');
  const hEl = form.querySelector('#woHeight');
  const qEl = form.querySelector('#woQty');
  const upEl = form.querySelector('#woUnitPrice');
  const tpEl = form.querySelector('#woTotalPrice');
  const depEl = form.querySelector('#woDeposit');
  const remEl = form.querySelector('#woRemaining');
  const areaBadge = form.querySelector('#woAreaBadge');
  const fileInput = form.querySelector('#woDesignInput');
  const hiddenDesign = form.querySelector('#woDesignFile');
  const previewDiv = form.querySelector('#woDesignPreview');

  function recalc() {
    const w = Number(wEl.value) || 0;
    const h = Number(hEl.value) || 0;
    const q = Number(qEl.value) || 1;
    const area = w * h * q;
    areaBadge.textContent = `${area.toFixed(2)} م²`;

    const up = Number(upEl.value) || 0;
    if (up > 0 && area > 0 && (!tpEl.value || tpEl.dataset.autoCalc === '1')) {
      tpEl.value = (area * up).toFixed(2);
      tpEl.dataset.autoCalc = '1';
    }

    const tp = Number(tpEl.value) || 0;
    const dep = Number(depEl.value) || 0;
    remEl.value = Math.max(0, tp - dep).toFixed(2);
  }

  tpEl.addEventListener('input', () => {
    tpEl.dataset.autoCalc = '0';
    recalc();
  });
  wEl.addEventListener('input', recalc);
  hEl.addEventListener('input', recalc);
  qEl.addEventListener('input', recalc);
  upEl.addEventListener('input', recalc);
  depEl.addEventListener('input', recalc);
  recalc();

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast('حجم الملف كبير جداً (الحد الأقصى 15 ميجابايت)', 'warn');
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      hiddenDesign.value = e.target.result;
      if (file.type.startsWith('image/')) {
        previewDiv.innerHTML = `<img src="${e.target.result}" class="w-10 h-10 object-cover rounded border" />`;
      } else {
        previewDiv.innerHTML = `<span class="badge badge-info text-[10px]">${esc(file.name)}</span>`;
      }
    };
    reader.readAsDataURL(file);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      customer_name: form.querySelector('#woCustName').value.trim(),
      customer_phone: form.querySelector('#woCustPhone').value.trim() || null,
      title: form.querySelector('#woTitle').value.trim(),
      branch_name: form.querySelector('#woBranch').value,
      width: Number(wEl.value) || 0,
      height: Number(hEl.value) || 0,
      quantity: Number(qEl.value) || 1,
      material: form.querySelector('#woMaterial').value.trim() || null,
      unit_price: Number(upEl.value) || 0,
      total_price: Number(tpEl.value) || 0,
      deposit: Number(depEl.value) || 0,
      priority: form.querySelector('#woPriority').value,
      delivery_date: form.querySelector('#woDeliveryDate').value ? form.querySelector('#woDeliveryDate').value.replace('T', ' ') : null,
      design_file: hiddenDesign.value || null,
      notes: form.querySelector('#woNotes').value.trim() || null,
    };

    try {
      if (isEdit) {
        await api('PUT', `/api/work-orders/${order.id}`, payload);
        toast('تم تعديل أمر الشغل بنجاح', 'ok');
      } else {
        await api('POST', '/api/work-orders', payload);
        toast('تم تسجيل أمر الشغل بنجاح', 'ok');
      }
      m.close();
      if (onSaved) onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openTransferModal(order, onDone) {
  const targetBranches = branchesList.filter((b) => b.name !== order.branch_name);
  if (!targetBranches.length) {
    toast('لا يوجد فرع آخر للتحويل إليه حالياً', 'warn');
    return;
  }

  const m = modal({
    title: `تحويل أمر الشغل: ${order.order_no}`,
    content: `
      <form id="woTransferForm" class="space-y-3 text-xs">
        <p class="text-[var(--color-text-mute)]">الطلب تابع حالياً لـ: <strong class="text-[var(--color-text)]">${esc(order.branch_name)}</strong></p>
        ${field('تحويل إلى الفرع *', '<select id="woTargetBranch" class="field w-full">' + targetBranches.map((b) => `<option value="${esc(b.name)}">${esc(b.name)} (${esc(b.code)})</option>`).join('') + '</select>')}
        ${field('سبب التحويل', '<textarea id="woTransferReason" rows="2" class="field w-full" placeholder="مثال: ضغط عمل بالماكينات، توفر الخامات في الفرع الآخر..."></textarea>')}
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
          <button type="button" class="btn btn-ghost" data-close>إلغاء</button>
          <button type="submit" class="btn btn-primary">تأكيد النقل</button>
        </div>
      </form>
    `
  });

  m.panel.querySelector('#woTransferForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = m.panel.querySelector('#woTargetBranch').value;
    const reason = m.panel.querySelector('#woTransferReason').value.trim();
    try {
      await api('POST', `/api/work-orders/${order.id}/transfer`, { target_branch: target, reason });
      toast(`تم تحويل الطلب إلى ${target} بنجاح`, 'ok');
      m.close();
      if (onDone) onDone();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openWhatsAppModal(order) {
  const phone = String(order.customer_phone || '').replace(/[^0-9]/g, '');
  const cleanPhone = phone.startsWith('0') ? '2' + phone : phone;
  const msg = `مرحباً أستاذ ${order.customer_name}، نود إعلامكم بأن طلبكم رقم (${order.order_no}) "${order.title}" أصبح جاهزاً للاستلام الآن بفرعنا (${order.branch_name}).\nالمبلغ المتبقي: ${money(order.remaining)}.\nأهلاً وسهلاً بكم دائماً!`;
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;

  modal({
    title: 'إرسال إشعار جاهزية الطلب عبر واتساب',
    content: `
      <div class="space-y-3 text-xs">
        <p class="text-[var(--color-text-mute)]">رقم العميل: <strong class="text-[var(--color-text)]" dir="ltr">${esc(order.customer_phone || 'غير مسجل')}</strong></p>
        <div class="p-3 bg-[var(--color-bg)] rounded-lg font-mono text-[11px] whitespace-pre-wrap border border-[var(--color-border)]">${esc(msg)}</div>
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
          <button type="button" class="btn btn-ghost" data-close>إلغاء</button>
          <a href="${url}" target="_blank" class="btn btn-success flex items-center gap-1.5">
            <i class="bi bi-whatsapp"></i> فتح واتساب وإرسال
          </a>
        </div>
      </div>
    `
  });
}
