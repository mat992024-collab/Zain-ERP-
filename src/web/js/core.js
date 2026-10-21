export const state = {
  user: null,
  token: localStorage.getItem('zain_token'),
  settings: {},
  modules: [],
  shift: null,
  cart: [],
  cartMeta: {},
};

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  let data;
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  else if (ct.includes('text/html') || ct.includes('text/plain')) data = await res.text();
  else data = await res.text().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `خطأ ${res.status}`);
    err.status = res.status;
    err.code = data && data.code;
    err.details = data && data.details;
    throw err;
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

export function hasPerm(perm) {
  if (!state.user) return false;
  if (state.user.role === 'admin') return true;
  const perms = state.user.permissions || [];
  if (perms.includes('*')) return true;
  if (perms.includes(perm)) return true;
  const [m] = String(perm).split('.');
  return perms.includes(`${m}.*`);
}

export const money = (v, cur) => `${Number(v || 0).toLocaleString('ar-IQ')} ${cur === undefined ? (state.settings.currency_symbol || 'د.ع') : cur}`;
export const num = (v) => Number(v || 0).toLocaleString('ar-IQ');
export const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const today = () => new Date().toLocaleDateString('en-CA');

export function toast(msg, type = 'info') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  const border = type === 'success' ? 'border-emerald-500' : type === 'error' ? 'border-rose-500' : 'border-zain-500';
  const icon = type === 'success' ? 'bi-check-circle' : type === 'error' ? 'bi-x-circle' : 'bi-info-circle';
  el.className = `card px-4 py-3 text-sm shadow-lg border-r-4 ${border}`;
  el.innerHTML = `<div class="flex items-center gap-2"><i class="bi ${icon}"></i><span>${esc(msg)}</span></div>`;
  root.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; }, 2300);
  setTimeout(() => el.remove(), 2600);
}

export function modal({ title, body, size = 'max-w-2xl', footer = '', onMount }) {
  const root = document.getElementById('modalRoot');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal-panel ${size}">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
        <h3 class="font-black text-lg text-slate-800">${esc(title)}</h3>
        <button data-close class="w-9 h-9 rounded-lg grid place-items-center hover:bg-slate-100 text-slate-500"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="p-5" data-body></div>
      ${footer ? `<div class="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">${footer}</div>` : ''}
    </div>`;
  wrap.querySelector('[data-body]').innerHTML = body;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  root.appendChild(wrap);
  const first = wrap.querySelector('input,select,textarea');
  if (first) setTimeout(() => first.focus(), 50);
  if (onMount) onMount(wrap, close);
  return { el: wrap, close };
}

export function confirmBox(message) {
  return new Promise((resolve) => {
    const m = modal({
      title: 'تأكيد',
      size: 'max-w-sm',
      body: `<p class="text-slate-600">${esc(message)}</p>`,
      footer: `<button data-close class="btn btn-ghost">إلغاء</button><button data-yes class="btn btn-danger">تأكيد</button>`,
      onMount(wrap, close) {
        wrap.querySelector('[data-yes]').addEventListener('click', () => { close(); resolve(true); });
        wrap.querySelector('[data-close]').addEventListener('click', () => resolve(false));
      },
    });
  });
}

export function field(label, inner, hint = '') {
  return `<div><label class="label">${esc(label)}</label>${inner}${hint ? `<p class="text-[11px] text-slate-400 mt-1">${esc(hint)}</p>` : ''}</div>`;
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = dark ? 'bi bi-sun' : 'bi bi-moon-stars';
  const btn = document.getElementById('themeBtn');
  if (btn) btn.title = dark ? 'الوضع الفاتح' : 'الوضع الداكن';
  try { localStorage.setItem('zain_theme', dark ? 'dark' : 'light'); } catch { }
  return dark ? 'dark' : 'light';
}

export async function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (!hasPerm('settings.write') && !hasPerm('*')) return next;
  try {
    const res = await api('PUT', '/api/settings', { theme: next });
    if (res && res.settings) state.settings = res.settings;
  } catch { }
  return next;
}

export function printUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(state.token)}`;
}

export function openPrint(path) {
  const w = window.open(printUrl(path), '_blank', 'width=900,height=750');
  if (w) w.focus();
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function emptyState(icon, title, sub = '') {
  return `<div class="text-center py-14 text-slate-400"><i class="bi ${icon} text-4xl"></i><div class="font-bold text-slate-600 mt-3">${esc(title)}</p>${sub ? `<div class="text-xs mt-1">${esc(sub)}</div>` : ''}</div>`;
}

export function formToObject(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked ? 1 : 0;
    else out[el.name] = el.value;
  });
  return out;
}

export async function downloadFile(path, filename) {
  const res = await fetch(path, { headers: state.token ? { Authorization: 'Bearer ' + state.token } : {} });
  if (!res.ok) {
    let msg = 'فشل التنزيل';
    try {
      const d = await res.json();
      msg = d.error || msg;
    } catch { }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return blob.size;
}

export function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

export async function copyText(text) {
  const value = String(text || '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.focus();
  area.select();
  let done = false;
  try { done = document.execCommand('copy'); } catch { }
  area.remove();
  return done;
}
