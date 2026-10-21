import { api, esc, num, toast, modal, confirmBox, field, emptyState, hasPerm } from '../core.js';

const KIND_LABELS = { expiry: 'صلاحيات', low_stock: 'نواقص مخزون', debts: 'ذمم', sales: 'مبيعات', custom: 'مخصص' };
const REPEAT_LABELS = { daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', once: 'مرة واحدة' };
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function sectionCard(sec, color) {
  return `
    <div class="card">
      <div class="p-4 border-b border-slate-100 font-black flex items-center justify-between">
        <span><i class="bi ${color.icon} ${color.text}"></i> ${esc(sec.title)}</span>
        <span class="badge ${color.badge}">${num(sec.items.length)}</span>
      </div>
      <ul class="p-3 space-y-1.5 text-sm max-h-64 overflow-auto">
        ${sec.items.map((it) => `<li class="flex items-start gap-2"><i class="bi bi-dot text-lg leading-none text-slate-300"></i><span>${esc(it)}</span></li>`).join('')}
      </ul>
    </div>`;
}

export async function renderReminders(c) {
  const canWrite = hasPerm('reminders.write');
  const data = await api('GET', '/api/reminders/daily');
  const settings = await api('GET', '/api/settings');
  const s = settings.settings || {};
  const colors = {
    expiry: { icon: 'bi-hourglass-split', text: 'text-amber-500', badge: 'badge-warn' },
    low_stock: { icon: 'bi-box-seam', text: 'text-rose-500', badge: 'badge-danger' },
    debts: { icon: 'bi-cash-coin', text: 'text-zain-600', badge: 'badge-info' },
    sales: { icon: 'bi-graph-up', text: 'text-emerald-500', badge: 'badge-ok' },
  };

  c.innerHTML = `
    <div class="kpi-row">
      ${['expiry', 'low_stock', 'debts', 'sales'].map((k) => {
        const meta = { expiry: { label: 'صلاحيات قاربت الانتهاء', icon: 'bi-hourglass-split', cls: 'bg-amber-100 text-amber-700' }, low_stock: { label: 'أصناف على وشك النفاد', icon: 'bi-box-seam', cls: 'bg-rose-100 text-rose-700' }, debts: { label: 'ذمم وتحصيلات', icon: 'bi-cash-coin', cls: 'bg-zain-100 text-zain-700' }, sales: { label: 'تنبيهات مبيعات', icon: 'bi-graph-up', cls: 'bg-emerald-100 text-emerald-700' } }[k];
        return `<div class="kpi"><div class="kpi-icon ${meta.cls}"><i class="bi ${meta.icon}"></i></div><div><div class="kpi-value">${num(data.counts[k] || 0)}</div><div class="kpi-label">${meta.label}</div></div></div>`;
      }).join('')}
    </div>

    <div class="grid grid-cols-12 gap-4">
      <div class="col-span-7 card">
        <div class="p-4 border-b border-slate-100 font-black flex items-center justify-between">
          <span><i class="bi bi-megaphone text-zain-600"></i> نص تذكير اليوم</span>
          <div class="flex gap-2">
            <button id="rmCopy" class="btn btn-primary btn-sm"><i class="bi bi-clipboard"></i> نسخ النص</button>
            <button id="rmRefresh" class="btn btn-ghost btn-sm"><i class="bi bi-arrow-clockwise"></i> تحديث</button>
          </div>
        </div>
        <div class="p-4">
          <pre id="rmText" class="whitespace-pre-wrap font-sans text-sm bg-slate-50 border border-slate-100 rounded-lg p-3 leading-7">${esc(data.text)}</pre>
          ${data.last_digest ? `<p class="text-xs text-slate-400 mt-2"><i class="bi bi-clock"></i> آخر نص مولّد تلقائياً: ${esc(data.last_digest_at || '')}</p>` : ''}
        </div>
      </div>

      <div class="col-span-5 space-y-4">
        <div class="card">
          <div class="p-4 border-b border-slate-100 font-black"><i class="bi bi-sliders text-zain-600"></i> إعدادات التذكير</div>
          <div class="p-4 grid grid-cols-2 gap-3">
            ${field('أيام قبل الصلاحية', `<input id="rmDays" type="number" min="1" max="365" class="field" value="${esc(s.reminder_expiry_days || '30')}" />`)}
            ${field('وقت التذكير اليومي', `<input id="rmTime" type="time" class="field" value="${esc(s.reminder_daily_time || '08:00')}" />`)}
            <div class="col-span-2 space-y-2">
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="rmExpiry" class="accent-zain-600" ${s.reminder_expiry === '0' ? '' : 'checked'} /> تنبيه الصلاحيات</label>
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="rmLow" class="accent-zain-600" ${s.reminder_low_stock === '0' ? '' : 'checked'} /> تنبيه نواقص المخزون</label>
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="rmDebts" class="accent-zain-600" ${s.reminder_debts === '0' ? '' : 'checked'} /> تنبيه الذمم</label>
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="rmSales" class="accent-zain-600" ${s.reminder_sales_summary === '0' ? '' : 'checked'} /> ملخص مبيعات الأمس</label>
            </div>
            <div class="col-span-2">${field('توقيع التذكير', `<input id="rmSignature" class="field" value="${esc(s.reminder_signature || '')}" placeholder="مثال: إدارة المحل" />`)}</div>
            <div class="col-span-2"><button id="rmSave" class="btn btn-primary w-full"><i class="bi bi-check2-circle"></i> حفظ الإعدادات</button></div>
          </div>
        </div>

        <div class="card">
          <div class="p-4 border-b border-slate-100 font-black flex items-center justify-between">
            <span><i class="bi bi-bell text-zain-600"></i> تذكيرات مخصصة</span>
            ${canWrite ? '<button id="rmAdd" class="btn btn-primary btn-sm"><i class="bi bi-plus-lg"></i> إضافة</button>' : ''}
          </div>
          <div class="overflow-auto max-h-72">
            ${data.custom.length ? `<table class="w-full">
              <thead><tr><th class="th">العنوان</th><th class="th">التكرار</th><th class="th">الموعد</th><th class="th"></th></tr></thead>
              <tbody>${data.custom.map((r) => `<tr class="tr">
                <td class="td font-bold">${esc(r.title)}<div class="text-xs text-slate-400">${esc(KIND_LABELS[r.kind] || r.kind)}</div></td>
                <td class="td text-xs">${esc(REPEAT_LABELS[r.repeat_type] || r.repeat_type)}</td>
                <td class="td text-xs">${esc(r.next_run || '—')}</td>
                <td class="td"><div class="flex gap-1">
                  ${canWrite ? `<button data-rm-edit="${r.id}" class="btn btn-ghost btn-sm" title="تعديل"><i class="bi bi-pencil"></i></button>
                  <button data-rm-run="${r.id}" class="btn btn-ghost btn-sm" title="تشغيل"><i class="bi bi-play-fill"></i></button>
                  <button data-rm-del="${r.id}" class="btn btn-ghost btn-sm" title="حذف"><i class="bi bi-trash text-rose-600"></i></button>` : ''}
                </div></td>
              </tr>`).join('')}</tbody>
            </table>` : emptyState('bi-bell', 'لا توجد تذكيرات مخصصة', 'أضف تذكيراً متكرراً مثل صيانة الطابعة')}
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-4 mt-4">
      ${data.sections.map((sec) => `<div class="col-span-6">${sectionCard(sec, colors[sec.key] || colors.sales)}</div>`).join('')}
    </div>`;

  const copyBtn = c.querySelector('#rmCopy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const text = c.querySelector('#rmText').textContent;
    try {
      await navigator.clipboard.writeText(text);
      toast('تم نسخ النص', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('تم نسخ النص', 'success');
    }
  });
  const refreshBtn = c.querySelector('#rmRefresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => renderReminders(c));

  const saveBtn = c.querySelector('#rmSave');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      await api('PUT', '/api/settings', {
        reminder_expiry_days: c.querySelector('#rmDays').value,
        reminder_daily_time: c.querySelector('#rmTime').value,
        reminder_expiry: c.querySelector('#rmExpiry').checked ? 1 : 0,
        reminder_low_stock: c.querySelector('#rmLow').checked ? 1 : 0,
        reminder_debts: c.querySelector('#rmDebts').checked ? 1 : 0,
        reminder_sales_summary: c.querySelector('#rmSales').checked ? 1 : 0,
        reminder_signature: c.querySelector('#rmSignature').value,
      });
      toast('تم حفظ إعدادات التذكير', 'success');
      await renderReminders(c);
    } catch (e) { toast(e.message, 'error'); saveBtn.disabled = false; }
  });

  const addBtn = c.querySelector('#rmAdd');
  if (addBtn) addBtn.addEventListener('click', () => reminderForm(null));

  c.querySelectorAll('[data-rm-edit]').forEach((el) => el.addEventListener('click', async () => {
    const id = el.dataset.rmEdit;
    const list = await api('GET', '/api/reminders');
    const row = list.rows.find((r) => String(r.id) === String(id));
    if (row) reminderForm(row);
  }));
  c.querySelectorAll('[data-rm-run]').forEach((el) => el.addEventListener('click', async () => {
    try {
      await api('POST', `/api/reminders/${el.dataset.rmRun}/run`);
      toast('تم تنفيذ التذكير', 'success');
      await renderReminders(c);
    } catch (e) { toast(e.message, 'error'); }
  }));
  c.querySelectorAll('[data-rm-del]').forEach((el) => el.addEventListener('click', async () => {
    if (!(await confirmBox('هل تريد حذف هذا التذكير؟'))) return;
    try {
      await api('DELETE', `/api/reminders/${el.dataset.rmDel}`);
      toast('تم حذف التذكير', 'success');
      await renderReminders(c);
    } catch (e) { toast(e.message, 'error'); }
  }));
}

function reminderForm(r) {
  const isEdit = !!r;
  const repeat = r ? r.repeat_type : 'daily';
  modal({
    title: isEdit ? `تعديل التذكير: ${r.title}` : 'تذكير جديد',
    size: 'max-w-lg',
    body: `
      <div class="grid grid-cols-2 gap-3">
        ${field('العنوان', `<input id="rfTitle" class="field" value="${esc(r ? r.title : '')}" />`)}
        ${field('النوع', `<select id="rfKind" class="field">
          ${Object.entries(KIND_LABELS).map(([k, v]) => `<option value="${k}" ${r && r.kind === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>`)}
        <div class="col-span-2">${field('النص', `<textarea id="rfBody" class="field" rows="3">${esc(r ? r.body : '')}</textarea>`)}</div>
        ${field('التكرار', `<select id="rfRepeat" class="field">
          ${Object.entries(REPEAT_LABELS).map(([k, v]) => `<option value="${k}" ${repeat === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>`)}
        ${field('الساعة', `<input id="rfTime" type="time" class="field" value="${esc(r ? r.time_of_day : '09:00')}" />`)}
        <div id="rfDayWrap" class="${repeat === 'weekly' ? '' : 'hidden'}">${field('يوم الأسبوع', `<select id="rfDay" class="field">${DAYS.map((d, i) => `<option value="${i}" ${r && Number(r.day_of_week) === i ? 'selected' : ''}>${d}</option>`).join('')}</select>`)}</div>
        <div id="rfMonthWrap" class="${repeat === 'monthly' ? '' : 'hidden'}">${field('يوم الشهر', `<input id="rfMonthDay" type="number" min="1" max="31" class="field" value="${esc(r ? String(r.day_of_month) : '1')}" />`)}</div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="rfActive" class="accent-zain-600" ${!r || r.active ? 'checked' : ''} /> مفعّل</label>
      </div>`,
    footer: `<button data-cancel class="btn btn-ghost">إلغاء</button><button id="rfSave" class="btn btn-primary">حفظ</button>`,
    onMount(wrap, close) {
      wrap.querySelector('[data-cancel]').addEventListener('click', close);
      const repeatSel = wrap.querySelector('#rfRepeat');
      repeatSel.addEventListener('change', () => {
        wrap.querySelector('#rfDayWrap').classList.toggle('hidden', repeatSel.value !== 'weekly');
        wrap.querySelector('#rfMonthWrap').classList.toggle('hidden', repeatSel.value !== 'monthly');
      });
      wrap.querySelector('#rfSave').addEventListener('click', async () => {
        const payload = {
          title: wrap.querySelector('#rfTitle').value,
          body: wrap.querySelector('#rfBody').value,
          kind: wrap.querySelector('#rfKind').value,
          repeat_type: repeatSel.value,
          time_of_day: wrap.querySelector('#rfTime').value,
          day_of_week: Number(wrap.querySelector('#rfDay').value),
          day_of_month: Number(wrap.querySelector('#rfMonthDay').value),
          active: wrap.querySelector('#rfActive').checked ? 1 : 0,
        };
        if (!payload.title.trim()) { toast('العنوان مطلوب', 'error'); return; }
        try {
          if (isEdit) await api('PUT', `/api/reminders/${r.id}`, payload);
          else await api('POST', '/api/reminders', payload);
          toast('تم حفظ التذكير', 'success');
          close();
          renderReminders(document.getElementById('content'));
        } catch (e) { toast(e.message, 'error'); }
      });
    },
  });
}
