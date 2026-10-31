import { api, state, money, num, esc, toast, modal, confirmBox, field, openPrint, formToObject, debounce, downloadFile } from '../core.js';

const SOURCE_LABELS = {
  sale: 'مبيعات', sale_cash: 'مبيعات نقدية', sale_card: 'مبيعات بطاقة', sale_wallet: 'مبيعات محفظة', sale_vodafone: 'فودافون كاش',
  purchase: 'مشتريات', return_sale: 'مرتجع مبيعات', return_sale_cash: 'مرتجع نقدي', return_sale_card: 'مرتجع بطاقة', return_sale_wallet: 'مرتجع محفظة', return_vodafone: 'مرتجع فودافون كاش',
  return_purchase: 'مرتجع مشتريات', expense: 'مصروف', receipt: 'سند قبض', payout: 'سند صرف',
  manual: 'حركة يدوية', deposit: 'إيداع', withdraw: 'سحب',
};
const sourceLabel = (s) => SOURCE_LABELS[s] || s;

export async function renderAccounting(c) {
  const tabs = [
    { key: 'treasury', label: 'الخزنة', icon: 'bi-wallet2' },
    { key: 'vouchers', label: 'السندات', icon: 'bi-file-earmark-text' },
    { key: 'expenses', label: 'المصروفات', icon: 'bi-receipt-cutoff' },
    { key: 'accounts', label: 'شجرة الحسابات', icon: 'bi-diagram-3' },
    { key: 'installments', label: 'الأقساط', icon: 'bi-calendar-check' },
    { key: 'scheduled', label: 'الجدولة', icon: 'bi-calendar2-week' },
    { key: 'partners', label: 'الشركاء', icon: 'bi-person-badge' },
    { key: 'income', label: 'قائمة الدخل', icon: 'bi-graph-up-arrow' },
    { key: 'zreport', label: 'تقرير Z', icon: 'bi-clipboard2-check' },
    { key: 'zakat', label: 'الزكاة', icon: 'bi-moon-stars' },
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
  const open = (key) => ({ treasury: treasury, vouchers: vouchers, expenses: expenses, accounts: accounts, installments: installments, scheduled: scheduled, partners: partners, income: income, zreport: zreport, zakat: zakat, trial: trial }[key](pane()));
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
          <tbody>${data.rows.map((r) => `<tr class="tr"><td class="td text-xs">${esc(r.created_at)}</td><td class="td">${r.direction === 'in' ? '<span class="badge badge-ok">وارد</span>' : '<span class="badge badge-danger">صادر</span>'}</td><td class="td text-xs">${esc(sourceLabel(r.source))}</td><td class="td">${esc(r.description || '-')}</td><td class="td font-bold ${r.direction === 'in' ? 'text-emerald-600' : 'text-rose-600'}">${money(r.amount, '')}</td><td class="td">${money(r.balance_after, '')}</td></tr>`).join('') || '<tr><td colspan="6" class="td text-center text-slate-400 py-8">لا توجد حركات</td></tr>'}</tbody>
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

  async function vouchers(p) {
    const data = await api('GET', '/api/vouchers?page_size=100');
    const badge = { receipt: 'badge-ok', payout: 'badge-danger', transfer: 'badge-info' };
    const label = { receipt: 'سند قبض', payout: 'سند صرف', transfer: 'سند نقل' };
    const sum = (t) => data.rows.filter((r) => r.type === t).reduce((s, r) => s + Number(r.amount), 0);
    p.innerHTML = `
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-box-arrow-in-down"></i></div><div><div class="kpi-value">${money(sum('receipt'))}</div><div class="kpi-label">سندات القبض</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-box-arrow-up"></i></div><div><div class="kpi-value">${money(sum('payout'))}</div><div class="kpi-label">سندات الصرف</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-arrow-left-right"></i></div><div><div class="kpi-value">${money(sum('transfer'))}</div><div class="kpi-label">سندات النقل</div></div></div>
      </div>
      <div class="card">
        <div class="p-4 flex justify-between items-center border-b border-slate-100">
          <div class="font-black">سندات القبض والصرف والنقل</div>
          <button id="vcAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> سند جديد</button>
        </div>
        <div class="overflow-auto max-h-[55vh]"><table class="w-full">
          <thead><tr><th class="th">رقم السند</th><th class="th">النوع</th><th class="th">التاريخ</th><th class="th">الطرف / الحساب</th><th class="th">البيان</th><th class="th">المبلغ</th><th class="th"></th></tr></thead>
          <tbody>${data.rows.map((r) => `<tr class="tr">
            <td class="td font-mono text-xs font-bold">${esc(r.voucher_no)}</td>
            <td class="td"><span class="badge ${badge[r.type]}">${esc(label[r.type] || r.type)}</span></td>
            <td class="td text-xs">${esc(r.date || r.created_at)}</td>
            <td class="td">${esc(r.partner_name || (r.from_account ? `${esc(r.from_account)} → ${esc(r.to_account)}` : '-'))}</td>
            <td class="td text-xs">${esc(r.description || '-')}</td>
            <td class="td font-bold ${r.type === 'receipt' ? 'text-emerald-600' : r.type === 'payout' ? 'text-rose-600' : 'text-zain-700'}">${money(r.amount, '')}</td>
            <td class="td">
              <div class="flex items-center gap-2">
                <button data-vprint="${r.id}" class="text-zain-600 hover:text-zain-800" title="طباعة"><i class="bi bi-printer"></i></button>
                <button data-vrep="${r.id}" class="text-indigo-500 hover:text-indigo-700" title="تكرار السند"><i class="bi bi-arrow-repeat"></i></button>
                <button data-vdel="${r.id}" class="text-rose-400 hover:text-rose-600" title="إلغاء السند"><i class="bi bi-trash3"></i></button>
              </div>
            </td></tr>`).join('') || '<tr><td colspan="7" class="td text-center text-slate-400 py-8">لا توجد سندات</td></tr>'}</tbody>
        </table></div>
      </div>`;
    p.querySelector('#vcAdd').addEventListener('click', () => newVoucher(p));
    p.querySelectorAll('[data-vprint]').forEach((b) => b.addEventListener('click', () => openPrint(`/api/print/voucher/${b.dataset.vprint}`)));
    p.querySelectorAll('[data-vrep]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('إنشاء سند جديد بنفس البيانات بتاريخ اليوم؟'))) return;
      try {
        const res = await api('POST', `/api/vouchers/${b.dataset.vrep}/repeat`);
        toast(`تم إنشاء السند ${res.voucher ? res.voucher.voucher_no : ''}`, 'success');
        vouchers(p);
      } catch (e) { toast(e.message, 'error'); }
    }));
    p.querySelectorAll('[data-vdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('إلغاء السند وعكس أثره على الخزنة والحسابات؟'))) return;
      try { await api('DELETE', `/api/vouchers/${b.dataset.vdel}`); toast('تم إلغاء السند', 'success'); vouchers(p); } catch (e) { toast(e.message, 'error'); }
    }));
  }

  async function newVoucher(p) {
    const [customers, suppliers, accounts] = await Promise.all([
      api('GET', '/api/customers?page_size=300').then((r) => r.rows).catch(() => []),
      api('GET', '/api/suppliers?page_size=300').then((r) => r.rows).catch(() => []),
      api('GET', '/api/accounts').then((r) => r.accounts).catch(() => []),
    ]);
    modal({
      title: 'سند جديد',
      size: 'max-w-lg',
      body: `
        <div class="grid grid-cols-3 gap-2 mb-3">
          <button data-vt="receipt" class="vt-btn btn btn-success">سند قبض</button>
          <button data-vt="payout" class="vt-btn btn btn-ghost">سند صرف</button>
          <button data-vt="transfer" class="vt-btn btn btn-ghost">سند نقل</button>
        </div>
        <div id="vcParty">
          <div class="grid grid-cols-2 gap-2">
            <div>${field('نوع الطرف', '<select id="vcPartnerType" class="field"><option value="customer">عميل</option><option value="supplier">مورد</option></select>')}</div>
            <div>${field('الطرف', '<select id="vcPartner" class="field"></select>')}</div>
          </div>
          <div class="mt-2">${field('طريقة الدفع', '<select id="vcMethod" class="field"><option value="cash">نقدي</option><option value="card">بطاقة</option></select>')}</div>
        </div>
        <div id="vcAccounts" class="hidden grid-cols-2 gap-2">
          <div>${field('من حساب', `<select id="vcFrom" class="field">${accounts.map((a) => `<option value="${esc(a.code)}">${esc(a.code)} - ${esc(a.name)}</option>`).join('')}</select>`)}</div>
          <div>${field('إلى حساب', `<select id="vcTo" class="field">${accounts.map((a) => `<option value="${esc(a.code)}">${esc(a.code)} - ${esc(a.name)}</option>`).join('')}</select>`)}</div>
        </div>
        <div class="mt-2">${field('المبلغ', '<input id="vcAmount" type="number" class="field !text-lg font-bold" />')}</div>
        <div class="mt-2">${field('البيان', '<input id="vcDesc" class="field" />')}</div>
        <div class="mt-2">${field('التاريخ', `<input id="vcDate" type="date" value="${new Date().toLocaleDateString('en-CA')}" class="field" />`)}</div>`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="vcSave" class="btn btn-primary">حفظ السند</button>`,
      onMount(wrap, close) {
        let type = 'receipt';
        const partnerSel = wrap.querySelector('#vcPartner');
        const fillPartners = () => {
          const t = wrap.querySelector('#vcPartnerType').value;
          const list = t === 'supplier' ? suppliers : customers;
          partnerSel.innerHTML = `<option value="">— بدون —</option>` + list.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
        };
        fillPartners();
        wrap.querySelector('#vcPartnerType').addEventListener('change', fillPartners);
        wrap.querySelectorAll('[data-vt]').forEach((b) => b.addEventListener('click', () => {
          type = b.dataset.vt;
          wrap.querySelectorAll('[data-vt]').forEach((x) => { x.className = 'vt-btn btn btn-ghost'; });
          b.className = `vt-btn btn btn-${type === 'receipt' ? 'success' : type === 'payout' ? 'danger' : 'primary'}`;
          const isTransfer = type === 'transfer';
          wrap.querySelector('#vcParty').classList.toggle('hidden', isTransfer);
          wrap.querySelector('#vcAccounts').classList.toggle('hidden', !isTransfer);
          wrap.querySelector('#vcAccounts').classList.toggle('grid', isTransfer);
        }));
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#vcSave').addEventListener('click', async () => {
          const body = {
            type,
            amount: Number(wrap.querySelector('#vcAmount').value),
            description: wrap.querySelector('#vcDesc').value,
            date: wrap.querySelector('#vcDate').value,
          };
          if (type === 'transfer') {
            body.from_account = wrap.querySelector('#vcFrom').value;
            body.to_account = wrap.querySelector('#vcTo').value;
          } else {
            body.partner_type = wrap.querySelector('#vcPartnerType').value;
            body.partner_id = partnerSel.value || null;
            body.method = wrap.querySelector('#vcMethod').value;
          }
          try {
            await api('POST', '/api/vouchers', body);
            toast('تم حفظ السند', 'success');
            close();
            vouchers(p);
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }

  async function zreport(p) {
    const date = p.querySelector('#zrDate') ? p.querySelector('#zrDate').value : new Date().toLocaleDateString('en-CA');
    const data = await api('GET', `/api/reports/z-report?date=${encodeURIComponent(date)}`);
    p.innerHTML = `
      <div class="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div><label class="label">التاريخ</label><input id="zrDate" type="date" class="field !w-40" value="${esc(date)}" /></div>
        <button id="zrApply" class="btn btn-primary"><i class="bi bi-funnel"></i> عرض</button>
        <button id="zrPrint" class="btn btn-ghost"><i class="bi bi-printer"></i> طباعة</button>
      </div>
      <div class="grid grid-cols-4 gap-4 mb-4">
        <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-receipt"></i></div><div><div class="kpi-value">${data.sales.count}</div><div class="kpi-label">عدد الفواتير</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-cash-stack"></i></div><div><div class="kpi-value">${money(data.net_sales)}</div><div class="kpi-label">صافي المبيعات</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-arrow-down-up"></i></div><div><div class="kpi-value">${money(data.cash_movement.in - data.cash_movement.out)}</div><div class="kpi-label">صافي حركة النقد</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-slate-100 text-slate-600"><i class="bi bi-safe"></i></div><div><div class="kpi-value">${money(data.expected_cash)}</div><div class="kpi-label">النقد المتوقع</div></div></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="card">
          <div class="p-4 border-b border-slate-100 font-black">ملخص اليوم</div>
          <div class="p-4 space-y-2 text-sm">
            <div class="flex justify-between"><span>مبيعات نقدية</span><b>${money(data.sales.cash)}</b></div>
            <div class="flex justify-between"><span>مبيعات بطاقة</span><b>${money(data.sales.card)}</b></div>
            <div class="flex justify-between"><span>مبيعات محفظة</span><b>${money(data.sales.wallet || 0)}</b></div>
            <div class="flex justify-between"><span>مبيعات آجلة</span><b>${money(data.sales.credit)}</b></div>
            <div class="flex justify-between text-rose-600"><span>مرتجعات (${data.returns.count})</span><b>-${money(data.returns.total)}</b></div>
            <div class="flex justify-between border-b border-dashed pb-2"><span class="font-bold">صافي المبيعات</span><b class="text-zain-700">${money(data.net_sales)}</b></div>
            <div class="flex justify-between text-rose-600"><span>مصروفات (${data.expenses.count})</span><b>-${money(data.expenses.total)}</b></div>
            <div class="flex justify-between text-emerald-600"><span>سندات قبض (${data.vouchers.receipt.count})</span><b>+${money(data.vouchers.receipt.total)}</b></div>
            <div class="flex justify-between text-rose-600"><span>سندات صرف (${data.vouchers.payout.count})</span><b>-${money(data.vouchers.payout.total)}</b></div>
            <div class="flex justify-between"><span>سندات نقل (${data.vouchers.transfer.count})</span><b>${money(data.vouchers.transfer.total)}</b></div>
            <div class="flex justify-between border-t border-dashed pt-2"><span class="font-bold">الرصيد النقدي المتوقع</span><b class="text-zain-700">${money(data.expected_cash)}</b></div>
          </div>
        </div>
        <div class="card">
          <div class="p-4 border-b border-slate-100 font-black">المبيعات حسب الساعة</div>
          <div class="overflow-auto max-h-72">
            <table class="w-full">
              <thead><tr><th class="th">الساعة</th><th class="th">العدد</th><th class="th">المبلغ</th></tr></thead>
              <tbody>${data.hourly.map((h) => `<tr class="tr"><td class="td">${esc(h.hour)}:00</td><td class="td">${h.count}</td><td class="td font-bold">${money(h.total, '')}</td></tr>`).join('') || '<tr><td colspan="3" class="td text-center text-slate-400 py-6">لا توجد مبيعات</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card mt-4">
        <div class="p-4 border-b border-slate-100 font-black">الأصناف الأكثر مبيعاً</div>
        <div class="overflow-auto max-h-64">
          <table class="w-full">
            <thead><tr><th class="th">الصنف</th><th class="th">الكمية</th><th class="th">المبلغ</th></tr></thead>
            <tbody>${data.top_products.map((x) => `<tr class="tr"><td class="td font-bold">${esc(x.name)}</td><td class="td">${num(x.qty)}</td><td class="td">${money(x.total, '')}</td></tr>`).join('') || '<tr><td colspan="3" class="td text-center text-slate-400 py-6">لا توجد مبيعات</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
    p.querySelector('#zrApply').addEventListener('click', () => zreport(p));
    p.querySelector('#zrPrint').addEventListener('click', () => openPrint(`/api/print/z-report?date=${encodeURIComponent(date)}`));
  }

  async function zakat(p) {
    await renderZakat(p);
  }

  async function renderZakat(p, data) {
    const d = data || await api('GET', '/api/reports/zakat');
    p.innerHTML = `
      <div class="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div><label class="label">نسبة الزكاة %</label><input id="zkRate" type="number" step="0.01" class="field !w-28" value="${esc(String(d.settings.rate))}" /></div>
        <div><label class="label">النصاب (غرام ذهب)</label><input id="zkGrams" type="number" step="0.01" class="field !w-28" value="${esc(String(d.settings.nisab_grams))}" /></div>
        <div><label class="label">سعر الغرام</label><input id="zkGold" type="number" step="0.01" class="field !w-32" value="${esc(String(d.settings.gold_price))}" /></div>
        <label class="flex items-center gap-2 text-sm h-10"><input id="zkRecv" type="checkbox" class="accent-zain-600" ${d.settings.include_receivables ? 'checked' : ''} /> القمم المدينة</label>
        <label class="flex items-center gap-2 text-sm h-10"><input id="zkLiab" type="checkbox" class="accent-zain-600" ${d.settings.include_liabilities ? 'checked' : ''} /> القمم الدائنة</label>
        <button id="zkApply" class="btn btn-primary"><i class="bi bi-arrow-repeat"></i> احتساب</button>
        <button id="zkPrint" class="btn btn-ghost"><i class="bi bi-printer"></i> طباعة</button>
      </div>
      <div class="grid grid-cols-4 gap-4 mb-4">
        <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-wallet2"></i></div><div><div class="kpi-value">${money(d.assets.cash)}</div><div class="kpi-label">النقد بالخزنة</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-zain-100 text-zain-700"><i class="bi bi-box-seam"></i></div><div><div class="kpi-value">${money(d.assets.inventory_cost)}</div><div class="kpi-label">قيمة المخزون (تكلفة)</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-people"></i></div><div><div class="kpi-value">${money(d.assets.receivables)}</div><div class="kpi-label">القمم المدينة</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-rose-100 text-rose-700"><i class="bi bi-cash-coin"></i></div><div><div class="kpi-value">${money(d.zakat_due)}</div><div class="kpi-label">الزكاة المستحقة</div></div></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="card">
          <div class="p-4 border-b border-slate-100 font-black">حساب الوعاء الزكوي</div>
          <div class="p-4 space-y-2 text-sm">
            <div class="flex justify-between"><span>النقد بالخزنة</span><b>${money(d.assets.cash)}</b></div>
            <div class="flex justify-between"><span>قيمة المخزون (تكلفة)</span><b>${money(d.assets.inventory_cost)}</b></div>
            <div class="flex justify-between"><span>القمم المدينة</span><b>${money(d.assets.receivables)}</b></div>
            <div class="flex justify-between text-rose-600"><span>القمم الدائنة (تُخصم)</span><b>-${money(d.liabilities)}</b></div>
            <div class="flex justify-between border-b border-dashed pb-2"><span class="font-bold">إجمالي الأصول الزكوية</span><b>${money(d.assets.gross)}</b></div>
            <div class="flex justify-between"><span class="font-bold">صافي المال الزكوي</span><b class="text-zain-700">${money(d.net_assets)}</b></div>
            <div class="flex justify-between"><span>قيمة النصاب (${d.nisab.grams} غم)</span><b>${money(d.nisab.value)}</b></div>
            <div class="flex justify-between"><span>بلوغ النصاب</span><span class="badge ${d.nisab.reached ? 'badge-ok' : 'badge-warn'}">${d.nisab.reached ? 'بلغ النصاب' : 'دون النصاب'}</span></div>
            <div class="flex justify-between border-t border-dashed pt-2"><span class="font-bold">الزكاة المستحقة (${d.rate}%)</span><b class="text-emerald-600">${money(d.zakat_due)}</b></div>
          </div>
        </div>
        <div class="card">
          <div class="p-4 border-b border-slate-100 font-black">تفاصيل المخزون</div>
          <div class="p-4 space-y-2 text-sm">
            <div class="flex justify-between"><span>قيمة المخزون بالتكلفة</span><b>${money(d.assets.inventory_cost)}</b></div>
            <div class="flex justify-between"><span>قيمة المخزون بسعر البيع</span><b>${money(d.assets.inventory_sale)}</b></div>
            <div class="flex justify-between"><span>ربح المخزون المتوقع</span><b class="text-emerald-600">${money(d.assets.inventory_sale - d.assets.inventory_cost)}</b></div>
            <div class="flex justify-between border-t border-dashed pt-2"><span>رصيد الخزنة الحالي</span><b>${money(d.treasury_balance)}</b></div>
            <p class="text-[11px] text-slate-400 pt-2 leading-5">يُحتسب الوعاء الزكوي وفق القيمة الدفترية للمخزون والنقد والذمم، مع خصم الالتزامات عند تفعيل الخيار. النصاب = عدد جرامات الذهب × سعر الغرام. النتيجة استرشادية وتخضع لتقدير المحاسب الشرعي.</p>
          </div>
        </div>
      </div>`;
    const gather = () => ({
      rate: p.querySelector('#zkRate').value,
      nisab_grams: p.querySelector('#zkGrams').value,
      gold_price: p.querySelector('#zkGold').value,
      include_receivables: p.querySelector('#zkRecv').checked ? 1 : 0,
      include_liabilities: p.querySelector('#zkLiab').checked ? 1 : 0,
    });
    p.querySelector('#zkApply').addEventListener('click', async () => {
      const q = gather();
      const qs = new URLSearchParams(q).toString();
      const fresh = await api('GET', `/api/reports/zakat?${qs}`);
      renderZakat(p, fresh);
    });
    p.querySelector('#zkPrint').addEventListener('click', () => {
      const q = gather();
      openPrint(`/api/print/zakat?${new URLSearchParams(q).toString()}`);
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
        <td class="td"><div class="flex gap-1">
          <button data-aledger="${a.id}" class="btn btn-ghost btn-sm" title="دفتر الأستاذ"><i class="bi bi-journal-text"></i></button>
          <button data-aprint="${a.id}" class="btn btn-ghost btn-sm" title="طباعة"><i class="bi bi-printer"></i></button>
          ${a.is_system ? '<span class="badge badge-info">نظامي</span>' : `<button data-adel="${a.id}" class="text-rose-400 hover:text-rose-600"><i class="bi bi-trash3"></i></button>`}
        </div></td>
      </tr>${a.children ? render(a.children, depth + 1) : ''}`).join('');
    p.innerHTML = `
      <div class="card">
        <div class="p-4 flex justify-between items-center border-b border-slate-100"><div class="font-black">شجرة الحسابات</div><button id="acAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> حساب جديد</button></div>
        <div class="overflow-auto max-h-[62vh]"><table class="w-full"><thead><tr><th class="th">الحساب</th><th class="th">النوع</th><th class="th">الرصيد</th><th class="th"></th></tr></thead><tbody>${render(data.tree)}</tbody></table></div>
      </div>`;
    p.querySelectorAll('[data-aprint]').forEach((b) => b.addEventListener('click', () => openPrint(`/api/print/account/${b.dataset.aprint}`)));
    p.querySelectorAll('[data-aledger]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.aledger;
      const acc = data.accounts.find((a) => String(a.id) === String(id));
      const entries = await api('GET', `/api/accounts/${id}/entries`);
      let running = 0;
      modal({
        title: `دفتر الأستاذ — ${acc ? acc.code + ' ' + acc.name : ''}`,
        size: 'max-w-3xl',
        body: `<div class="overflow-auto max-h-[60vh]"><table class="w-full">
          <thead><tr><th class="th">التاريخ</th><th class="th">البيان</th><th class="th">المرجع</th><th class="th">مدين</th><th class="th">دائن</th><th class="th">الرصيد</th></tr></thead>
          <tbody>${entries.entries.length ? entries.entries.map((e) => {
            running += (e.direction === 'debit' ? Number(e.amount) : 0) - (e.direction === 'credit' ? Number(e.amount) : 0);
            return `<tr class="tr"><td class="td text-xs">${esc(String(e.created_at).slice(0, 16))}</td><td class="td">${esc(e.description || '-')}</td><td class="td font-mono text-xs">${esc(e.ref || '')}</td><td class="td">${e.direction === 'debit' ? money(e.amount, '') : '—'}</td><td class="td">${e.direction === 'credit' ? money(e.amount, '') : '—'}</td><td class="td font-bold">${money(running, '')}</td></tr>`;
          }).join('') : '<tr><td colspan="6" class="td text-center text-slate-400 py-6">لا توجد قيود</td></tr>'}</tbody>
        </table></div>
        <p class="text-xs text-slate-500 mt-2">الرصيد الحالي: <b>${money(entries.balance, '')}</b></p>`,
        footer: `<button data-close class="btn btn-ghost">إغلاق</button><button id="ldPrint" class="btn btn-primary"><i class="bi bi-printer"></i> طباعة</button>`,
        onMount(wrap) {
          wrap.querySelector('#ldPrint').addEventListener('click', () => openPrint(`/api/print/account/${id}`));
        },
      });
    }));
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
      <tbody>${data.rows.map((r) => `<tr class="tr"><td class="td font-bold">${esc(r.customer_name || '-')}</td><td class="td">${money(r.total)}</td><td class="td text-emerald-600">${money(r.paid_amount)}</td><td class="td text-rose-600 font-bold">${money(r.remaining)}</td><td class="td"><span class="badge ${r.status === 'completed' ? 'badge-ok' : r.status === 'overdue' ? 'badge-danger' : 'badge-warn'}">${r.status === 'completed' ? 'مكتمل' : r.status === 'overdue' ? 'متأخر' : 'نشط'}</span></td>
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

  const FREQ = { daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', yearly: 'سنوي' };
  const pad2 = (n) => String(n).padStart(2, '0');
  const dateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const fromDb = (s) => String(s || '').replace(' ', 'T').slice(0, 16);

  async function scheduled(p) {
    const data = await api('GET', '/api/scheduled');
    const rows = data.rows || [];
    const activeRows = rows.filter((r) => r.active);
    const now = new Date();
    const dueCount = activeRows.filter((r) => new Date(String(r.next_run).replace(' ', 'T')) <= now).length;
    const runsTotal = rows.reduce((s, r) => s + (Number(r.runs_count) || 0), 0);
    p.innerHTML = `
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div class="kpi"><div class="kpi-icon bg-indigo-100 text-indigo-700"><i class="bi bi-calendar2-week"></i></div><div><div class="kpi-value">${num(activeRows.length)}</div><div class="kpi-label">جدولات نشطة</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-amber-100 text-amber-700"><i class="bi bi-alarm"></i></div><div><div class="kpi-value">${num(dueCount)}</div><div class="kpi-label">مستحقة الآن</div></div></div>
        <div class="kpi"><div class="kpi-icon bg-emerald-100 text-emerald-700"><i class="bi bi-arrow-repeat"></i></div><div><div class="kpi-value">${num(runsTotal)}</div><div class="kpi-label">فواتير منشأة</div></div></div>
      </div>
      <div class="card p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-black">الفواتير المجدولة</div>
          <button id="schAdd" class="btn btn-primary btn-sm"><i class="bi bi-plus-lg"></i> جدولة جديدة</button>
        </div>
        <div class="overflow-auto max-h-[56vh]"><table class="w-full">
          <thead><tr><th class="th">العنوان</th><th class="th">النوع</th><th class="th">الجهة</th><th class="th">التكرار</th><th class="th">التشغيل القادم</th><th class="th">آخر تشغيل</th><th class="th">مرات</th><th class="th">الحالة</th><th class="th"></th></tr></thead>
          <tbody>${rows.map((r) => `<tr class="tr">
            <td class="td font-bold">${esc(r.title)}</td>
            <td class="td"><span class="badge ${r.type === 'purchase' ? 'badge-warn' : 'badge-info'}">${r.type === 'purchase' ? 'شراء' : 'بيع'}</span></td>
            <td class="td">${esc(r.type === 'purchase' ? (r.supplier_name || '-') : (r.customer_name || '-'))}</td>
            <td class="td">${FREQ[r.frequency] || esc(r.frequency)}</td>
            <td class="td" dir="ltr">${esc(r.next_run || '-')}</td>
            <td class="td text-slate-500" dir="ltr">${esc(r.last_run || '-')}</td>
            <td class="td">${num(r.runs_count)}</td>
            <td class="td"><span class="badge ${r.active ? 'badge-ok' : 'badge-mute'}">${r.active ? 'نشطة' : 'متوقفة'}</span></td>
            <td class="td whitespace-nowrap">
              <button data-sch-run="${r.id}" class="btn btn-success btn-sm" title="إنشاء الفاتورة الآن"><i class="bi bi-play-fill"></i></button>
              <button data-sch-edit="${r.id}" class="btn btn-ghost btn-sm" title="تعديل"><i class="bi bi-pencil"></i></button>
              <button data-sch-toggle="${r.id}" class="btn btn-ghost btn-sm" title="${r.active ? 'إيقاف' : 'تنشيط'}"><i class="bi ${r.active ? 'bi-pause-fill' : 'bi-play-circle'}"></i></button>
              <button data-sch-del="${r.id}" class="btn btn-ghost btn-sm text-rose-600" title="حذف"><i class="bi bi-trash"></i></button>
            </td></tr>`).join('') || '<tr><td colspan="9" class="td text-center text-slate-400 py-8">لا توجد فواتير مجدولة</td></tr>'}</tbody>
        </table></div>
      </div>`;
    p.querySelector('#schAdd').addEventListener('click', () => scheduledForm(p, null));
    p.querySelectorAll('[data-sch-edit]').forEach((b) => b.addEventListener('click', () => {
      scheduledForm(p, rows.find((x) => x.id === +b.dataset.schEdit));
    }));
    p.querySelectorAll('[data-sch-run]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await api('POST', `/api/scheduled/${b.dataset.schRun}/run`);
        toast(`تم إنشاء الفاتورة ${res.invoice ? res.invoice.invoice_no : ''}`, 'success');
        scheduled(p);
      } catch (e) { toast(e.message, 'error'); }
    }));
    p.querySelectorAll('[data-sch-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const row = rows.find((x) => x.id === +b.dataset.schToggle);
      try {
        await api('PUT', `/api/scheduled/${row.id}`, { active: row.active ? 0 : 1 });
        toast(row.active ? 'تم إيقاف الجدولة' : 'تم تنشيط الجدولة', 'success');
        scheduled(p);
      } catch (e) { toast(e.message, 'error'); }
    }));
    p.querySelectorAll('[data-sch-del]').forEach((b) => b.addEventListener('click', async () => {
      const row = rows.find((x) => x.id === +b.dataset.schDel);
      if (!(await confirmBox(`حذف جدولة «${row.title}»؟`))) return;
      try {
        await api('DELETE', `/api/scheduled/${row.id}`);
        toast('تم الحذف', 'success');
        scheduled(p);
      } catch (e) { toast(e.message, 'error'); }
    }));
  }

  async function scheduledForm(p, existing) {
    const [customers, suppliers, products] = await Promise.all([
      api('GET', '/api/customers?page_size=300').then((r) => r.rows).catch(() => []),
      api('GET', '/api/suppliers?page_size=300').then((r) => r.rows).catch(() => []),
      api('GET', '/api/products?page_size=500').then((r) => r.rows).catch(() => []),
    ]);
    let items = [];
    try { items = existing ? JSON.parse(existing.items || '[]') : []; } catch { items = []; }
    if (!items.length) items = [{ qty: 1, unit_price: 0 }];
    const defaultNext = existing ? fromDb(existing.next_run) : dateInput(new Date(Date.now() + 24 * 3600 * 1000));
    const type = existing ? existing.type : 'sale';
    const partyOptions = (list, selected) => list.map((x) => `<option value="${x.id}" ${String(x.id) === String(selected) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const productOptions = (selected) => `<option value="">— بند حر —</option>` + products.map((x) => `<option value="${x.id}" ${String(x.id) === String(selected) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const itemRow = (it = {}) => `
      <div class="grid grid-cols-12 gap-2 items-center" data-sch-row>
        <select data-si-product class="field col-span-4">${productOptions(it.product_id)}</select>
        <input data-si-name class="field col-span-4" value="${esc(it.name || '')}" placeholder="الوصف" />
        <input data-si-qty type="number" min="0.01" step="any" class="field col-span-1 text-center" value="${it.qty || 1}" title="الكمية" />
        <input data-si-price type="number" min="0" step="any" class="field col-span-2 text-left" value="${it.unit_price || 0}" title="السعر" />
        <button data-si-del class="btn btn-ghost btn-sm col-span-1"><i class="bi bi-x-lg"></i></button>
      </div>`;
    modal({
      title: existing ? 'تعديل جدولة' : 'جدولة فاتورة',
      size: 'max-w-2xl',
      body: `
        <div class="grid grid-cols-2 gap-2">
          ${field('العنوان', `<input id="schTitle" class="field" value="${esc(existing ? existing.title : '')}" placeholder="إيجار شهري" />`)}
          ${field('نوع الفاتورة', `<select id="schType" class="field"><option value="sale" ${type === 'sale' ? 'selected' : ''}>بيع</option><option value="purchase" ${type === 'purchase' ? 'selected' : ''}>شراء</option></select>`)}
        </div>
        <div class="mt-2">${field('الجهة', `<select id="schParty" class="field"></select>`)}</div>
        <div class="grid grid-cols-2 gap-2 mt-2">
          ${field('التكرار', `<select id="schFreq" class="field">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${existing && existing.frequency === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
          ${field('التشغيل القادم', `<input id="schNext" type="datetime-local" class="field" value="${defaultNext}" />`)}
        </div>
        <div class="grid grid-cols-2 gap-2 mt-2">
          ${field('طريقة الدفع', `<select id="schMethod" class="field"><option value="credit" ${existing && existing.payment_method === 'credit' ? 'selected' : ''}>آجل</option><option value="cash" ${existing && existing.payment_method === 'cash' ? 'selected' : ''}>نقدي</option></select>`)}
          ${field('الخصم', `<input id="schDiscount" type="number" min="0" step="any" class="field" value="${Number(existing ? existing.discount : 0) || 0}" />`)}
        </div>
        <div class="mt-2">${field('ملاحظات', `<input id="schNotes" class="field" value="${esc(existing && existing.notes ? existing.notes : '')}" />`)}</div>
        <div class="flex items-center justify-between mt-3 mb-1">
          <div class="text-xs font-bold text-slate-500">الأصناف</div>
          <button id="schAddItem" class="btn btn-ghost btn-sm"><i class="bi bi-plus-lg"></i> إضافة صنف</button>
        </div>
        <div id="schItems" class="flex flex-col gap-2">${items.map((it) => itemRow(it)).join('')}</div>`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="schSave" class="btn btn-primary">حفظ الجدولة</button>`,
      onMount(wrap, close) {
        const party = wrap.querySelector('#schParty');
        const fillParty = () => {
          const t = wrap.querySelector('#schType').value;
          const list = t === 'purchase' ? suppliers : customers;
          const selected = existing ? (t === 'purchase' ? existing.supplier_id : existing.customer_id) : null;
          party.innerHTML = `<option value="">— بدون —</option>` + partyOptions(list, selected);
        };
        fillParty();
        wrap.querySelector('#schType').addEventListener('change', fillParty);
        const itemsBox = wrap.querySelector('#schItems');
        const sync = (row) => {
          const pId = row.querySelector('[data-si-product]').value;
          const prod = products.find((x) => String(x.id) === String(pId));
          if (prod) {
            row.querySelector('[data-si-name]').value = prod.name;
            row.querySelector('[data-si-price]').value = Number(prod.sale_price) || 0;
          }
        };
        itemsBox.querySelectorAll('[data-sch-row]').forEach((row) => {
          row.querySelector('[data-si-product]').addEventListener('change', () => sync(row));
          row.querySelector('[data-si-del]').addEventListener('click', () => {
            if (itemsBox.querySelectorAll('[data-sch-row]').length <= 1) return;
            row.remove();
          });
        });
        wrap.querySelector('#schAddItem').addEventListener('click', () => {
          itemsBox.insertAdjacentHTML('beforeend', itemRow({ qty: 1, unit_price: 0 }));
          const row = itemsBox.lastElementChild;
          row.querySelector('[data-si-product]').addEventListener('change', () => sync(row));
          row.querySelector('[data-si-del]').addEventListener('click', () => {
            if (itemsBox.querySelectorAll('[data-sch-row]').length <= 1) return;
            row.remove();
          });
        });
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#schSave').addEventListener('click', async () => {
          const type = wrap.querySelector('#schType').value;
          const rows = [...itemsBox.querySelectorAll('[data-sch-row]')].map((row) => ({
            product_id: row.querySelector('[data-si-product]').value || null,
            name: row.querySelector('[data-si-name]').value.trim(),
            qty: Number(row.querySelector('[data-si-qty]').value) || 1,
            unit_price: Number(row.querySelector('[data-si-price]').value) || 0,
          })).filter((it) => it.product_id || it.name);
          const body = {
            title: wrap.querySelector('#schTitle').value.trim(),
            type,
            frequency: wrap.querySelector('#schFreq').value,
            next_run: String(wrap.querySelector('#schNext').value || '').replace('T', ' '),
            payment_method: wrap.querySelector('#schMethod').value,
            discount: Number(wrap.querySelector('#schDiscount').value) || 0,
            notes: wrap.querySelector('#schNotes').value,
            customer_id: type === 'sale' ? (party.value || null) : null,
            supplier_id: type === 'purchase' ? (party.value || null) : null,
            items,
          };
          try {
            if (existing) await api('PUT', `/api/scheduled/${existing.id}`, body);
            else await api('POST', '/api/scheduled', body);
            toast('تم حفظ الجدولة', 'success');
            close();
            scheduled(p);
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
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
        <thead><tr><th class="th">#</th><th class="th">الموظف</th><th class="th">الفرع</th><th class="th">الفتح</th><th class="th">الإغلاق</th><th class="th">رصيد الفتح</th><th class="th">المبيعات</th><th class="th">النقدي</th><th class="th">الآجل</th><th class="th">المتوقع</th><th class="th">الإقفال</th><th class="th">الحالة</th></tr></thead>
        <tbody>${data.rows.map((r) => `<tr class="tr">
          <td class="td">${r.id}</td><td class="td font-bold">${esc(r.user_name || '-')}</td>
          <td class="td text-xs font-bold text-slate-600">${esc(r.branch || 'الرئيسي')}</td>
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
