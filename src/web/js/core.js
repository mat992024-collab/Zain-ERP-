export const state = {
  user: null,
  token: localStorage.getItem('zain_token'),
  settings: {},
  modules: [],
  shift: null,
  cart: [],
  cartMeta: {},
  pendingSearch: null,
};

export async function api(method, path, body) {
  if (path === undefined && typeof method === 'string' && (method.startsWith('/') || method.startsWith('http'))) {
    path = method;
    method = 'GET';
  } else if (typeof path === 'object' && path !== null && body === undefined && typeof method === 'string' && (method.startsWith('/') || method.startsWith('http'))) {
    const url = method;
    const opts = path;
    method = opts.method || 'GET';
    body = opts.body;
    path = url;
  }
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

export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function encode128(text) {
  const values = [];
  values.push(104);
  let checksum = 104;
  const chars = String(text);
  for (let i = 0; i < chars.length; i++) {
    const code = chars.charCodeAt(i);
    if (code < 32 || code > 126) continue;
    const v = code - 32;
    values.push(v);
    checksum += v * (i + 1);
  }
  values.push(checksum % 103);
  values.push(106);
  return values;
}

export function barcodeSvg(text, options = {}) {
  const str = String(text || '').trim();
  if (!/^[ -~]+$/.test(str) || !str) return '';
  const { height = 50, width = 220, moduleWidth = 1.6, showText = true, color = '#000000', bgColor = 'transparent' } = options;
  const values = encode128(str);
  let pattern = '';
  for (const v of values) pattern += CODE128_PATTERNS[v] || '';
  const bars = pattern.split('').map(Number);
  const totalModules = bars.reduce((a, b) => a + b, 0);
  const quiet = 10;
  const scale = width / (totalModules + quiet * 2);
  const barWidth = scale;
  const textHeight = showText ? 14 : 0;
  const svgHeight = height + textHeight;
  let x = quiet * scale;
  let rects = '';
  let isBar = true;
  for (const w of bars) {
    const wpx = w * barWidth;
    if (isBar) rects += `<rect x="${x.toFixed(2)}" y="0" width="${wpx.toFixed(2)}" height="${height}" fill="${color}"/>`;
    x += wpx;
    isBar = !isBar;
  }
  const label = showText
    ? `<text x="${width / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="12" fill="${color}">${esc(str)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}"><rect width="${width}" height="${svgHeight}" fill="${bgColor}"/>${rects}${label}</svg>`;
}

export function ean13Svg(text, options = {}) {
  const { width = 200, height = 50, showText = true, color = '#000000', bgColor = 'transparent' } = options;
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  const clean = String(text || '').replace(/\D/g, '');
  let first12 = clean.slice(0, 12).padStart(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += i % 2 === 0 ? Number(first12[i]) : Number(first12[i]) * 3;
  const cs = (10 - (sum % 10)) % 10;
  const ean = first12 + cs;

  const first = Number(ean[0]);
  const parity = P[first] || 'LLLLLL';

  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    const d = Number(ean[i]);
    bits += parity[i - 1] === 'L' ? L[d] : G[d];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) {
    const d = Number(ean[i]);
    bits += R[d];
  }
  bits += '101';

  const totalBits = bits.length;
  const quiet = 7;
  const modW = width / (totalBits + quiet * 2);
  const textH = showText ? 14 : 0;
  const svgH = height + textH;

  let x = quiet * modW;
  let rects = '';
  for (let i = 0; i < totalBits; i++) {
    if (bits[i] === '1') {
      const isGuard = i < 3 || (i >= 45 && i < 50) || i >= 92;
      const barH = isGuard && showText ? height + 4 : height;
      rects += `<rect x="${x.toFixed(2)}" y="0" width="${modW.toFixed(2)}" height="${barH}" fill="${color}"/>`;
    }
    x += modW;
  }

  const label = showText
    ? `<text x="${width / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="${color}">${ean.slice(0, 1)} ${ean.slice(1, 7)} ${ean.slice(7)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgH}" viewBox="0 0 ${width} ${svgH}"><rect width="${width}" height="${svgH}" fill="${bgColor}"/>${rects}${label}</svg>`;
}

export function qrSvg(text, options = {}) {
  const { size = 120, color = '#000000', bgColor = 'transparent', margin = 1 } = options;
  const PAD0 = 0xEC;
  const PAD1 = 0x11;
  const GF = new Uint8Array(512);
  const GFLOG = new Uint8Array(256);
  let v = 1;
  for (let i = 0; i < 255; i++) {
    GF[i] = v; GF[i + 255] = v; GFLOG[v] = i;
    v = (v << 1) ^ (v & 128 ? 0x11D : 0);
  }
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF[GFLOG[a] + GFLOG[b]]);

  const RS_BLOCKS = {
    1: [16, 10], 2: [28, 16], 3: [44, 26], 4: [64, 18],
  };

  const utf8 = new TextEncoder().encode(String(text || ''));
  const len = utf8.length;
  let ver = 1;
  for (let i = 1; i <= 4; i++) {
    if (len <= RS_BLOCKS[i][0] - 2) { ver = i; break; }
    if (i === 4) ver = 4;
  }
  const totalData = RS_BLOCKS[ver][0];
  const ecCount = RS_BLOCKS[ver][1];

  const bits = [];
  const putBits = (num, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((num >>> i) & 1);
  };
  putBits(4, 4);
  putBits(len, 8);
  for (let i = 0; i < len; i++) putBits(utf8[i], 8);
  putBits(0, Math.min(4, totalData * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  let padToggle = false;
  while (data.length < totalData) {
    data.push(padToggle ? PAD1 : PAD0);
    padToggle = !padToggle;
  }

  let gen = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(gen.length + 1).fill(0);
    const factor = GF[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gfMul(gen[j], factor);
      next[j + 1] ^= gen[j];
    }
    gen = next;
  }

  const msg = [...data, ...new Array(ecCount).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  const finalCodewords = [...data, ...msg.slice(data.length)];

  const sz = 17 + 4 * ver;
  const matrix = Array.from({ length: sz }, () => new Array(sz).fill(null));
  const isFunc = Array.from({ length: sz }, () => new Array(sz).fill(false));

  const setFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < sz && nc >= 0 && nc < sz) {
          isFunc[nr][nc] = true;
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            matrix[nr][nc] = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? 1 : 0;
          } else {
            matrix[nr][nc] = 0;
          }
        }
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, sz - 7);
  setFinder(sz - 7, 0);

  for (let i = 8; i < sz - 8; i++) {
    if (!isFunc[6][i]) { matrix[6][i] = i % 2 === 0 ? 1 : 0; isFunc[6][i] = true; }
    if (!isFunc[i][6]) { matrix[i][6] = i % 2 === 0 ? 1 : 0; isFunc[i][6] = true; }
  }

  if (ver >= 2) {
    const pos = ver === 2 ? 18 : ver === 3 ? 22 : 26;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const nr = pos + r;
        const nc = pos + c;
        if (isFunc[nr][nc]) continue;
        isFunc[nr][nc] = true;
        matrix[nr][nc] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
      }
    }
  }

  matrix[4 * ver + 9][8] = 1;
  isFunc[4 * ver + 9][8] = true;

  for (let i = 0; i <= 8; i++) {
    if (i < sz) { isFunc[8][i] = true; isFunc[i][8] = true; }
    if (sz - 1 - i >= 0) { isFunc[8][sz - 1 - i] = true; isFunc[sz - 1 - i][8] = true; }
  }

  let byteIdx = 0;
  let bitIdx = 7;
  let dir = -1;
  let r = sz - 1;
  let c = sz - 1;

  while (c > 0) {
    if (c === 6) c--;
    for (let i = 0; i < sz; i++) {
      const row = dir < 0 ? r - i : i;
      for (let col = c; col >= c - 1; col--) {
        if (!isFunc[row][col]) {
          let bit = 0;
          if (byteIdx < finalCodewords.length) {
            bit = (finalCodewords[byteIdx] >>> bitIdx) & 1;
            bitIdx--;
            if (bitIdx < 0) { bitIdx = 7; byteIdx++; }
          }
          matrix[row][col] = (row + col) % 2 === 0 ? bit ^ 1 : bit;
        }
      }
    }
    dir = -dir;
    c -= 2;
  }

  const fBits = 0b101010000010010;
  for (let i = 0; i < 15; i++) {
    const bit = (fBits >>> (14 - i)) & 1;
    if (i < 6) matrix[8][i] = bit;
    else if (i < 8) matrix[8][i + 1] = bit;
    else matrix[8 - (i - 7)][8] = bit;

    if (i < 8) matrix[sz - 1 - i][8] = bit;
    else matrix[8][sz - (15 - i)] = bit;
  }

  const modCount = sz + margin * 2;
  const modSize = size / modCount;
  let path = '';
  for (let ro = 0; ro < sz; ro++) {
    for (let co = 0; co < sz; co++) {
      if (matrix[ro][co] === 1) {
        const x = ((co + margin) * modSize).toFixed(2);
        const y = ((ro + margin) * modSize).toFixed(2);
        const w = modSize.toFixed(2);
        path += `M${x},${y}h${w}v${w}h-${w}z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${bgColor}"/><path d="${path}" fill="${color}"/></svg>`;
}

export function renderBarcodeGraphic(text, format = 'code128', options = {}) {
  const code = String(text || '').trim();
  if (format === 'qr') return qrSvg(code, options);
  if (format === 'ean13') return ean13Svg(code, options);
  if (format === 'compact') return barcodeSvg(code, { ...options, height: 24, showText: true });
  return barcodeSvg(code, options);
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



export function pickImageFile(file, maxSize = 420) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('الملف المختار ليس صورة')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('صورة غير صالحة'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result || '');
    };
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
