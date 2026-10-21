import { api, state, money, esc, toast, modal, confirmBox, field, formToObject, downloadFile, openPrint, copyText } from '../core.js';

export async function renderCustomers(c) {
  await contactsView(c, 'customers');
}
export async function renderSuppliers(c) {
  await contactsView(c, 'suppliers');
}

async function contactsView(c, kind) {
  const isCustomer = kind === 'customers';
  const labels = isCustomer
    ? { balance: 'إجمالي الذمم', add: 'عميل جديد' }
    : { balance: 'إجمالي الالتزامات', add: 'مورد جديد' };
  let search = '';

  const initial = await api('GET', `/api/${kind}?page_size=300`);
  c.innerHTML = `
    <div class="card">
      <div class="p-4 flex items-center gap-3 border-b border-slate-100">
        <div class="relative flex-1 max-w-md">
          <i class="bi bi-search absolute top-1/2 -translate-y-1/2 right-3.5 text-slate-400"></i>
          <input id="cSearch" class="field !pr-11" placeholder="بحث بالاسم / الهاتف" />
        </div>
        <div class="ml-auto text-sm text-slate-500">${labels.balance}: <b class="text-zain-700" id="cTotal">${money(isCustomer ? initial.debtors_total : initial.creditors_total)}</b></div>
        <button id="cExport" class="btn btn-ghost"><i class="bi bi-filetype-csv"></i> تصدير CSV</button>
        <button id="cAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> ${labels.add}</button>
      </div>
      <div class="overflow-auto max-h-[calc(100vh-230px)]">
        <table class="w-full">
          <thead><tr><th class="th">الاسم</th><th class="th">الهاتف</th><th class="th">${isCustomer ? 'النوع' : 'الشركة'}</th><th class="th">الرصيد</th><th class="th"></th></tr></thead>
          <tbody id="cBody"></tbody>
        </table>
      </div>
    </div>`;

  const paint = (rows) => {
    c.querySelector('#cBody').innerHTML = rows.length ? rows.map((r) => `
      <tr class="tr">
        <td class="td font-bold text-slate-800">${esc(r.name)}</td>
        <td class="td font-mono text-xs">${esc(r.phone || '-')}</td>
        <td class="td">${isCustomer
          ? `<span class="badge ${r.type === 'wholesale' ? 'badge-info' : 'badge-mute'}">${r.type === 'wholesale' ? 'جملة' : 'تجزئة'}</span>`
          : esc(r.company || '-')}</td>
        <td class="td font-bold ${Number(r.balance) > 0 ? 'text-rose-600' : 'text-slate-500'}">${money(r.balance)}</td>
        <td class="td">
          <div class="flex gap-1">
            <button data-stmt="${r.id}" class="btn btn-ghost btn-sm" title="كشف حساب"><i class="bi bi-file-text"></i></button>
            <button data-pay="${r.id}" class="btn btn-ghost btn-sm text-emerald-600" title="دفعة"><i class="bi bi-cash-coin"></i></button>
            <button data-edit="${r.id}" class="btn btn-ghost btn-sm"><i class="bi bi-pencil"></i></button>
            <button data-del="${r.id}" class="btn btn-ghost btn-sm text-rose-500"><i class="bi bi-trash3"></i></button>
          </div>
        </td>
      </tr>`).join('') : `<tr><td colspan="5" class="td text-center text-slate-400 py-10">لا توجد بيانات</td></tr>`;

    c.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(rows.find((x) => x.id === +b.dataset.edit))));
    c.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => payment(rows.find((x) => x.id === +b.dataset.pay))));
    c.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const r = rows.find((x) => x.id === +b.dataset.del);
      if (!(await confirmBox(`أرشفة "${r.name}"؟`))) return;
      await api('DELETE', `/api/${kind}/${r.id}`);
      toast('تم', 'success');
      reload();
    }));
    c.querySelectorAll('[data-stmt]').forEach((b) => b.addEventListener('click', () => statement(+b.dataset.stmt)));
  };

  const reload = async () => {
    const d = await api('GET', `/api/${kind}?page_size=300&search=${encodeURIComponent(search)}`);
    c.querySelector('#cTotal').textContent = money(isCustomer ? d.debtors_total : d.creditors_total);
    paint(d.rows);
  };
  paint(initial.rows);

  c.querySelector('#cSearch').addEventListener('input', (e) => {
    search = e.target.value;
    clearTimeout(c._t);
    c._t = setTimeout(reload, 300);
  });
  c.querySelector('#cAdd').addEventListener('click', () => form(null));
  c.querySelector('#cExport').addEventListener('click', async () => {
    try {
      await downloadFile(`/api/export/${isCustomer ? 'customers' : 'suppliers'}`, isCustomer ? 'العملاء.csv' : 'الموردون.csv');
      toast('تم تصدير الملف', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  function form(rec) {
    const r = rec || {};
    modal({
      title: rec ? `تعديل: ${r.name}` : labels.add,
      size: 'max-w-lg',
      body: `<form id="cForm" class="grid grid-cols-2 gap-4">
        ${field('الاسم *', `<input name="name" value="${esc(r.name || '')}" class="field" required />`)}
        ${field('الهاتف', `<input name="phone" value="${esc(r.phone || '')}" class="field" />`)}
        ${isCustomer
          ? field('النوع', `<select name="type" class="field"><option value="retail" ${r.type !== 'wholesale' ? 'selected' : ''}>تجزئة</option><option value="wholesale" ${r.type === 'wholesale' ? 'selected' : ''}>جملة</option></select>`)
          : field('الشركة', `<input name="company" value="${esc(r.company || '')}" class="field" />`)}
        ${field('البريد', `<input name="email" value="${esc(r.email || '')}" class="field" />`)}
        ${field('العنوان', `<input name="address" value="${esc(r.address || '')}" class="field" />`)}
        ${field('الرصيد الافتتاحي', `<input name="balance" type="number" value="${r.balance || 0}" class="field" />`)}
        ${isCustomer ? field('سقف الدين', `<input name="credit_limit" type="number" value="${r.credit_limit || 0}" class="field" />`) : ''}
        <div class="col-span-2">${field('ملاحظات', `<textarea name="notes" class="field" rows="2">${esc(r.notes || '')}</textarea>`)}</div>
      </form>`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="cSave" class="btn btn-primary">حفظ</button>`,
      onMount(wrap, close) {
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#cSave').addEventListener('click', async () => {
          const f = wrap.querySelector('#cForm');
          if (!f.reportValidity()) return;
          const data = formToObject(f);
          data.balance = Number(data.balance) || 0;
          if (data.credit_limit !== undefined) data.credit_limit = Number(data.credit_limit) || 0;
          try {
            if (rec) await api('PUT', `/api/${kind}/${rec.id}`, data);
            else await api('POST', `/api/${kind}`, data);
            toast('تم الحفظ', 'success');
            close();
            reload();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }

  function payment(rec) {
    modal({
      title: `تسجيل دفعة — ${rec.name}`,
      size: 'max-w-sm',
      body: `<div class="mb-3 text-sm text-slate-500">الرصيد الحالي: <b>${money(rec.balance)}</b></div>
        ${field('المبلغ', '<input id="payAmt" type="number" class="field" />')}
        ${field('طريقة الدفع', `<select id="payMethod" class="field"><option value="cash">نقدي</option><option value="card">بطاقة</option></select>`)}`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="paySave" class="btn btn-success">تسجيل</button>`,
      onMount(wrap, close) {
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#paySave').addEventListener('click', async () => {
          const amount = Number(wrap.querySelector('#payAmt').value);
          if (!amount) { toast('أدخل المبلغ', 'error'); return; }
          try {
            const endpoint = isCustomer ? `/api/customers/${rec.id}/payment` : `/api/suppliers/${rec.id}/payment`;
            await api('POST', endpoint, { amount, payment_method: wrap.querySelector('#payMethod').value });
            toast('تم تسجيل الدفعة', 'success');
            close();
            reload();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }

  async function statement(id) {
    const kind = isCustomer ? 'customer' : 'supplier';
    const data = await api('GET', `/api/statements/${kind}/${id}`);
    modal({
      title: `كشف حساب: ${data.party.name}`,
      size: 'max-w-4xl',
      body: `
        <div class="grid grid-cols-4 gap-3 mb-4">
          <div class="card p-3 text-center"><div class="text-xs text-slate-400">الرصيد الحالي</div><div class="font-black text-rose-600">${money(data.party.balance)}</div></div>
          <div class="card p-3 text-center"><div class="text-xs text-slate-400">الرصيد الافتتاحي</div><div class="font-black">${money(data.opening)}</div></div>
          <div class="card p-3 text-center"><div class="text-xs text-slate-400">أقدم مستحق</div><div class="font-black ${data.oldest_days > 60 ? 'text-rose-600' : ''}">${data.oldest_days} يوم</div></div>
          <div class="card p-3 text-center"><div class="text-xs text-slate-400">عدد الحركات</div><div class="font-black">${data.rows.length}</div></div>
        </div>
        <div class="overflow-auto max-h-[46vh] mb-4">
          <table class="w-full">
            <thead><tr><th class="th">التاريخ</th><th class="th">البيان</th><th class="th">المرجع</th><th class="th">مدين</th><th class="th">دائن</th><th class="th">الرصيد</th></tr></thead>
            <tbody>${data.rows.map((r) => `<tr class="tr">
              <td class="td text-xs">${esc(r.date)}</td>
              <td class="td">${esc(r.description)}</td>
              <td class="td font-mono text-xs">${esc(r.ref)}</td>
              <td class="td text-rose-600">${r.debit ? money(r.debit) : '—'}</td>
              <td class="td text-emerald-600">${r.credit ? money(r.credit) : '—'}</td>
              <td class="td font-bold">${money(r.balance)}</td>
            </tr>`).join('') || '<tr><td class="td text-center text-slate-400 py-6" colspan="6">لا توجد حركات</td></tr>'}</tbody>
          </table>
        </div>
        <h4 class="font-bold mb-2">أعمار الذمم</h4>
        <div class="grid grid-cols-4 gap-3">
          ${data.aging.map((b) => `<div class="card p-3 text-center">
            <div class="text-[11px] text-slate-400">${esc(b.label)}</div>
            <div class="font-black text-sm ${b.amount > 0 ? 'text-rose-600' : 'text-slate-400'}">${money(b.amount)}</div>
            <div class="text-[10px] text-slate-400">${b.count} فاتورة</div>
          </div>`).join('')}
        </div>`,
      footer: `<button data-close class="btn btn-ghost">إغلاق</button>
        ${isCustomer ? '<button id="stRemind" class="btn btn-ghost"><i class="bi bi-chat-dots"></i> نص تذكير</button>' : ''}
        <button id="stPrint" class="btn btn-primary"><i class="bi bi-printer"></i> طباعة الكشف</button>`,
      onMount(wrap, close) {
        wrap.querySelector('#stPrint').addEventListener('click', () => openPrint(`/api/print/statement/${kind}/${id}`));
        const remind = wrap.querySelector('#stRemind');
        if (remind) remind.addEventListener('click', () => reminderText(data, close));
      },
    });
  }

  function reminderText(data, closeStatement) {
    const amount = Number(data.party.balance) || 0;
    const text = `السلام عليكم أخي ${data.party.name}،\nنود تذكيركم بأن الذمم المستحقة لديكم مبلغ ${Number(amount).toLocaleString('ar-IQ')} ${state.settings.currency_symbol || 'د.ع'}، وتاريخ الاستحقاق ${data.oldest_days ? `منذ ${data.oldest_days} يوم` : 'حسب الفاتورة'}.\nنرجو التكرم بالسداد في أقرب وقت.\nشكراً لتعاونكم.`;
    modal({
      title: 'نص تذكير جاهز للنسخ',
      size: 'max-w-lg',
      body: `<p class="text-xs text-slate-500 mb-2">انسخ النص وأرسله للعميل عبر واتساب أو رسالة.</p>
        <textarea id="remText" class="field h-40" readonly>${esc(text)}</textarea>`,
      footer: `<button data-close class="btn btn-ghost">إغلاق</button><button id="remCopy" class="btn btn-primary"><i class="bi bi-clipboard"></i> نسخ النص</button>`,
      onMount(wrap, close) {
        wrap.querySelector('[data-close]').addEventListener('click', () => { close(); closeStatement(); });
        wrap.querySelector('#remCopy').addEventListener('click', async () => {
          const done = await copyText(wrap.querySelector('#remText').value);
          toast(done ? 'تم نسخ النص' : 'تعذر النسخ، انسخ يدوياً', done ? 'success' : 'error');
        });
      },
    });
  }
}
