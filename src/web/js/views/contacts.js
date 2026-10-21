import { api, money, esc, toast, modal, confirmBox, field, formToObject, downloadFile } from '../core.js';

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
            ${isCustomer ? `<button data-stmt="${r.id}" class="btn btn-ghost btn-sm" title="كشف حساب"><i class="bi bi-file-text"></i></button>` : ''}
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
    const data = await api('GET', `/api/customers/${id}`);
    modal({
      title: `كشف حساب: ${data.customer.name}`,
      size: 'max-w-3xl',
      body: `
        <div class="grid grid-cols-3 gap-3 mb-4">
          <div class="card p-3 text-center"><div class="text-xs text-slate-400">الرصيد</div><div class="font-black text-rose-600">${money(data.customer.balance)}</div></div>
          <div class="card p-3 text-center"><div class="text-xs text-slate-400">عدد الفواتير</div><div class="font-black">${data.invoices.length}</div></div>
          <div class="card p-3 text-center"><div class="text-xs text-slate-400">الأقساط</div><div class="font-black">${data.installments.length}</div></div>
        </div>
        <h4 class="font-bold mb-2">الفواتير</h4>
        <table class="w-full mb-4"><thead><tr><th class="th">الفاتورة</th><th class="th">التاريخ</th><th class="th">الإجمالي</th><th class="th">المتبقي</th></tr></thead>
        <tbody>${data.invoices.map((i) => `<tr class="tr"><td class="td">${esc(i.invoice_no)}</td><td class="td">${i.created_at}</td><td class="td">${money(i.total)}</td><td class="td">${money(i.due)}</td></tr>`).join('') || '<tr><td class="td text-center text-slate-400 py-6" colspan="4">لا يوجد</td></tr>'}</tbody></table>
        <h4 class="font-bold mb-2">الأقساط</h4>
        <table class="w-full"><thead><tr><th class="th">الإجمالي</th><th class="th">مدفوع</th><th class="th">متبقي</th><th class="th">الحالة</th></tr></thead>
        <tbody>${data.installments.map((i) => `<tr class="tr"><td class="td">${money(i.total)}</td><td class="td">${money(i.paid_amount)}</td><td class="td">${money(i.remaining)}</td><td class="td">${esc(i.status)}</td></tr>`).join('') || '<tr><td class="td text-center text-slate-400 py-6" colspan="4">لا يوجد</td></tr>'}</tbody></table>`,
    });
  }
}
