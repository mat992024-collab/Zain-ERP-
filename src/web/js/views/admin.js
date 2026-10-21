import { api, state, esc, toast, modal, confirmBox, field, emptyState, hasPerm, applyTheme, currentTheme, downloadFile, readFileBase64 } from '../core.js';

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
  { key: 'backup.manage', label: 'النسخ الاحتياطي والاستعادة' },
];

const ROLE_LABELS = { admin: 'مدير النظام', manager: 'مدير', accountant: 'محاسب', cashier: 'كاشير', warehouse: 'أمين مخزن' };

export async function renderAdmin(c) {
  const data = await api('GET', '/api/users');
  const canManage = hasPerm('admin.users');
  const canBackup = hasPerm('backup.manage');
  const canSettings = hasPerm('settings.write');
  const backup = canBackup ? await api('GET', '/api/backup').catch(() => ({ backups: [], db_size: 0 })) : { backups: [], db_size: 0 };
  const currencyData = canSettings ? await api('GET', '/api/currencies').catch(() => ({ rows: [], base: null })) : { rows: [], base: null };

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
    ${canSettings ? currencyCard(currencyData) : ''}
    <div class="card p-4">
      <div class="font-black mb-2"><i class="bi bi-info-circle text-zain-600"></i> ملاحظة</div>
      <p class="text-sm text-slate-500">دور "مدير النظام" يمتلك جميع الصلاحيات تلقائياً. للأدوار الأخرى حدّد الصلاحيات المطلوبة من نموذج التعديل.</p>
    </div>
    ${canBackup ? backupCard(backup) : ''}`;

  const curAdd = c.querySelector('#curAdd');
  if (curAdd) curAdd.addEventListener('click', () => currencyForm(null, currencyData));
  c.querySelectorAll('[data-cur-edit]').forEach((b) => b.addEventListener('click', () => currencyForm(currencyData.rows.find((x) => x.code === b.dataset.curEdit), currencyData)));
  c.querySelectorAll('[data-cur-del]').forEach((b) => b.addEventListener('click', async () => {
    const code = b.dataset.curDel;
    if (!(await confirmBox(`حذف العملة ${code}؟`))) return;
    try { await api('DELETE', `/api/currencies/${encodeURIComponent(code)}`); toast('تم الحذف', 'success'); renderAdmin(c); }
    catch (e) { toast(e.message, 'error'); }
  }));

  const addBtn = c.querySelector('#uAdd');
  if (addBtn) addBtn.addEventListener('click', () => userForm(null));
  c.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => userForm(data.rows.find((x) => x.id === +b.dataset.edit))));
  c.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const u = data.rows.find((x) => x.id === +b.dataset.toggle);
    if (!(await confirmBox(`${u.is_active ? 'تعطيل' : 'تفعيل'} المستخدم ${u.full_name}؟`))) return;
    try { await api('PATCH', `/api/users/${u.id}/status`, { is_active: u.is_active ? 0 : 1 }); toast('تم', 'success'); renderAdmin(c); } catch (e) { toast(e.message, 'error'); }
  }));

  const bkCreate = c.querySelector('#bkCreate');
  if (bkCreate) bkCreate.addEventListener('click', async () => {
    bkCreate.disabled = true;
    try { await api('POST', '/api/backup'); toast('تم إنشاء النسخة الاحتياطية', 'success'); await renderAdmin(c); }
    catch (e) { toast(e.message, 'error'); bkCreate.disabled = false; }
  });
  c.querySelectorAll('[data-bk-dl]').forEach((b) => b.addEventListener('click', async () => {
    try { await downloadFile(`/api/backup/${encodeURIComponent(b.dataset.bkDl)}/download`, b.dataset.bkDl); }
    catch (e) { toast(e.message, 'error'); }
  }));
  c.querySelectorAll('[data-bk-restore]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('سيتم استبدال جميع البيانات الحالية بمحتوى النسخة الاحتياطية. هل أنت متأكد؟'))) return;
    try {
      await api('POST', `/api/backup/${encodeURIComponent(b.dataset.bkRestore)}/restore`);
      toast('تمت الاستعادة بنجاح', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (e) { toast(e.message, 'error'); }
  }));
  c.querySelectorAll('[data-bk-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('حذف هذه النسخة الاحتياطية؟'))) return;
    try { await api('DELETE', `/api/backup/${encodeURIComponent(b.dataset.bkDel)}`); toast('تم الحذف', 'success'); await renderAdmin(c); }
    catch (e) { toast(e.message, 'error'); }
  }));
  const bkAutoSave = c.querySelector('#bkAutoSave');
  if (bkAutoSave) bkAutoSave.addEventListener('click', async () => {
    bkAutoSave.disabled = true;
    try {
      await api('PUT', '/api/backup/auto', {
        enabled: c.querySelector('#bkAutoEnabled').checked ? 1 : 0,
        time: c.querySelector('#bkAutoTime').value,
        keep: Number(c.querySelector('#bkAutoKeep').value),
      });
      toast('تم حفظ إعدادات النسخ التلقائي', 'success');
      await renderAdmin(c);
    } catch (e) { toast(e.message, 'error'); bkAutoSave.disabled = false; }
  });
  const bkAutoRun = c.querySelector('#bkAutoRun');
  if (bkAutoRun) bkAutoRun.addEventListener('click', async () => {
    bkAutoRun.disabled = true;
    try {
      await api('POST', '/api/backup/auto/run');
      toast('تم إنشاء نسخة احتياطية تلقائية', 'success');
      await renderAdmin(c);
    } catch (e) { toast(e.message, 'error'); bkAutoRun.disabled = false; }
  });

  const uploadInput = c.querySelector('#bkUpload');
  if (uploadInput) uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files && uploadInput.files[0];
    if (!file) return;
    if (!(await confirmBox('سيتم استبدال جميع البيانات الحالية بمحتوى الملف. هل أنت متأكد؟'))) { uploadInput.value = ''; return; }
    try {
      const data = await readFileBase64(file);
      await api('POST', '/api/backup/upload/restore', { data });
      toast('تمت الاستعادة بنجاح', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (e) { toast(e.message, 'error'); }
    uploadInput.value = '';
  });

  function currencyCard(data) {
    const rows = data.rows || [];
    const base = data.base || rows.find((r) => r.is_base) || null;
    return `
      <div class="card mt-4" id="currencyCard">
        <div class="p-4 flex justify-between items-center border-b border-slate-100">
          <div class="font-black flex items-center gap-2"><i class="bi bi-currency-exchange text-zain-600"></i> العملات وأسعار الصرف</div>
          <button id="curAdd" class="btn btn-primary"><i class="bi bi-plus-lg"></i> عملة جديدة</button>
        </div>
        <div class="p-4">
          <p class="text-xs text-slate-500 mb-3">الحسابات والتقارير تحتفظ دائماً بالمبالغ بالعملة الأساسية، وتُسجَّل الفواتير والمصروفات والسندات مع عملتها الأصلية وسعر صرفها. العملة الأساسية الحالية: <span class="font-bold text-zain-700">${esc(base ? base.code : '-')}</span></p>
          <div class="overflow-auto max-h-64"><table class="w-full">
            <thead><tr><th class="th">الرمز</th><th class="th">الاسم</th><th class="th">الرمز المختصر</th><th class="th">سعر الصرف (1 وحدة = ؟ بالأساسية)</th><th class="th">الخانات</th><th class="th">الحالة</th><th class="th"></th></tr></thead>
            <tbody>${rows.map((x) => `<tr class="tr">
              <td class="td font-mono text-xs font-bold">${esc(x.code)}</td>
              <td class="td font-bold">${esc(x.name)}</td>
              <td class="td">${esc(x.symbol || '-')}</td>
              <td class="td font-mono">${x.is_base ? '1' : x.rate}</td>
              <td class="td text-xs">${x.decimals}</td>
              <td class="td">${x.is_base ? '<span class="badge badge-info">أساسية</span>' : x.is_active ? '<span class="badge badge-ok">مفعلة</span>' : '<span class="badge badge-mute">معطلة</span>'}</td>
              <td class="td"><div class="flex gap-1">
                <button data-cur-edit="${esc(x.code)}" class="btn btn-ghost btn-sm"><i class="bi bi-pencil"></i></button>
                ${x.is_base ? '' : `<button data-cur-del="${esc(x.code)}" class="btn btn-ghost btn-sm text-rose-500"><i class="bi bi-trash3"></i></button>`}
              </div></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`;
  }

  async function currencyForm(row, data) {
    const cur = row || { code: '', name: '', symbol: '', rate: 1, decimals: 0, is_active: 1 };
    const isNew = !row;
    modal({
      title: isNew ? 'إضافة عملة' : `تعديل العملة ${row.code}`,
      size: 'max-w-md',
      body: `
        ${field('رمز العملة', `<input id="curCode" class="field font-mono" maxlength="5" value="${esc(cur.code)}" ${isNew ? '' : 'readonly'} />`)}
        ${field('الاسم', `<input id="curName" class="field" value="${esc(cur.name)}" />`)}
        ${field('الرمز المختصر', `<input id="curSymbol" class="field" value="${esc(cur.symbol || '')}" />`)}
        ${field('سعر الصرف (1 وحدة = ؟ من العملة الأساسية)', `<input id="curRate" type="number" step="0.0001" class="field" value="${esc(String(cur.rate))}" ${isNew ? '' : ''} />`)}
        ${field('عدد الخانات العشرية', `<input id="curDecimals" type="number" min="0" max="4" class="field" value="${esc(String(cur.decimals || 0))}" />`)}
        ${isNew ? '' : `<label class="flex items-center gap-2 text-sm"><input type="checkbox" id="curActive" class="accent-zain-600" ${cur.is_active ? 'checked' : ''} /> العملة مفعلة</label>`}`,
      footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="curSave" class="btn btn-primary">حفظ</button>`,
      onMount(wrap, close) {
        wrap.querySelector('[data-cancel]').addEventListener('click', close);
        wrap.querySelector('#curSave').addEventListener('click', async () => {
          const payload = {
            name: wrap.querySelector('#curName').value,
            symbol: wrap.querySelector('#curSymbol').value,
            rate: Number(wrap.querySelector('#curRate').value),
            decimals: Number(wrap.querySelector('#curDecimals').value),
          };
          if (isNew) payload.code = wrap.querySelector('#curCode').value;
          else payload.is_active = wrap.querySelector('#curActive') ? (wrap.querySelector('#curActive').checked ? 1 : 0) : 1;
          try {
            if (isNew) await api('POST', '/api/currencies', payload);
            else await api('PUT', `/api/currencies/${encodeURIComponent(row.code)}`, payload);
            toast('تم الحفظ', 'success');
            close();
            renderAdmin(c);
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }

  function backupCard(res) {
    const rows = res.backups || [];
    const auto = res.auto || { enabled: false, time: '02:00', keep: 7, last: '', next: '' };
    return `
      <div class="card mt-4" id="backupCard">
        <div class="p-4 flex justify-between items-center border-b border-slate-100">
          <div class="font-black flex items-center gap-2"><i class="bi bi-database-check text-zain-600"></i> النسخ الاحتياطي والاستعادة</div>
          <div class="flex gap-2">
            <label class="btn btn-ghost cursor-pointer"><i class="bi bi-upload"></i> استعادة من ملف<input type="file" id="bkUpload" accept=".db,application/octet-stream" class="hidden" /></label>
            <button id="bkCreate" class="btn btn-primary"><i class="bi bi-download"></i> نسخة احتياطية الآن</button>
          </div>
        </div>
        <div class="p-4 border-b border-slate-100 bg-slate-50">
          <div class="flex flex-wrap items-center gap-3">
            <div class="font-black text-sm"><i class="bi bi-clock-history text-zain-600"></i> النسخ التلقائي اليومي</div>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" id="bkAutoEnabled" ${auto.enabled ? 'checked' : ''} class="w-4 h-4 accent-zain-600" /> تفعيل</label>
            <div class="flex items-center gap-2 text-sm"><span class="text-slate-500">الساعة</span><input type="time" id="bkAutoTime" class="field !w-28" value="${esc(auto.time || '02:00')}" /></div>
            <div class="flex items-center gap-2 text-sm"><span class="text-slate-500">عدد النسخ المحفوظة</span><input type="number" id="bkAutoKeep" min="1" max="90" class="field !w-20" value="${esc(String(auto.keep || 7))}" /></div>
            <button id="bkAutoSave" class="btn btn-ghost btn-sm"><i class="bi bi-check2"></i> حفظ</button>
            <button id="bkAutoRun" class="btn btn-ghost btn-sm"><i class="bi bi-play-fill"></i> تشغيل الآن</button>
            <div class="text-xs text-slate-500 w-full">آخر نسخة تلقائية: <span class="font-bold">${esc(auto.last || 'لا يوجد')}</span> — النسخة القادمة: <span class="font-bold">${auto.next ? esc(new Date(auto.next).toLocaleString('ar-IQ')) : '-'}</span></div>
          </div>
        </div>
        <div class="p-4">
          <p class="text-xs text-slate-500 mb-3">تُحفظ النسخ داخل مجلد <span class="font-mono">data/backups</span> على هذا الجهاز. حجم القاعدة الحالية: ${(res.db_size / 1024).toFixed(0)} كيلوبايت.</p>
          ${rows.length ? `<div class="overflow-auto max-h-64"><table class="w-full">
            <thead><tr><th class="th">الملف</th><th class="th">النوع</th><th class="th">التاريخ</th><th class="th">الحجم</th><th class="th"></th></tr></thead>
            <tbody>${rows.map((b) => `<tr class="tr">
              <td class="td font-mono text-xs">${esc(b.name)}</td>
              <td class="td">${b.name.startsWith('zain-auto-') ? '<span class="badge badge-info">تلقائي</span>' : '<span class="badge badge-mute">يدوي</span>'}</td>
              <td class="td text-xs">${esc(new Date(b.created_at).toLocaleString('ar-IQ'))}</td>
              <td class="td text-xs">${(b.size / 1024).toFixed(0)} KB</td>
              <td class="td"><div class="flex gap-1">
                <button data-bk-dl="${esc(b.name)}" class="btn btn-ghost btn-sm" title="تنزيل"><i class="bi bi-download"></i></button>
                <button data-bk-restore="${esc(b.name)}" class="btn btn-ghost btn-sm" title="استعادة"><i class="bi bi-arrow-counterclockwise text-amber-600"></i></button>
                <button data-bk-del="${esc(b.name)}" class="btn btn-ghost btn-sm" title="حذف"><i class="bi bi-trash text-rose-600"></i></button>
              </div></td>
            </tr>`).join('')}</tbody>
          </table></div>` : emptyState('bi-database', 'لا توجد نسخ احتياطية بعد', 'أنشئ أول نسخة احتياطية الآن')}
        </div>
      </div>`;
  }

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

        <div class="col-span-2 font-black text-zain-700 border-b border-slate-100 pb-2 mt-2">قالب الطباعة</div>
        ${field('سطر الترويسة', `<input id="set_print_header_text" class="field" value="${esc(s.print_header_text || '')}" placeholder="مثال: فرع الكرادة" />`)}
        ${field('سطر فرعي', `<input id="set_print_header_sub" class="field" value="${esc(s.print_header_sub || '')}" placeholder="مثال: الدوام 8 صباحاً - 10 مساءً" />`)}
        ${field('تذييل إضافي', `<input id="set_print_footer_note" class="field" value="${esc(s.print_footer_note || '')}" placeholder="مثال: شكراً لزيارتكم" />`)}
        ${field('ملاحظة على فاتورة A4', `<input id="set_print_invoice_note" class="field" value="${esc(s.print_invoice_note || '')}" placeholder="مثال: البضاعة لا تُرد بعد 3 أيام" />`)}
        ${field('تذييل ملصق الباركود', `<input id="set_print_label_note" class="field" value="${esc(s.print_label_note || '')}" />`)}
        ${field('حجم الخط', `<select id="set_print_font_size" class="field">
          <option value="small" ${s.print_font_size === 'small' ? 'selected' : ''}>صغير</option>
          <option value="normal" ${s.print_font_size === 'normal' ? 'selected' : ''}>عادي</option>
          <option value="large" ${s.print_font_size === 'large' ? 'selected' : ''}>كبير</option>
        </select>`)}
        ${field('كثافة السطور', `<select id="set_print_density" class="field">
          <option value="compact" ${s.print_density === 'compact' ? 'selected' : ''}>مضغوط</option>
          <option value="normal" ${s.print_density === 'normal' ? 'selected' : ''}>عادي</option>
          <option value="relaxed" ${s.print_density === 'relaxed' ? 'selected' : ''}>موسّع</option>
        </select>`)}
        <div class="col-span-2 flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="set_print_show_logo" class="accent-zain-600" ${s.print_show_logo === '1' ? 'checked' : ''} /> إظهار الشعار</label>
          <label class="btn btn-ghost btn-sm cursor-pointer"><i class="bi bi-image"></i> رفع شعار<input type="file" id="set_print_logo_file" accept="image/*" class="hidden" /></label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="set_print_show_tax_id" class="accent-zain-600" ${s.print_show_tax_id === '1' ? 'checked' : ''} /> إظهار الرقم الضريبي</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="set_print_show_cashier" class="accent-zain-600" ${s.print_show_cashier === '1' ? 'checked' : ''} /> إظهار اسم الكاشير</label>
        </div>
        <div class="col-span-2 flex items-center gap-3">
          <div id="logoPreview" class="w-24 h-16 border border-slate-200 rounded-lg flex items-center justify-center bg-slate-50 overflow-hidden">
            ${s.print_logo_data ? `<img src="${esc(s.print_logo_data)}" class="max-h-full max-w-full" />` : '<span class="text-[11px] text-slate-400">لا شعار</span>'}
          </div>
          <button type="button" id="set_print_preview" class="btn btn-ghost btn-sm"><i class="bi bi-eye"></i> معاينة القالب</button>
          <button type="button" id="set_print_clear_logo" class="btn btn-ghost btn-sm text-rose-500"><i class="bi bi-trash3"></i> إزالة الشعار</button>
        </div>

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
        ${field('تطبيق حد ائتمان العميل', `<select id="set_credit_limit_mode" class="field">
          <option value="warn" ${s.credit_limit_mode === 'warn' ? 'selected' : ''}>تحذير مع إمكانية تجاوز المدير</option>
          <option value="block" ${s.credit_limit_mode === 'block' ? 'selected' : ''}>منع البيع عند تجاوز الحد</option>
          <option value="off" ${s.credit_limit_mode === 'off' ? 'selected' : ''}>بدون تطبيق</option>
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
      let logoData = s.print_logo_data || '';
      const logoPreview = wrap.querySelector('#logoPreview');
      const logoFile = wrap.querySelector('#set_print_logo_file');
      const clearLogo = wrap.querySelector('#set_print_clear_logo');
      const previewBtn = wrap.querySelector('#set_print_preview');
      if (logoFile) logoFile.addEventListener('change', async () => {
        const f = logoFile.files && logoFile.files[0];
        if (!f) return;
        if (f.size > 300000) { toast('حجم الشعار كبير (الحد 300 كيلوبايت)', 'error'); return; }
        const raw = await readFileBase64(f);
        logoData = `data:${f.type || 'image/png'};base64,${raw}`;
        logoPreview.innerHTML = `<img src="${logoData}" class="max-h-full max-w-full" />`;
        toast('تم تحميل الشعار، احفظ الإعدادات لتطبيقه', 'success');
      });
      if (clearLogo) clearLogo.addEventListener('click', () => {
        logoData = '';
        logoPreview.innerHTML = '<span class="text-[11px] text-slate-400">لا شعار</span>';
      });
      if (previewBtn) previewBtn.addEventListener('click', () => {
        const head = [];
        if (logoData) head.push(`<div><img src="${logoData}" style="max-height:40px;max-width:90px;object-fit:contain;display:block;margin:0 auto 4px" /></div>`);
        head.push(`<h2 style="margin:4px 0;font-size:13px">${esc(s.company_name || 'Zain')}</h2>`);
        head.push(`<div style="font-size:10px;color:#475569">${esc(s.company_address || '')}</div>`);
        if (wrap.querySelector('#set_print_header_text').value) head.push(`<div style="font-weight:bold;font-size:12px">${esc(wrap.querySelector('#set_print_header_text').value)}</div>`);
        if (wrap.querySelector('#set_print_header_sub').value) head.push(`<div style="font-size:10px;color:#475569">${esc(wrap.querySelector('#set_print_header_sub').value)}</div>`);
        const foot = [];
        if (s.receipt_footer) foot.push(`<div style="font-size:10px">${esc(s.receipt_footer)}</div>`);
        if (wrap.querySelector('#set_print_footer_note').value) foot.push(`<div style="font-weight:bold">${esc(wrap.querySelector('#set_print_footer_note').value)}</div>`);
        if (wrap.querySelector('#set_print_invoice_note').value) foot.push(`<div style="font-size:10px">${esc(wrap.querySelector('#set_print_invoice_note').value)}</div>`);
        modal({
          title: 'معاينة قالب الطباعة',
          size: 'max-w-sm',
          body: `<div style="text-align:center;border:1px dashed #cbd5e1;border-radius:10px;padding:12px;background:#fff">
            ${head.join('')}
            <div style="border-top:1px dashed #000;margin:6px 0"></div>
            <div style="font-size:11px">${foot.join('')}</div>
          </div>`,
          footer: `<button data-close class="btn btn-ghost">إغلاق</button>`,
        });
      });
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
          print_header_text: wrap.querySelector('#set_print_header_text').value,
          print_header_sub: wrap.querySelector('#set_print_header_sub').value,
          print_footer_note: wrap.querySelector('#set_print_footer_note').value,
          print_invoice_note: wrap.querySelector('#set_print_invoice_note').value,
          print_label_note: wrap.querySelector('#set_print_label_note').value,
          print_font_size: wrap.querySelector('#set_print_font_size').value,
          print_density: wrap.querySelector('#set_print_density').value,
          print_show_logo: wrap.querySelector('#set_print_show_logo').checked ? 1 : 0,
          print_logo_data: logoData,
          print_show_tax_id: wrap.querySelector('#set_print_show_tax_id').checked ? 1 : 0,
          print_show_cashier: wrap.querySelector('#set_print_show_cashier').checked ? 1 : 0,
          default_pos_mode: wrap.querySelector('#set_default_pos_mode').value,
          credit_limit_mode: wrap.querySelector('#set_credit_limit_mode').value,
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
