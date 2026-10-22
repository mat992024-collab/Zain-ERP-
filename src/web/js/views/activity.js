import { api, esc, num, toast, emptyState, debounce, downloadFile } from '../core.js';

const ACTION_LABELS = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  sale: 'بيع',
  purchase: 'شراء',
  sale_return: 'مرتجع بيع',
  purchase_return: 'مرتجع شراء',
  credit_limit_override: 'تجاوز حد ائتمان',
  installment_pay: 'سداد قسط',
  voucher_create: 'إنشاء سند',
  voucher_cancel: 'إلغاء سند',
  transfer: 'تحويل بين الحسابات',
  expense: 'مصروف',
  backup_create: 'نسخة احتياطية',
  backup_restore: 'استعادة نسخة',
  reminder_create: 'إنشاء تذكير',
  reminder_update: 'تعديل تذكير',
  reminder_delete: 'حذف تذكير',
  login: 'دخول',
  logout: 'خروج',
};

const ACTION_STYLES = {
  create: 'badge-ok',
  update: 'badge-info',
  delete: 'badge-danger',
  sale: 'badge-ok',
  purchase: 'badge-info',
  sale_return: 'badge-warn',
  purchase_return: 'badge-warn',
  credit_limit_override: 'badge-danger',
  backup_restore: 'badge-warn',
};

const ENTITY_LABELS = {
  invoices: 'فواتير',
  products: 'أصناف',
  customers: 'عملاء',
  suppliers: 'موردون',
  accounts: 'حسابات',
  vouchers: 'سندات',
  users: 'مستخدمون',
  settings: 'إعدادات',
  reminders: 'تذكيرات',
  expenses: 'مصروفات',
  installments: 'أقساط',
  shifts: 'ورديات',
  currencies: 'عملات',
};

export async function renderActivity(c) {
  let page = 1;
  let search = '';
  let action = '';
  let userId = '';
  let from = '';
  let to = '';

  const load = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (action) params.set('action', action);
    if (userId) params.set('user_id', userId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('page', String(page));
    params.set('page_size', '50');
    return api('GET', `/api/activity?${params.toString()}`);
  };

  c.innerHTML = `
    <div class="card">
      <div class="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
        <div class="relative flex-1 min-w-64">
          <i class="bi bi-search absolute top-1/2 -translate-y-1/2 right-3.5 text-slate-400"></i>
          <input id="acSearch" class="field !pr-10" placeholder="بحث في السجل (إجراء، كيان، مستخدم)" />
        </div>
        <select id="acAction" class="field w-48"><option value="">كل الإجراءات</option></select>
        <select id="acUser" class="field w-48"><option value="">كل المستخدمين</option></select>
        <input id="acFrom" type="date" class="field w-40" title="من تاريخ" />
        <input id="acTo" type="date" class="field w-40" title="إلى تاريخ" />
        <button id="acExport" class="btn btn-ghost"><i class="bi bi-download"></i> تصدير</button>
      </div>
      <div id="acSummary" class="px-4 py-2 flex flex-wrap gap-2 border-b border-slate-100"></div>
      <div class="overflow-auto"><table class="w-full">
        <thead><tr>
          <th class="th">التاريخ</th><th class="th">المستخدم</th><th class="th">الإجراء</th>
          <th class="th">الكيان</th><th class="th">التفاصيل</th>
        </tr></thead>
        <tbody id="acRows"></tbody>
      </table></div>
      <div class="p-3 flex items-center justify-between border-t border-slate-100">
        <span id="acCount" class="text-xs text-slate-500"></span>
        <div class="flex gap-2">
          <button id="acPrev" class="btn btn-ghost btn-sm"><i class="bi bi-chevron-right"></i> السابق</button>
          <button id="acNext" class="btn btn-ghost btn-sm">التالي <i class="bi bi-chevron-left"></i></button>
        </div>
      </div>
    </div>`;

  const rowsBox = c.querySelector('#acRows');
  const summaryBox = c.querySelector('#acSummary');

  const render = async () => {
    const data = await load();
    const actionSel = c.querySelector('#acAction');
    if (!actionSel.options || actionSel.options.length <= 1) {
      for (const a of data.by_action) {
        const opt = document.createElement('option');
        opt.value = a.action;
        opt.textContent = `${ACTION_LABELS[a.action] || a.action} (${a.count})`;
        actionSel.appendChild(opt);
      }
    }
    const userSel = c.querySelector('#acUser');
    if (!userSel.options || userSel.options.length <= 1) {
      for (const u of data.users) {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.full_name || u.username;
        userSel.appendChild(opt);
      }
    }
    rowsBox.innerHTML = data.rows.length ? data.rows.map((r) => `
      <tr class="tr">
        <td class="td text-xs whitespace-nowrap">${esc(r.created_at || '')}</td>
        <td class="td font-bold">${esc(r.full_name || r.username || 'النظام')}</td>
        <td class="td"><span class="badge ${ACTION_STYLES[r.action] || 'badge-mute'}">${esc(ACTION_LABELS[r.action] || r.action)}</span></td>
        <td class="td text-xs">${esc(ENTITY_LABELS[r.entity] || r.entity || '-')}${r.entity_id ? ` #${r.entity_id}` : ''}</td>
        <td class="td text-xs text-slate-500">${esc(r.details || '')}</td>
      </tr>`).join('') : `<tr><td colspan="5">${emptyState('bi-clock-history', 'لا توجد عمليات مسجلة', 'جرّب تغيير عوامل التصفية')}</td></tr>`;
    summaryBox.innerHTML = data.by_action.slice(0, 10).map((a) => `
      <button class="badge ${action === a.action ? 'badge-info' : 'badge-mute'}" data-act="${esc(a.action)}">${esc(ACTION_LABELS[a.action] || a.action)} ${num(a.count)}</button>`).join('');
    summaryBox.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      action = action === b.dataset.act ? '' : b.dataset.act;
      c.querySelector('#acAction').value = action;
      page = 1;
      render();
    }));
    c.querySelector('#acCount').textContent = `إجمالي ${num(data.total)} عملية — صفحة ${data.page} من ${data.pages}`;
    c.querySelector('#acPrev').disabled = data.page <= 1;
    c.querySelector('#acNext').disabled = data.page >= data.pages;
  };

  c.querySelector('#acSearch').addEventListener('input', debounce((e) => {
    search = e.target.value.trim();
    page = 1;
    render();
  }, 300));
  c.querySelector('#acAction').addEventListener('change', (e) => { action = e.target.value; page = 1; render(); });
  c.querySelector('#acUser').addEventListener('change', (e) => { userId = e.target.value; page = 1; render(); });
  c.querySelector('#acFrom').addEventListener('change', (e) => { from = e.target.value; page = 1; render(); });
  c.querySelector('#acTo').addEventListener('change', (e) => { to = e.target.value; page = 1; render(); });
  c.querySelector('#acPrev').addEventListener('click', () => { if (page > 1) { page -= 1; render(); } });
  c.querySelector('#acNext').addEventListener('click', () => { page += 1; render(); });
  c.querySelector('#acExport').addEventListener('click', async () => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    try {
      await downloadFile(`/api/export/activity?${params.toString()}`, 'activity.csv');
      toast('تم تصدير السجل', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await render();
}
