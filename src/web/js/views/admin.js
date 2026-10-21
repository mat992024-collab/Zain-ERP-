import { api, state, esc, toast, modal, confirmBox, field, emptyState, hasPerm, applyTheme, currentTheme } from '../core.js';

const PERMISSIONS = [
  { key: 'pos.sell', label: 'البيع في نقاط البيع' },
  { key: 'pos.shift', label: 'إدارة الورديات' },
  { key: 'sales.write', label: 'إدارة فواتير البيع' },
  { key: 'purchases.write', label: 'إدارة فواتير الشراء' },
  { key: 'inventory.write', label: 'تعديل المخزون والأصناف' },
  { key: 'products.write', label: 'إدارة المنتجات' },
  { key: 'customers.write', label: 'إدارة العملاء' },
  { key: 'suppliers.write', label: 'إدارة الموردين' },
  { key: 'accounting.write', label: 'العمليات المحاسبية' },
  { key: 'ai.use', label: 'استخدام محرك الذكاء الاصطناعي' },
  { key: 'settings.write', label: 'تعديل الإعدادات' },
  { key: 'admin.users', label: 'إدارة المستخدمين والصلاحيات' },
];

const ROLE_LABELS = { admin: 'مدير النظام', manager: 'مدير', accountant: 'محاسب', cashier: 'كاشير', warehouse: 'أمين مخزن' };

export async function renderAdmin(c) {
  const data = await api('GET', '/api/users');
  const canManage = hasPerm('admin.users');

  c.innerHTML = `
    <div class="card">
      <div class="p-4 flex justify-between items-center border-b border-slate-100">
        <div class="font-black flex items-center gap-2"><i class="bi bi-shield-lock text-zain-600"></i> المستخدمون والصلاحيات</div>
        ${canManage ? '<button id="uAdd" class="btn btn-primary"><i class="bi bi-person-plus"></i> مستخدم جديد</button>' : ''}
      </div>
      <div class="overflow-auto max-h-[70vh]"><table class="w-full">
        <thead><tr><th class="th">المستخدم</th><th class="th">الاسم الكامل</th><th class="th">الدور</th><th class="th">الصلاحيات</th><th class="th">الهاتف</th><th class="th">الحالة</th><th class="th"></th></tr></thead>
        <tbody>${data.rows.map((u) => `<tr class="tr">
          <td class="td font-mono text-xs font-bold">${esc(u.username)}</td>
          <td class="td font-bold">${esc(u.full_name)}</td>
          <td class="td"><span class="badge ${u.role === 'admin' ? 'badge-info' : 'badge-mute'}">${esc(ROLE_LABELS[u.role] || u.role)}</span></td>
          <td class="td text-xs text-slate-500">${u.role === 'admin' ? 'كل الصلاحيات' : esc((u.permissions || []).join('، ') || 'لا شيء')}</td>
          <td class="td text-xs">${esc(u.phone || '—')}</td>
          <td class="td"><span class="badge ${u.is_active ? 'badge-ok' : 'badge-danger'}">${u.is_active ? 'نشط' : 'معطل'}</span></td>
          <td class="td"><div class="flex gap-1">
            <button data-edit="${u.id}" class="btn btn-ghost btn-sm"><i class="bi bi-pencil"></i></button>
            ${u.id !== state.user.id ? `<button data-toggle="${u.id}" class="btn btn-ghost btn-sm"><i class="bi ${u.is_active ? 'bi-toggle-on text-emerald-600' : 'bi-toggle-off text-slate-400'}"></i></button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card p-4">
      <div class="font-black mb-2"><i class="bi bi-info-circle text-zain-600"></i> ملاحظة</div>
      <p class="text-sm text-slate-500">دور "مدير النظام" يمتلك جميع الصلاحيات تلقائياً. للأدوار الأخرى حدّد الصلاحيات المطلوبة من نموذج التعديل.</p>
    </div>`;

  const addBtn = c.querySelector('#uAdd');
  if (addBtn) addBtn.addEventListener('click', () => userForm(null));
  c.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => userForm(data.rows.find((x) => x.id === +b.dataset.edit))));
  c.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const u = data.rows.find((x) => x.id === +b.dataset.toggle);
    if (!(await confirmBox(`${u.is_active ? 'تعطيل' : 'تفعيل'} المستخدم ${u.full_name}؟`))) return;
    try { await api('PATCH', `/api/users/${u.id}/status`, { is_active: u.is_active ? 0 : 1 }); toast('تم', 'success'); renderAdmin(c); } catch (e) { toast(e.message, 'error'); }
  }));

  async function userForm(u) {
    const role = u ? u.role : 'cashier';
    const perms = u ? (u.permissions || []) : [];
    modal({
      title: u ? `تعديل المستخدم: ${u.full_name}` : 'مستخدم جديد',
      size: 'max-w-lg',
      body: `
        ${field('اسم الدخول', `<input id="uName" class="field" value="${esc(u ? u.username : '')}" ${u ? 'readonly' : ''} />`)}
        ${field('الاسم الكامل', `<input id="uFull" class="field" value="${esc(u ? u.full_name : '')}" />`)}
        ${field('الهاتف', `<input id="uPhone" class="field" value="${esc(u ? u.phone || '' : '')}" />`)}
        ${field('الصفة', `<select id="uRole" class="field">
          <option value="admin" ${role === 'admin' ? 'selected' : ''}>مدير النظام</option>
          <option value="manager" ${role === 'manager' ? 'selected' : ''}>مدير</option>
          <option value="cashier" ${role === 'cashier' ? 'selected' : ''}>أمين صندوق</option>
          <option value="accountant" ${role === 'accountant' ? 'selected' : ''}>محاسب</option>
          <option value="warehouse" ${role === 'warehouse' ? 'selected' : ''}>أمين مخزن</option>
        </select>`)}
        ${field(u ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور', '<input id="uPass" type="password" class="field" />')}
        <div><label class="label">الصلاحيات</label><div class="grid grid-cols-2 gap-1.5 max-h-48 overflow-auto p-2 rounded-lg bg-slate-50">
          ${PERMISSIONS.map((p) => `<label class="flex items-center gap-2 text-sm"><input type="checkbox" data-perm="${p.key}" ${perms.includes(p.key) ? 'checked' : ''} class="accent-zain-600" /> ${esc(p.label)}</label>`).join('')}
        </div></div>`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="uSave" class="btn btn-primary">حفظ</button>`,
      onMount(wrap, close) {
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#uSave').addEventListener('click', async () => {
          const permissions = [...wrap.querySelectorAll('[data-perm]')].filter((x) => x.checked).map((x) => x.dataset.perm);
          const payload = {
            username: wrap.querySelector('#uName').value,
            full_name: wrap.querySelector('#uFull').value,
            phone: wrap.querySelector('#uPhone').value,
            role: wrap.querySelector('#uRole').value,
            permissions,
          };
          const pass = wrap.querySelector('#uPass').value;
          if (pass) payload.password = pass;
          try {
            if (u) await api('PUT', `/api/users/${u.id}`, payload);
            else await api('POST', '/api/users', payload);
            toast('تم الحفظ', 'success'); close(); renderAdmin(c);
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }
}

export async function openSettings() {
  const data = await api('GET', '/api/settings');
  const s = data.settings;
  const canEdit = hasPerm('settings.write') || hasPerm('*');

  modal({
    title: 'إعدادات النظام',
    size: 'max-w-2xl',
    body: `
      <div class="grid grid-cols-2 gap-4">
        <div class="col-span-2 font-black text-zain-700 border-b border-slate-100 pb-2">معلومات المؤسسة</div>
        ${field('اسم المؤسسة', `<input id="set_company_name" class="field" value="${esc(s.company_name)}" />`)}
        ${field('الهاتف', `<input id="set_company_phone" class="field" value="${esc(s.company_phone)}" />`)}
        ${field('العنوان', `<input id="set_company_address" class="field" value="${esc(s.company_address)}" />`)}
        ${field('الرقم الضريبي', `<input id="set_company_tax_id" class="field" value="${esc(s.company_tax_id)}" />`)}
        ${field('النشاط التجاري', `<select id="set_industry" class="field">${data.industries.map((i) => `<option value="${i.key}" ${i.key === s.industry ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}</select>`)}
        ${field('رمز العملة', `<input id="set_currency_symbol" class="field" value="${esc(s.currency_symbol)}" />`)}

        <div class="col-span-2 font-black text-zain-700 border-b border-slate-100 pb-2 mt-2">الطباعة</div>
        ${field('نوع الطابعة', `<select id="set_printer_type" class="field">
          <option value="thermal80" ${s.printer_type === 'thermal80' ? 'selected' : ''}>حرارية 80mm</option>
          <option value="thermal58" ${s.printer_type === 'thermal58' ? 'selected' : ''}>حرارية 58mm</option>
          <option value="a4" ${s.printer_type === 'a4' ? 'selected' : ''}>ورق A4</option>
        </select>`)}
        ${field('عرض الملصق (mm)', `<input id="set_label_width_mm" type="number" class="field" value="${esc(s.label_width_mm)}" />`)}
        <div class="col-span-2">${field('تذييل الفاتورة', `<input id="set_receipt_footer" class="field" value="${esc(s.receipt_footer)}" />`)}</div>

        <div class="col-span-2 font-black text-zain-700 border-b border-slate-100 pb-2 mt-2">المظهر</div>
        ${field('مظهر الواجهة', `<select id="set_theme" class="field">
          <option value="light" ${currentTheme() !== 'dark' ? 'selected' : ''}>فاتح</option>
          <option value="dark" ${currentTheme() === 'dark' ? 'selected' : ''}>داكن</option>
        </select>`)}

        <div class="col-span-2 font-black text-zain-700 border-b border-slate-100 pb-2 mt-2">المخزون ونقاط البيع</div>
        ${field('نمط البيع الافتراضي', `<select id="set_default_pos_mode" class="field">
          <option value="fast" ${s.default_pos_mode === 'fast' ? 'selected' : ''}>بيع سريع</option>
          <option value="retail" ${s.default_pos_mode === 'retail' ? 'selected' : ''}>تجزئة</option>
          <option value="wholesale" ${s.default_pos_mode === 'wholesale' ? 'selected' : ''}>جملة</option>
        </select>`)}
        ${field('ضريبة افتراضية %', `<input id="set_default_tax_rate" type="number" class="field" value="${esc(s.default_tax_rate)}" />`)}
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="set_negative_stock" class="accent-zain-600" ${s.negative_stock === '1' ? 'checked' : ''} /> السماح بالبيع بالسالب</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="set_shift_required" class="accent-zain-600" ${s.shift_required === '1' ? 'checked' : ''} /> إلزام فتح وردية للبيع</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="set_ai_enabled" class="accent-zain-600" ${s.ai_enabled === '1' ? 'checked' : ''} /> تشغيل محرك الذكاء الاصطناعي</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="set_low_stock_alert" class="accent-zain-600" ${s.low_stock_alert === '1' ? 'checked' : ''} /> تنبيهات المخزون المنخفض</label>
      </div>`,
    footer: canEdit ? `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="setSave" class="btn btn-primary"><i class="bi bi-check2-circle"></i> حفظ الإعدادات</button>` : `<button data-close class="btn btn-ghost">إغلاق</button>`,
    onMount(wrap, close) {
      const cancel = wrap.querySelector('[data-cancel]');
      if (cancel) cancel.addEventListener('click', close);
      const themeSel = wrap.querySelector('#set_theme');
      if (themeSel) themeSel.addEventListener('change', () => applyTheme(themeSel.value));
      const save = wrap.querySelector('#setSave');
      if (!save) return;
      save.addEventListener('click', async () => {
        const payload = {
          company_name: wrap.querySelector('#set_company_name').value,
          company_phone: wrap.querySelector('#set_company_phone').value,
          company_address: wrap.querySelector('#set_company_address').value,
          company_tax_id: wrap.querySelector('#set_company_tax_id').value,
          industry: wrap.querySelector('#set_industry').value,
          currency_symbol: wrap.querySelector('#set_currency_symbol').value,
          theme: wrap.querySelector('#set_theme').value,
          printer_type: wrap.querySelector('#set_printer_type').value,
          label_width_mm: wrap.querySelector('#set_label_width_mm').value,
          receipt_footer: wrap.querySelector('#set_receipt_footer').value,
          default_pos_mode: wrap.querySelector('#set_default_pos_mode').value,
          default_tax_rate: wrap.querySelector('#set_default_tax_rate').value,
          negative_stock: wrap.querySelector('#set_negative_stock').checked ? 1 : 0,
          shift_required: wrap.querySelector('#set_shift_required').checked ? 1 : 0,
          ai_enabled: wrap.querySelector('#set_ai_enabled').checked ? 1 : 0,
          low_stock_alert: wrap.querySelector('#set_low_stock_alert').checked ? 1 : 0,
        };
        try {
          const res = await api('PUT', '/api/settings', payload);
          state.settings = res.settings;
          toast('تم حفظ الإعدادات', 'success');
          close();
          location.reload();
        } catch (e) { toast(e.message, 'error'); }
      });
    },
  });
}
