import { api, state, money, num, esc, toast, modal, confirmBox, field, openPrint, formToObject, debounce, downloadFile } from '../core.js';

export async function renderAccounting(c) {
  const tabs = [
    { key: 'treasury', label: 'الخزنة', icon: 'bi-wallet2' },
    { key: 'expenses', label: 'المصروفات', icon: 'bi-receipt-cutoff' },
    { key: 'accounts', label: 'شجرة الحسابات', icon: 'bi-diagram-3' },
    { key: 'installments', label: 'الأقساط', icon: 'bi-calendar-check' },
    { key: 'partners', label: 'الشركاء', icon: 'bi-person-badge' },
    { key: 'income', label: 'قائمة الدخل', icon: 'bi-graph-up-arrow' },
    { key: 'trial', label: 'ميزان المراجعة', icon: 'bi-clipboard-data' },
  ];
  const exportMap = { treasury: 'treasury', expenses: 'expenses', accounts: 'accounts' };
  let activeTab = 'treasury';
  c.innerHTML = `
    <div class="flex gap-2 mb-1 flex-wrap items-center">
      ${tabs.map((t, i) => `<button data-tab="${t.key}" class="btn ${i === 0 ? 'btn-primary' : 'btn-ghost'}"><i class="bi ${t.icon}"></i> ${t.label}</button>`).join('')}
      <button id="accExport" class="btn btn-ghost mr-auto"><i class="bi bi-filetype-csv"></i> تصدير CSV</button>
    </div>
    <div id="accPane"></div>`;
  c.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    c.querySelectorAll('[data-tab]').forEach((x) => { x.className = 'btn btn-ghost'; });
    b.className = 'btn btn-primary';
    activeTab = b.dataset.tab;
    open(activeTab);
  }));
  c.querySelector('#accExport').addEventListener('click', async () => {
    const entity = exportMap[activeTab];
    if (!entity) { toast('التصدير متاح للخزنة والمصروفات والحسابات فقط', 'error'); return; }
    try {
      await downloadFile(`/api/export/${entity}`, `${entity}.csv`);
      toast('تم تصدير الملف', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  const pane = () => c.querySelector('#accPane');
  const open = (key) => ({ treasury: treasury, expenses: expenses, accounts: accounts, installments: installments, partners: partners, income: income, trial: trial }[key](pane()));
  treasury(pane());

  async function treasury(p) {
    const data = await api('GET', '/api/treasury?page_size=100');
    p.innerHTML = `
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-wallet2"></i></div><div><div class="kpi-value">${money(data.balance)}</div><div class="kpi-label">الرصيد الحالي</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-arrow-down-circle"></i></div><div><div class="kpi-value">${money(data.total_in)}</div><div class="kpi-label">إجمالي الوارد</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-arrow-up-circle"></i></div><div><div class="kpi-value">${money(data.total_out)}</div><div class="kpi-label">إجمالي الصادر</div></div></div>
      </div>
      <div class="card">
        <div class="p-4 flex justify-between items-center border-b border-slate-100">
          <div class="font-black">حركات الخزنة</div>
          <button id="trAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> حركة يدوية</button>
        </div>
        <div class="overflow-auto max-h-[55vh]"><table class="w-full">
          <thead><tr><th class="th">التاريخ</th><th class="th">النوع</th><th class="th">المصدر</th><th class="th">البيان</th><th class="th">المبلغ</th><th class="th">الرصيد</th></tr></thead>
          <tbody>${data.rows.map((r) => `<tr class="tr"><td class="td text-xs">${esc(r.created_at)}</td><td class="td">${r.direction === 'in' ? '<span class="badge badge-ok">وارد</span>' : '<span class="badge badge-danger">صادر</span>'}</td><td class="td text-xs">${esc(r.source)}</td><td class="td">${esc(r.description || '-')}</td><td class="td font-bold ${r.direction === 'in' ? 'text-emerald-600' : 'text-rose-600'}">${money(r.amount, '')}</td><td class="td">${money(r.balance_after, '')}</td></tr>`).join('') || '<tr><td colspan="6" class="td text-center text-slate-400 py-8">لا توجد حركات</td></tr>'}</tbody>
        </table></div>
      </div>`;
    p.querySelector('#trAdd').addEventListener('click', () => {
      modal({
        title: 'حركة خزنة يدوية',
        size: 'max-w-sm',
        body: `<div class="grid grid-cols-2 gap-2 mb-3"><button data-d="in" class="btn btn-success">وارد</button><button data-d="out" class="btn btn-ghost">صادر</button></div>
          ${field('المبلغ', '<input id="trAmount" type="number" class="field" />')}
          ${field('البيان', '<input id="trDesc" class="field" />')}`,
        footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="trSave" class="btn btn-primary">حفظ</button>`,
        onMount(wrap, close) {
          let dir = 'in';
          wrap.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
            dir = b.dataset.d;
            wrap.querySelectorAll('[data-d]').forEach((x) => { x.className = 'btn btn-ghost'; });
            b.className = `btn ${dir === 'in' ? 'btn-success' : 'btn-danger'}`;
          }));
          wrap.querySelector('[data-cancel]').addEventListener('click', close);
          wrap.querySelector('#trSave').addEventListener('click', async () => {
            try {
              await api('POST', '/api/treasury', { direction: dir, amount: Number(wrap.querySelector('#trAmount').value), description: wrap.querySelector('#trDesc').value });
              toast('تم', 'success'); close(); treasury(p);
            } catch (e) { toast(e.message, 'error'); }
          });
        },
      });
    });
  }

  async function expenses(p) {
    const data = await api('GET', '/api/expenses?page_size=100');
    p.innerHTML = `
      <div class="grid grid-cols-4 gap-4 mb-4">
        <div class="kpi col-span-1"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-receipt-cutoff"></i></div><div><div class="kpi-value">${money(data.sum_amount)}</div><div class="kpi-label">إجمالي المصروفات</div></div></div>
        ${data.by_category.slice(0, 3).map((x) => `<div class="kpi"><div class="kpi-icon bg-slate-100 text-slate-600"><i class="bi bi-tag"></i></div><div><div class="kpi-value">${money(x.amount)}</div><div class="kpi-label">${esc(x.category)}</div></div></div>`).join('')}
      </div>
      <div class="card"><div class="p-4 flex justify-between items-center border-b border-slate-100"><div class="font-black">سجل المصروفات</div><button id="exAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> مصروف جديد</button></div>
      <div class="overflow-auto max-h-[55vh]"><table class="w-full"><thead><tr><th class="th">التاريخ</th><th class="th">التصنيف</th><th class="th">البيان</th><th class="th">الدفع</th><th class="th">المبلغ</th><th class="th"></th></tr></thead>
      <tbody>${data.rows.map((r) => `<tr class="tr"><td class="td text-xs">${esc(r.date)}</td><td class="td"><span class="badge badge-warn">${esc(r.category)}</span></td><td class="td">${esc(r.description || '-')}</td><td class="td text-xs">${esc(r.payment_method)}</td><td class="td font-bold text-rose-600">${money(r.amount)}</td><td class="td"><button data-del="${r.id}" class="text-rose-400 hover:text-rose-600"><i class="bi bi-trash3"></i></button></td></tr>`).join('') || '<tr><td colspan="6" class="td text-center text-slate-400 py-8">لا توجد مصروفات</td></tr>'}</tbody></table></div></div>`;
    p.querySelector('#exAdd').addEventListener('click', () => {
      modal({
        title: 'مصروف جديد',
        size: 'max-w-md',
        body: `${field('التصنيف', '<input id="exCat" class="field" placeholder="كهرباء، إيجار، رواتب..."/>')}
          ${field('البيان', '<input id="exDesc" class="field" />')}
          ${field('المبلغ', '<input id="exAmt" type="number" class="field" />')}
          ${field('طريقة الدفع', '<select id="exMethod" class="field"><option value="cash">نقدي</option><option value="bank">بنكي</option></select>')}
          ${field('التاريخ', `<input id="exDate" type="date" value="${new Date().toLocaleDateString('en-CA')}" class="field" />`)}`,
        footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="exSave" class="btn btn-primary">حفظ</button>`,
        onMount(wrap, close) {
          wrap.querySelector('[data-cancel]').addEventListener('click', close);
          wrap.querySelector('#exSave').addEventListener('click', async () => {
            try {
              await api('POST', '/api/expenses', {
                category: wrap.querySelector('#exCat').value || 'عام',
                description: wrap.querySelector('#exDesc').value,
                amount: Number(wrap.querySelector('#exAmt').value),
                payment_method: wrap.querySelector('#exMethod').value,
                date: wrap.querySelector('#exDate').value,
              });
              toast('تم', 'success'); close(); expenses(p);
            } catch (e) { toast(e.message, 'error'); }
          });
        },
      });
    });
    p.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('حذف المصروف وعكس أثره بالخزنة؟'))) return;
      await api('DELETE', `/api/expenses/${b.dataset.del}`);
      toast('تم', 'success'); expenses(p);
    }));
  }

  async function accounts(p) {
    const data = await api('GET', '/api/accounts');
    const render = (nodes, depth = 0) => nodes.map((a) => `
      <tr class="tr">
        <td class="td"><span style="padding-right:${depth * 18}px" class="font-bold ${depth === 0 ? 'text-zain-700' : ''}">${esc(a.code)} — ${esc(a.name)}</span></td>
        <td class="td"><span class="badge badge-mute">${esc(a.type)}</span></td>
        <td class="td font-bold ${a.computed_balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${money(a.computed_balance, '')}</td>
        <td class="td">${a.is_system ? '<span class="badge badge-info">نظامي</span>' : `<button data-adel="${a.id}" class="text-rose-400 hover:text-rose-600"><i class="bi bi-trash3"></i></button>`}</td>
      </tr>${a.children ? render(a.children, depth + 1) : ''}`).join('');
    p.innerHTML = `
      <div class="card">
        <div class="p-4 flex justify-between items-center border-b border-slate-100"><div class="font-black">شجرة الحسابات</div><button id="acAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> حساب جديد</button></div>
        <div class="overflow-auto max-h-[62vh]"><table class="w-full"><thead><tr><th class="th">الحساب</th><th class="th">النوع</th><th class="th">الرصيد</th><th class="th"></th></tr></thead><tbody>${render(data.tree)}</tbody></table></div>
      </div>`;
    p.querySelector('#acAdd').addEventListener('click', () => {
      modal({
        title: 'حساب جديد',
        size: 'max-w-md',
        body: `${field('الرمز', '<input id="acCode" class="field font-mono" />')}
          ${field('الاسم', '<input id="acName" class="field" />')}
          ${field('النوع', '<select id="acType" class="field"><option value="asset">أصول</option><option value="liability">التزامات</option><option value="equity">حقوق ملكية</option><option value="revenue">إيرادات</option><option value="expense">مصروفات</option></select>')}
          ${field('الحساب الأب', `<select id="acParent" class="field"><option value="">—</option>${data.accounts.map((a) => `<option value="${a.id}">${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select>`)}`,
        footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="acSave" class="btn btn-primary">حفظ</button>`,
        onMount(wrap, close) {
          wrap.querySelector('[data-cancel]').addEventListener('click', close);
          wrap.querySelector('#acSave').addEventListener('click', async () => {
            try {
              await api('POST', '/api/accounts', {
                code: wrap.querySelector('#acCode').value,
                name: wrap.querySelector('#acName').value,
                type: wrap.querySelector('#acType').value,
                parent_id: wrap.querySelector('#acParent').value || null,
              });
              toast('تم', 'success'); close(); accounts(p);
            } catch (e) { toast(e.message, 'error'); }
          });
        },
      });
    });
    p.querySelectorAll('[data-adel]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('حذف الحساب؟'))) return;
      try { await api('DELETE', `/api/accounts/${b.dataset.adel}`); toast('تم', 'success'); accounts(p); } catch (e) { toast(e.message, 'error'); }
    }));
  }

  async function installments(p) {
    const data = await api('GET', '/api/installments?page_size=100');
    p.innerHTML = `
      <div class="kpi mb-4"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-calendar-check"></i></div><div><div class="kpi-value">${money(data.remaining_total)}</div><div class="kpi-label">إجمالي المتبقي (${data.total} قسط)</div></div></div>
      <div class="card"><div class="overflow-auto max-h-[58vh]"><table class="w-full"><thead><tr><th class="th">العميل</th><th class="th">الإجمالي</th><th class="th">مدفوع</th><th class="th">متبقي</th><th class="th">الحالة</th><th class="th"></th></tr></thead>
      <tbody>${data.rows.map((r) => `<tr class="tr"><td class="td font-bold">${esc(r.customer_name || '-')}</td><td class="td">${money(r.total)}</td><td class="td text-emerald-600">${money(r.paid_amount)}</td><td class="td text-rose-600 font-bold">${money(r.remaining)}</td><td class="td"><span class="badge ${r.status === 'completed' ? 'badge-ok' : 'badge-warn'}">${r.status === 'completed' ? 'مكتمل' : 'نشط'}</span></td>
      <td class="td">${r.status !== 'completed' ? `<button data-pay="${r.id}" class="btn btn-success btn-sm"><i class="bi bi-cash"></i> تحصيل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="td text-center text-slate-400 py-8">لا توجد أقساط</td></tr>'}</tbody></table></div></div>`;
    p.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => {
      const inst = data.rows.find((x) => x.id === +b.dataset.pay);
      modal({
        title: 'تحصيل قسط',
        size: 'max-w-sm',
        body: `<div class="mb-3 text-sm text-slate-500">المتبقي: <b>${money(inst.remaining)}</b></div>${field('المبلغ', `<input id="inAmt" type="number" value="${inst.remaining}" class="field" />`)}`,
        footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="inSave" class="btn btn-success">تحصيل</button>`,
        onMount(wrap, close) {
          wrap.querySelector('[data-cancel]').addEventListener('click', close);
          wrap.querySelector('#inSave').addEventListener('click', async () => {
            try { await api('POST', `/api/installments/${inst.id}/pay`, { amount: Number(wrap.querySelector('#inAmt').value) }); toast('تم التحصيل', 'success'); close(); installments(p); } catch (e) { toast(e.message, 'error'); }
          });
        },
      });
    }));
  }

  async function partners(p) {
    const data = await api('GET', '/api/partners');
    p.innerHTML = `
      <div class="kpi mb-4"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-person-badge"></i></div><div><div class="kpi-value">${money(data.total_capital)}</div><div class="kpi-label">إجمالي رأس المال</div></div></div>
      <div class="card"><div class="p-4 flex justify-between items-center border-b border-slate-100"><div class="font-black">الشركاء</div><button id="ptAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> شريك جديد</button></div>
      <div class="overflow-auto max-h-[58vh]"><table class="w-full"><thead><tr><th class="th">الاسم</th><th class="th">الهاتف</th><th class="th">الحصة %</th><th class="th">رأس المال</th><th class="th">الرصيد</th><th class="th"></th></tr></thead>
      <tbody>${data.rows.map((r) => `<tr class="tr"><td class="td font-bold">${esc(r.name)}</td><td class="td">${esc(r.phone || '-')}</td><td class="td">${r.share_percent}%</td><td class="td">${money(r.capital)}</td><td class="td">${money(r.balance)}</td><td class="td"><button data-del="${r.id}" class="text-rose-400 hover:text-rose-600"><i class="bi bi-trash3"></i></button></td></tr>`).join('') || '<tr><td colspan="6" class="td text-center text-slate-400 py-8">لا يوجد شركاء</td></tr>'}</tbody></table></div></div>`;
    p.querySelector('#ptAdd').addEventListener('click', () => {
      modal({
        title: 'شريك جديد',
        size: 'max-w-md',
        body: `${field('الاسم', '<input id="ptName" class="field" />')}${field('الهاتف', '<input id="ptPhone" class="field" />')}
        ${field('الحصة %', '<input id="ptShare" type="number" value="0" class="field" />')}${field('رأس المال', '<input id="ptCap" type="number" value="0" class="field" />')}`,
        footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="ptSave" class="btn btn-primary">حفظ</button>`,
        onMount(wrap, close) {
          wrap.querySelector('[data-cancel]').addEventListener('click', close);
          wrap.querySelector('#ptSave').addEventListener('click', async () => {
            try {
              await api('POST', '/api/partners', { name: wrap.querySelector('#ptName').value, phone: wrap.querySelector('#ptPhone').value, share_percent: Number(wrap.querySelector('#ptCap').value) ? 0 : Number(wrap.querySelector('#ptShare').value), capital: Number(wrap.querySelector('#ptCap').value) });
              toast('تم', 'success'); close(); partners(p);
            } catch (e) { toast(e.message, 'error'); }
          });
        },
      });
    });
    p.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('أرشفة الشريك؟'))) return;
      await api('DELETE', `/api/partners/${b.dataset.del}`); toast('تم', 'success'); partners(p);
    }));
  }

  async function income(p) {
    const from = p.querySelector('#incFrom') ? p.querySelector('#incFrom').value : '';
    const to = p.querySelector('#incTo') ? p.querySelector('#incTo').value : '';
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const data = await api('GET', '/api/reports/income-statement?' + q.toString());
    p.innerHTML = `
      <div class="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div><label class="label">من تاريخ</label><input id="incFrom" type="date" class="field !w-40" value="${esc(from)}" /></div>
        <div><label class="label">إلى تاريخ</label><input id="incTo" type="date" class="field !w-40" value="${esc(to)}" /></div>
        <button id="incApply" class="btn btn-primary"><i class="bi bi-funnel"></i> عرض</button>
        <button id="incPrint" class="btn btn-ghost"><i class="bi bi-printer"></i> طباعة</button>
      </div>
      <div class="grid grid-cols-4 gap-4 mb-4">
        <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-cash-stack"></i></div><div><div class="kpi-value">${money(data.revenue)}</div><div class="kpi-label">صافي المبيعات (${data.sales_count} فاتورة)</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-box-seam"></i></div><div><div class="kpi-value">${money(data.cogs)}</div><div class="kpi-label">تكلفة البضاعة المباعة</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-graph-up"></i></div><div><div class="kpi-value">${money(data.gross_profit)}</div><div class="kpi-label">مجمل الربح (${Number(data.gross_margin).toFixed(1)}%)</div></div></div>
        <div class="kpi"><div class="kpi-icon ${Number(data.net_profit) >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}"><i class="bi bi-trophy"></i></div><div><div class="kpi-value">${money(data.net_profit)}</div><div class="kpi-label">صافي الربح (${Number(data.net_margin).toFixed(1)}%)</div></div></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="card">
          <div class="p-4 border-b border-slate-100 font-black">تفصيل قائمة الدخل</div>
          <div class="p-4 space-y-2 text-sm">
            <div class="flex justify-between"><span>إجمالي المبيعات</span><b>${money(data.sales_total)}</b></div>
            <div class="flex justify-between text-rose-600"><span>مرتجعات البيع</span><b>-${money(data.returns_total)}</b></div>
            <div class="flex justify-between border-b border-dashed pb-2"><span class="font-bold">صافي الإيرادات</span><b class="text-zain-700">${money(data.revenue)}</b></div>
            <div class="flex justify-between text-rose-600"><span>تكلفة البضاعة المباعة</span><b>-${money(data.cogs)}</b></div>
            <div class="flex justify-between border-b border-dashed pb-2"><span class="font-bold">مجمل الربح</span><b class="text-emerald-600">${money(data.gross_profit)}</b></div>
            <div class="flex justify-between text-rose-600"><span>المصروفات التشغيلية</span><b>-${money(data.expenses_total)}</b></div>
            <div class="flex justify-between text-emerald-600"><span>إيرادات أخرى</span><b>+${money(data.other_income)}</b></div>
            <div class="flex justify-between border-b border-dashed pb-2"><span class="font-bold">صافي الربح</span><b class="${Number(data.net_profit) >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${money(data.net_profit)}</b></div>
            <div class="flex justify-between"><span class="text-slate-500">متوسط الفاتورة</span><b>${money(data.avg_ticket)}</b></div>
            <div class="flex justify-between"><span class="text-slate-500">فواتير الشراء</span><b>${money(data.purchases_total)}</b></div>
          </div>
        </div>
        <div class="card">
          <div class="p-4 border-b border-slate-100 font-black">المصروفات حسب البند</div>
          <div class="overflow-auto max-h-56">
            <table class="w-full">
              <thead><tr><th class="th">البند</th><th class="th">العدد</th><th class="th">المبلغ</th></tr></thead>
              <tbody>${data.expenses_by_category.map((x) => `<tr class="tr"><td class="td">${esc(x.category)}</td><td class="td">${x.count}</td><td class="td font-bold text-rose-600">${money(x.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="td text-center text-slate-400 py-6">لا توجد مصروفات</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card mt-4">
        <div class="p-4 border-b border-slate-100 font-black">أكثر الأصناف ربحية</div>
        <div class="overflow-auto max-h-64">
          <table class="w-full">
            <thead><tr><th class="th">الصنف</th><th class="th">الكمية</th><th class="th">المبيعات</th><th class="th">التكلفة</th><th class="th">الربح</th><th class="th">الهامش</th></tr></thead>
            <tbody>${data.top_products.map((x) => `<tr class="tr"><td class="td font-bold">${esc(x.name)}</td><td class="td">${num(x.qty)}</td><td class="td">${money(x.revenue)}</td><td class="td">${money(x.cost)}</td><td class="td font-bold text-emerald-600">${money(x.profit)}</td><td class="td">${Number(x.margin_pct).toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="6" class="td text-center text-slate-400 py-6">لا توجد مبيعات</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
    p.querySelector('#incApply').addEventListener('click', () => income(p));
    p.querySelector('#incPrint').addEventListener('click', () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      openPrint('/api/print/income-statement?' + params.toString());
    });
  }

  async function trial(p) {
    const data = await api('GET', '/api/reports/trial-balance');
    p.innerHTML = `
      <div class="card"><div class="p-4 border-b border-slate-100 font-black">ميزان المراجعة</div>
      <div class="overflow-auto max-h-[62vh]"><table class="w-full"><thead><tr><th class="th">الرمز</th><th class="th">الحساب</th><th class="th">النوع</th><th class="th">مدين</th><th class="th">دائن</th></tr></thead>
      <tbody>${data.rows.map((r) => `<tr class="tr"><td class="td font-mono text-xs">${esc(r.code)}</td><td class="td font-bold">${esc(r.name)}</td><td class="td"><span class="badge badge-mute">${esc(r.type)}</span></td><td class="td">${money(r.debit, '')}</td><td class="td">${money(r.credit, '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="font-black bg-slate-50"><td class="td" colspan="3">الإجمالي</td><td class="td text-emerald-700">${money(data.totals.debit, '')}</td><td class="td text-rose-700">${money(data.totals.credit, '')}</td></tr></tfoot></table></div></div>`;
  }
}

export async function renderShifts(c) {
  const data = await api('GET', '/api/shifts?page_size=100');
  c.innerHTML = `
    <div class="card">
      <div class="p-4 flex justify-between items-center border-b border-slate-100">
        <div class="font-black">سجل الورديات</div>
        <div class="flex items-center gap-3">
          <div class="text-sm">${state.shift ? `<span class="badge badge-ok">وردية مفتوحة الآن</span>` : `<span class="badge badge-mute">لا توجد وردية مفتوحة</span>`}</div>
          <button id="shExport" class="btn btn-ghost"><i class="bi bi-filetype-csv"></i> تصدير CSV</button>
        </div>
      </div>
      <div class="overflow-auto max-h-[70vh]"><table class="w-full">
        <thead><tr><th class="th">#</th><th class="th">الموظف</th><th class="th">الفتح</th><th class="th">الإغلاق</th><th class="th">رصيد الفتح</th><th class="th">المبيعات</th><th class="th">النقدي</th><th class="th">الآجل</th><th class="th">المتوقع</th><th class="th">الإقفال</th><th class="th">الحالة</th></tr></thead>
        <tbody>${data.rows.map((r) => `<tr class="tr">
          <td class="td">${r.id}</td><td class="td font-bold">${esc(r.user_name || '-')}</td>
          <td class="td text-xs">${esc(r.opened_at)}</td><td class="td text-xs">${esc(r.closed_at || '-')}</td>
          <td class="td">${money(r.opening_balance, '')}</td>
          <td class="td font-bold">${money(r.total_sales, '')}</td>
          <td class="td text-emerald-600">${money(r.total_cash, '')}</td>
          <td class="td text-amber-600">${money(r.total_credit, '')}</td>
          <td class="td">${r.expected_cash != null ? money(r.expected_cash, '') : (r.live_sales_total != null && r.opening_balance != null ? money(r.opening_balance, '') : '—')}</td>
          <td class="td">${r.closing_balance != null ? money(r.closing_balance, '') : '—'}</td>
          <td class="td"><span class="badge ${r.status === 'open' ? 'badge-ok' : 'badge-mute'}">${r.status === 'open' ? 'مفتوحة' : 'مغلقة'}</span></td>
        </tr>`).join('') || '<tr><td colspan="11" class="td text-center text-slate-400 py-8">لا توجد ورديات</td></tr>'}</tbody>
      </table></div>
    </div>`;
  c.querySelector('#shExport').addEventListener('click', async () => {
    try {
      await downloadFile('/api/export/shifts', 'الورديات.csv');
      toast('تم تصدير الملف', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
}
