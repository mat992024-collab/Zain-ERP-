import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
const PORT = 4197;
const DEBUG = 9300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, 'data', 'ui-test.db');
const udd = path.join(os.tmpdir(), 'zain-cdp-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }

if (!CHROME) {
  console.log('SKIP  browser test: no Chrome/Edge binary found');
  process.exit(0);
}

const server = spawn(process.execPath, ['src/server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, ZAIN_PORT: String(PORT), ZAIN_DB: DB },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stdout.write('[srv-err] ' + d));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG}`, '--remote-allow-origins=*', `--user-data-dir=${udd}`,
  '--window-size=1400,900', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', (d) => { const s = String(d); if (/error|fail/i.test(s)) process.stdout.write('[chr] ' + s); });

let ws, id = 0, phase = 'startup';
const pending = new Map();
const listeners = [];
const errors = [];
const requests = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
function onMessage(m) {
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    return;
  }
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  if (m.method === 'Page.javascriptDialogOpening') {
    send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(`[${phase}] EXC ${(d.exception && d.exception.description) || d.text}`);
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const text = m.params.entry.text || '';
    if (/Failed to load resource: the server responded with a status of (400|403|409)/.test(text)) return;
    errors.push(`[${phase}] LOG ${text} ${m.params.entry.url || ''}`);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(`[${phase}] CONS ${m.params.args.map((a) => a.value || a.description).join(' ')}`);
  }
}
async function evalJs(expression, awaitPromise = false) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }),
    sleep(15000).then(() => { throw new Error('eval-timeout: ' + expression.slice(0, 80)); }),
  ]);
  if (r.exceptionDetails) throw new Error('eval-error: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
async function nav(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    try {
      const st = await evalJs('({href: location.href, ready: document.readyState})');
      if (st.href.startsWith(url) && (st.ready === 'interactive' || st.ready === 'complete')) return;
    } catch {}
    await sleep(100);
  }
}
async function waitFor(expression, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { if (await evalJs(expression)) return true; } catch {}
    await sleep(250);
  }
  return false;
}

const results = [];
function check(name, ok, extra = '') { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); }

async function main() {
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/'); break; } catch { await sleep(200); } }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).ok) break; } catch { await sleep(200); } }

  const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Network.enable');

  phase = 'login-screen';
  await nav(BASE);
  const shellReady = await waitFor(`!!document.getElementById('auth')`);
  check('app shell loaded', shellReady === true);
  check('login screen visible', (await evalJs(`!document.getElementById('auth').classList.contains('hidden')`)) === true);

  phase = 'auth';
  const token = await evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin'})}).then(r=>r.json()).then(d=>d.token)`, true);
  check('login token received', !!token, String(token));
  await evalJs(`localStorage.setItem('zain_token', ${JSON.stringify(token)})`);

  phase = 'seed';
  const seeded = await evalJs(`fetch('/api/products',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({name:'صنف اختبار المتصفح',category:'اختبار',barcode:'UITEST1',sale_price:1500,cost_price:900,quantity:50})}).then(r=>r.json()).then(d=>d.product.id)`, true);
  check('seed product created', typeof seeded === 'number' && seeded > 0, String(seeded));
  const productId = seeded;
  const seedCustomer = await evalJs(`fetch('/api/customers',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({name:'عميل حد الائتمان',type:'retail',credit_limit:1000})}).then(r=>r.json()).then(d=>d.customer.id)`, true);
  check('seed customer created', typeof seedCustomer === 'number' && seedCustomer > 0, String(seedCustomer));
  const customerId = seedCustomer;
  const lowStockId = await evalJs(`fetch('/api/products',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({name:'صنف ناقص المخزون',category:'اختبار',barcode:'UILOW1',sale_price:900,cost_price:500,quantity:2,reorder_level:5})}).then(r=>r.json()).then(d=>d.product.id)`, true);
  check('seed low stock product created', typeof lowStockId === 'number' && lowStockId > 0, String(lowStockId));

  phase = 'shell';
  await nav(BASE);
  let navCount = 0;
  const navReady = await waitFor(`document.querySelectorAll('#nav [data-nav]').length > 0`);
  navCount = await evalJs(`document.querySelectorAll('#nav [data-nav]').length`);
  const mainVisible = await evalJs(`!document.getElementById('main').classList.contains('hidden')`);
  const authHidden = await evalJs(`document.getElementById('auth').classList.contains('hidden')`);
  check('main shell visible', mainVisible === true, String(mainVisible));
  check('login hidden after auth', authHidden === true, String(authHidden));
  check('sidebar nav built', navReady && navCount >= 8, 'links=' + navCount);

  const routes = [
    ['dashboard', 'لوحة التحكم'],
    ['pos', 'نقاط البيع'],
    ['sales', 'فواتير البيع'],
    ['purchases', 'المشتريات'],
    ['inventory', 'المخزون والأصناف'],
    ['customers', 'العملاء'],
    ['suppliers', 'الموردون'],
    ['accounting', 'المحاسبة والمالية'],
    ['shifts', 'الورديات'],
    ['ai', 'الذكاء الاصطناعي'],
    ['reports', 'التقارير'],
    ['admin', 'الإدارة والصلاحيات'],
  ];

  for (const [route, title] of routes) {
    phase = route;
    const before = errors.length;
    await evalJs(`location.hash = '#/${route}'`);
    await sleep(900);
    const cur = await evalJs(`document.getElementById('pageTitle').textContent`);
    const len = await evalJs(`document.getElementById('content').innerText.trim().length`);
    const newErrs = errors.length - before;
    const ok = cur === title && len > 20 && newErrs === 0;
    check(`route #/${route} (title="${cur}", ${len} chars, ${newErrs} err)`, ok);
  }

  phase = 'pos-flow';
  await evalJs(`location.hash = '#/pos'`);
  await sleep(1200);
  const gridCards = await evalJs(`document.querySelectorAll('#productGrid [data-id]').length`);
  check('pos product grid populated', gridCards > 0, 'cards=' + gridCards);
  await waitFor(`!!document.querySelector('#productGrid [data-id]')`, 40);
  await evalJs(`document.querySelector('#productGrid [data-id]').click()`);
  await sleep(400);
  const cartRows = await evalJs(`document.querySelectorAll('#cartItems [data-qty]').length`);
  const total = await evalJs(`document.getElementById('sumTotal').textContent`);
  check('pos cart receives product', cartRows === 1, 'rows=' + cartRows);
  check('pos total computed', total !== '0' && total.length > 0, 'total=' + total);
  await evalJs(`document.getElementById('payBtn').click()`);
  await sleep(600);
  const payModal = await evalJs(`!!document.querySelector('#confirmPay')`);
  check('payment modal opens', payModal === true);
  await evalJs(`window.confirm = function(){ return false; }`);
  console.log('[step] confirm overridden');
  await evalJs(`document.querySelector('#confirmPay').click()`);
  console.log('[step] confirm clicked');
  await sleep(2500);
  const cartAfter = await evalJs(`document.querySelectorAll('#cartItems [data-qty]').length`);
  check('sale completes and cart clears', cartAfter === 0, 'rows=' + cartAfter);
  const saleCount = await evalJs(`fetch('/api/sales?type=sale',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.rows.length)`, true);
  check('sale persisted in database', saleCount > 0, 'sales=' + saleCount);

  phase = 'pos-speed';
  await evalJs(`location.hash = '#/pos'`);
  await sleep(1500);
  const quickCount = await evalJs(`document.querySelectorAll('#quickItems [data-qid]').length`);
  check('quick items strip populated', quickCount > 0, 'items=' + quickCount);
  const lowBar = await evalJs(`document.getElementById('lowStockBar').innerText`);
  check('low stock banner visible', /صنف ناقص المخزون/.test(lowBar), lowBar.replace(/\n/g, ' ').slice(0, 60));
  await evalJs(`document.querySelector('#quickItems [data-qid]').click()`);
  await sleep(400);
  const quickCart = await evalJs(`document.querySelectorAll('#cartItems [data-qty]').length`);
  check('quick item adds to cart', quickCart === 1, 'rows=' + quickCart);

  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F3',bubbles:true}))`);
  await sleep(600);
  const afterSuspend = await evalJs(`document.querySelectorAll('#cartItems [data-qty]').length`);
  const suspendBadge = await evalJs(`document.getElementById('suspendCount').textContent`);
  check('F3 suspends the cart', afterSuspend === 0, 'rows=' + afterSuspend);
  check('suspended counter updated', suspendBadge === '1', 'badge=' + suspendBadge);
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F4',bubbles:true}))`);
  await sleep(700);
  const resumeBtn = await evalJs(`!!document.querySelector('[data-resume]')`);
  check('F4 opens suspended carts', resumeBtn === true);
  await evalJs(`document.querySelector('[data-resume]').click()`);
  await sleep(1200);
  const resumed = await evalJs(`document.querySelectorAll('#cartItems [data-qty]').length`);
  check('suspended cart resumed', resumed === 1, 'rows=' + resumed);

  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F5',bubbles:true}))`);
  await sleep(1500);
  const repeatRows = await evalJs(`document.querySelectorAll('#cartItems [data-qty]').length`);
  const repeatQty = await evalJs(`(function(){const el=document.querySelector('#cartItems [data-qty]');return el?Number(el.value):0;})()`);
  check('F5 repeats last invoice', repeatRows > 0 && repeatQty >= 1, 'rows=' + repeatRows + ' qty=' + repeatQty);
  await evalJs(`document.getElementById('clearCart').click()`);
  await sleep(500);
  await evalJs(`document.querySelector('.modal-backdrop [data-yes]').click()`);
  await sleep(400);

  phase = 'credit-limit';
  await evalJs(`location.hash = '#/pos'`);
  await sleep(1200);
  await evalJs(`(function(){const s=document.getElementById('posCustomer');s.value='${customerId}';s.dispatchEvent(new Event('change'));})()`);
  await waitFor(`!!document.querySelector('#productGrid [data-id]')`, 40);
  await evalJs(`document.querySelector('#productGrid [data-id]').click()`);
  await sleep(400);
  await evalJs(`document.getElementById('payBtn').click()`);
  await sleep(500);
  await evalJs(`document.querySelector('.pm-btn[data-pm="credit"]').click()`);
  await sleep(200);
  await evalJs(`document.querySelector('#confirmPay').click()`);
  await sleep(1500);
  const clModal = await evalJs(`!!document.querySelector('#clOk')`);
  check('credit limit warning shown to cashier', clModal === true);
  const clText = await evalJs(`(function(){const b=[...document.querySelectorAll('.modal-backdrop')].pop();return b?b.innerText:'';})()`);
  check('credit limit warning shows details', /حد الائتمان/.test(clText) && /الرصيد بعد البيع/.test(clText), clText.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`document.querySelector('#clOk') && document.querySelector('#clOk').click()`);
  await sleep(2000);
  const clClosed = await evalJs(`!document.querySelector('#clOk')`);
  check('credit limit override completes sale', clClosed === true);

  phase = 'income-statement';
  await evalJs(`location.hash = '#/accounting'`);
  await sleep(1500);
  await evalJs(`(function(){const b=[...document.querySelectorAll('[data-tab]')].find(x=>x.dataset.tab==='income');if(b)b.click();})()`);
  await sleep(1500);
  const incomeText = await evalJs(`document.getElementById('accPane').innerText`);
  check('income statement tab renders', /مجمل الربح/.test(incomeText) && /صافي الربح/.test(incomeText), incomeText.slice(0, 60).replace(/\n/g, ' '));

  phase = 'vouchers';
  await evalJs(`location.hash = '#/accounting'`);
  await sleep(1500);
  await evalJs(`(function(){const b=[...document.querySelectorAll('[data-tab]')].find(x=>x.dataset.tab==='vouchers');if(b)b.click();})()`);
  const voucherPaneReady = await waitFor(`!!document.getElementById('vcAdd')`, 40);
  const voucherPane = await evalJs(`document.getElementById('accPane').innerText`);
  check('vouchers tab renders', voucherPaneReady === true && /سندات القبض/.test(voucherPane), voucherPane.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`document.getElementById('vcAdd').click()`);
  const voucherModal = await waitFor(`!!document.getElementById('vcSave')`, 40);
  check('new voucher modal opens', voucherModal === true);
  await evalJs(`(function(){const a=document.getElementById('vcAmount');a.value='12345';a.dispatchEvent(new Event('input'));const d=document.getElementById('vcDesc');d.value='سند اختبار المتصفح';})()`);
  await evalJs(`document.getElementById('vcSave').click()`);
  const voucherSaved = await waitFor(`!!document.getElementById('accPane') && /سند اختبار المتصفح/.test(document.getElementById('accPane').innerText)`, 40);
  const voucherRows = await evalJs(`document.querySelectorAll('#accPane tbody tr').length`);
  check('voucher saved and listed', voucherSaved === true && voucherRows > 0, 'rows=' + voucherRows);

  phase = 'z-report';
  await evalJs(`(function(){const b=[...document.querySelectorAll('[data-tab]')].find(x=>x.dataset.tab==='zreport');if(b)b.click();})()`);
  const zReady = await waitFor(`!!document.getElementById('zrDate')`, 40);
  const zText = await evalJs(`document.getElementById('accPane').innerText`);
  check('z-report tab renders', zReady === true && /صافي المبيعات/.test(zText) && /النقد المتوقع/.test(zText), zText.slice(0, 60).replace(/\n/g, ' '));

  phase = 'expiry-report';
  await evalJs(`location.hash = '#/inventory'`);
  await sleep(1500);
  await evalJs(`document.getElementById('pExpiry').click()`);
  const expiryOpen = await waitFor(`(function(){const b=[...document.querySelectorAll('.modal-backdrop')].pop();return b&&/تقرير انتهاء الصلاحية/.test(b.innerText);})()`, 40);
  const expiryText = await evalJs(`(function(){const b=[...document.querySelectorAll('.modal-backdrop')].pop();return b?b.innerText:'';})()`);
  check('expiry report modal opens', expiryOpen === true, expiryText.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`(function(){const b=document.querySelector('.modal-backdrop [data-close]');if(b)b.click();})()`);

  phase = 'currency';
  await evalJs(`fetch('/api/currencies',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({code:'USD',name:'دولار أمريكي',symbol:'$',rate:1310,decimals:2})}).then(r=>r.json()).then(d=>d.rows.length)`, true);
  await evalJs(`location.hash = '#/admin'`);
  await sleep(1500);
  await waitFor(`!!document.querySelector('[data-cur-edit="USD"]')`, 40);
  const curCard = await evalJs(`(function(){const el=document.getElementById('currencyCard');return el?el.innerText:'';})()`);
  check('admin shows currencies card', /العملات وأسعار الصرف/.test(curCard) && /USD/.test(curCard), curCard.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`(function(){const b=document.querySelector('[data-cur-edit="USD"]');if(b)b.click();})()`);
  await sleep(600);
  const curModal = await evalJs(`!!document.getElementById('curSave')`);
  check('currency edit modal opens', curModal === true);
  await evalJs(`(function(){const r=document.getElementById('curRate');r.value='1320';r.dispatchEvent(new Event('input'));})()`);
  await evalJs(`document.getElementById('curSave').click()`);
  await sleep(1500);
  const rateUpdated = await evalJs(`fetch('/api/currencies',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.rows.find(c=>c.code==='USD').rate)`, true);
  check('currency rate saved from admin UI', Number(rateUpdated) === 1320, 'rate=' + rateUpdated);

  await evalJs(`location.hash = '#/pos'`);
  await sleep(1800);
  await waitFor(`!!document.querySelector('#productGrid [data-id]')`, 40);
  await evalJs(`document.querySelector('#productGrid [data-id]').click()`);
  await sleep(400);
  await evalJs(`document.getElementById('payBtn').click()`);
  const payCur = await waitFor(`!!document.getElementById('payCurrency')`, 40);
  check('payment modal offers currency choice', payCur === true);
  await evalJs(`(function(){const s=document.getElementById('payCurrency');s.value='USD';s.dispatchEvent(new Event('change'));})()`);
  await sleep(400);
  const payTotal = await evalJs(`document.getElementById('payTotal').textContent`);
  const payBaseLine = await evalJs(`document.getElementById('payBaseLine').textContent`);
  check('foreign currency converts required amount', /\$/.test(payTotal), 'total=' + payTotal);
  check('foreign currency shows base equivalent', /131|132|يساوي|يعادل/.test(payBaseLine), payBaseLine.slice(0, 60));
  await evalJs(`(function(){const b=document.querySelector('.modal-backdrop [data-cancel]');if(b)b.click();})()`);
  await sleep(300);
  await evalJs(`document.getElementById('clearCart').click()`);
  await sleep(400);
  await evalJs(`(function(){const b=document.querySelector('.modal-backdrop [data-yes]');if(b)b.click();})()`);
  await sleep(300);

  phase = 'auto-backup';
  await evalJs(`location.hash = '#/admin'`);
  await waitFor(`!!document.getElementById('backupCard')`);
  await sleep(600);
  const autoBox = await evalJs(`(function(){const el=document.getElementById('backupCard');return el?el.innerText:'';})()`);
  check('backup card shows auto backup section', /النسخ التلقائي اليومي/.test(autoBox), autoBox.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`(function(){const b=document.getElementById('bkAutoEnabled');b.checked=true;b.dispatchEvent(new Event('change'));const t=document.getElementById('bkAutoTime');t.value='01:15';t.dispatchEvent(new Event('input'));})()`);
  await evalJs(`document.getElementById('bkAutoSave').click()`);
  await sleep(2000);
  const autoState = await evalJs(`fetch('/api/backup',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.auto)`, true);
  check('auto backup settings saved from UI', autoState && autoState.enabled === true && autoState.time === '01:15', JSON.stringify(autoState));
  await evalJs(`document.getElementById('bkAutoRun').click()`);
  await sleep(2500);
  const autoList = await evalJs(`fetch('/api/backup',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.backups.map(b=>b.name))`, true);
  check('auto backup snapshot created from UI', Array.isArray(autoList) && autoList.some((n) => n.startsWith('zain-auto-')), JSON.stringify(autoList));
  await evalJs(`fetch('/api/backup/auto',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({enabled:false})})`, true);

  phase = 'statement';
  await evalJs(`location.hash = '#/customers'`);
  await sleep(1500);
  const stmtBtn = await evalJs(`!!document.querySelector('[data-stmt]')`);
  check('statement button present in customers list', stmtBtn === true);
  await evalJs(`document.querySelector('[data-stmt]').click()`);
  await sleep(1500);
  const stmtText = await evalJs(`(function(){const b=[...document.querySelectorAll('.modal-backdrop')].pop();return b?b.innerText:'';})()`);
  check('statement modal renders', /كشف حساب/.test(stmtText) && /أعمار الذمم/.test(stmtText), stmtText.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`(function(){const b=document.querySelector('.modal-backdrop [data-close]');if(b)b.click();})()`);

  phase = 'sales-profit';
  await evalJs(`location.hash = '#/sales'`);
  await sleep(1500);
  const salesHead = await evalJs(`document.querySelector('#content thead').innerText`);
  check('sales table shows profit column', /الربح/.test(salesHead), salesHead.replace(/\n/g, ' ').slice(0, 80));

  phase = 'settings-modal';
  await evalJs(`document.getElementById('settingsBtn').click()`);
  const settingsField = await waitFor(`!!document.getElementById('set_company_name')`, 40);
  check('settings modal opens', settingsField === true);
  await evalJs(`document.querySelector('.modal-backdrop [data-close], .modal-backdrop [data-cancel]') && document.querySelector('.modal-backdrop [data-close], .modal-backdrop [data-cancel]').click()`);

  phase = 'theme';
  const themeBefore = await evalJs(`document.documentElement.dataset.theme || 'light'`);
  await evalJs(`document.getElementById('themeBtn').click()`);
  await sleep(800);
  const themeAfter = await evalJs(`document.documentElement.dataset.theme`);
  const themeSetting = await evalJs(`fetch('/api/settings',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.settings.theme)`, true);
  const bodyBg = await evalJs(`getComputedStyle(document.body).backgroundColor`);
  const bgLum = (bodyBg.match(/\d+/g) || ['255']).map(Number);
  check('theme toggle switches to dark', themeBefore !== 'dark' && themeAfter === 'dark', `${themeBefore}->${themeAfter}`);
  check('theme persisted in settings', themeSetting === 'dark', 'setting=' + themeSetting);
  check('dark theme paints dark surfaces', bgLum[0] < 60, 'bg=' + bodyBg);
  await evalJs(`document.getElementById('themeBtn').click()`);
  await sleep(800);
  const themeReset = await evalJs(`document.documentElement.dataset.theme`);
  const bodyBg2 = await evalJs(`getComputedStyle(document.body).backgroundColor`);
  check('theme toggles back to light', themeReset === 'light' && bodyBg2 !== bodyBg, 'theme=' + themeReset + ' bg=' + bodyBg2);

  phase = 'print';
  const saleId = await evalJs(`fetch('/api/sales?type=sale',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.rows[0].id)`, true);
  await nav(`${BASE}/api/print/thermal/${saleId}?width=80&token=${token}`);
  const thermal = await evalJs(`document.body.innerText`);
  check('thermal receipt renders', thermal.length > 40, 'chars=' + thermal.length);
  const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }).catch(() => null);
  check('print pipeline outputs PDF', !!pdf && !!pdf.data && pdf.data.length > 800, 'bytes=' + (pdf && pdf.data ? pdf.data.length : 0));

  await nav(`${BASE}/api/print/a4/${saleId}?token=${token}`);
  const a4 = await evalJs(`document.body.innerText`);
  check('A4 invoice renders', a4.length > 40 && /فاتورة/.test(a4), 'chars=' + a4.length);

  const labelsHtml = await evalJs(`fetch('/api/print/labels',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({items:[{product_id:${productId},qty:1}],repeats:2})}).then(r=>r.text())`, true);
  const tree = await send('Page.getFrameTree');
  await send('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html: labelsHtml });
  await sleep(400);
  const svgCount = await evalJs(`document.querySelectorAll('svg').length`);
  const labelText = await evalJs(`document.body.innerText`);
  check('barcode labels render as SVG', svgCount > 0, 'svg=' + svgCount);
  check('label shows product name', /صنف اختبار المتصفح/.test(labelText), labelText.slice(0, 40).replace(/\n/g, ' '));

  phase = 'print-template';
  await nav(BASE);
  await waitFor(`document.querySelectorAll('#nav [data-nav]').length > 0`);
  await sleep(1200);
  await evalJs(`location.hash = '#/admin'`);
  await sleep(1800);
  await evalJs(`(function(){const b=document.getElementById('settingsBtn');if(b)b.click();})()`);
  await waitFor(`!!document.getElementById('set_print_header_text')`);
  await sleep(400);
  const tplFields = await evalJs(`(function(){return ['set_print_header_text','set_print_header_sub','set_print_footer_note','set_print_invoice_note','set_print_label_note','set_print_font_size','set_print_density','set_print_show_logo','set_print_show_tax_id','set_print_show_cashier','set_print_preview','set_print_clear_logo'].filter(function(id){return !document.getElementById(id);}).join(',');})()`);
  check('print template fields present in settings', tplFields === '', 'missing=' + tplFields);
  await evalJs(`(function(){document.getElementById('set_print_header_text').value='فرع المتجر';document.getElementById('set_print_footer_note').value='شكراً لزيارتكم';document.getElementById('set_print_font_size').value='large';})()`);
  await evalJs(`document.getElementById('set_print_preview').click()`);
  await sleep(700);
  const previewText = await evalJs(`(function(){const ps=document.querySelectorAll('.modal-panel');return ps.length?ps[ps.length-1].innerText:'';})()`);
  check('print template preview shows header and footer', /فرع المتجر/.test(previewText) && /شكراً لزيارتكم/.test(previewText), previewText.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`(function(){const ps=document.querySelectorAll('.modal-backdrop');if(ps.length){const b=ps[ps.length-1].querySelector('[data-close]');if(b)b.click();}})()`);
  await sleep(500);
  await evalJs(`document.getElementById('setSave').click()`);
  await sleep(2500);
  const savedTpl = await evalJs(`fetch('/api/settings',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.settings)`, true);
  check('print template saved from UI', savedTpl && savedTpl.print_header_text === 'فرع المتجر' && savedTpl.print_footer_note === 'شكراً لزيارتكم' && savedTpl.print_font_size === 'large', JSON.stringify(savedTpl && { h: savedTpl.print_header_text, f: savedTpl.print_font_size }));
  await nav(`${BASE}/api/print/thermal/${saleId}?width=80&token=${token}`);
  const thermalTpl = await evalJs(`document.body.innerText`);
  check('thermal receipt uses saved template', /فرع المتجر/.test(thermalTpl) && /شكراً لزيارتكم/.test(thermalTpl), thermalTpl.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({print_header_text:'',print_footer_note:'',print_font_size:'normal'})})`, true);

  phase = 'export-download';
  await nav(BASE);
  await waitFor(`document.querySelectorAll('#nav [data-nav]').length > 0`);
  await sleep(1200);
  await evalJs(`location.hash = '#/sales'`);
  await sleep(2000);
  const exportBtn = await evalJs(`!!document.querySelector('#sExport')`);
  check('sales export button present', exportBtn === true);
  const dlDir = path.join(os.tmpdir(), 'zain-dl-' + Date.now());
  fs.mkdirSync(dlDir, { recursive: true });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir }).catch(() => {});
  await evalJs(`document.querySelector('#sExport').click()`);
  let csvFile = null;
  let dlFiles = [];
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    dlFiles = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
    csvFile = dlFiles.find((f) => f.endsWith('.csv'));
    if (csvFile) break;
  }
  check('CSV downloaded by the browser', !!csvFile, dlFiles.join(','));
  if (csvFile) {
    const body = fs.readFileSync(path.join(dlDir, csvFile));
    check('downloaded CSV is valid UTF-8 with BOM', body[0] === 0xEF && body[1] === 0xBB && body[2] === 0xBF && body.toString('utf8').includes('رقم الفاتورة'), 'bytes=' + body.length);
  }

  phase = 'backup';
  await evalJs(`location.hash = '#/admin'`);
  await waitFor(`!!document.getElementById('backupCard')`);
  await sleep(600);
  const bkCard = await evalJs(`!!document.getElementById('backupCard')`);
  check('backup card rendered in admin', bkCard === true);
  await evalJs(`document.getElementById('bkCreate').click()`);
  await sleep(2500);
  const bkRows = await evalJs(`document.querySelectorAll('#backupCard [data-bk-dl]').length`);
  check('backup snapshot created and listed', bkRows >= 1, 'rows=' + bkRows);
  const bkName = await evalJs(`(function(){const b=document.querySelector('#backupCard [data-bk-dl]');return b?b.dataset.bkDl:''})()`);
  check('backup snapshot is zip archive', bkName.endsWith('.zip'), bkName);
  const bkZip = await evalJs(`fetch('/api/backup/'+encodeURIComponent(${JSON.stringify(bkName)})+'/download',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b).slice(0,2).join(','))`, true);
  check('backup download returns zip signature', bkZip === '80,75', bkZip);

  phase = 'reminders';
  await evalJs(`location.hash = '#/reminders'`);
  await waitFor(`!!document.getElementById('rmText')`);
  await sleep(800);
  const rmText = await evalJs(`document.getElementById('rmText').textContent`);
  check('reminders view renders daily digest text', rmText.length > 10 && /تذكير/.test(rmText), 'len=' + rmText.length);
  const rmKpis = await evalJs(`document.querySelectorAll('.kpi').length`);
  check('reminders view shows kpi cards', rmKpis === 4, 'kpis=' + rmKpis);
  await evalJs(`document.getElementById('rmAdd').click()`);
  await waitFor(`!!document.getElementById('rfTitle')`);
  await sleep(400);
  await evalJs(`(function(){document.getElementById('rfTitle').value='صيانة أسبوعية';document.getElementById('rfBody').value='فحص الطابعة الحرارية';document.getElementById('rfTime').value='09:45';})()`);
  await evalJs(`document.getElementById('rfSave').click()`);
  await waitFor(`document.querySelectorAll('[data-rm-del]').length > 0`, 40);
  await sleep(400);
  const rmRows = await evalJs(`document.querySelectorAll('[data-rm-del]').length`);
  check('custom reminder created from UI', rmRows === 1, 'rows=' + rmRows);
  const rmList = await evalJs(`fetch('/api/reminders',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.rows)`, true);
  check('custom reminder persisted with next run', Array.isArray(rmList) && rmList.length === 1 && rmList[0].title === 'صيانة أسبوعية' && !!rmList[0].next_run, JSON.stringify(rmList && rmList[0] && rmList[0].title));
  await evalJs(`document.querySelector('[data-rm-del]').click()`);
  await sleep(600);
  const confirmText = await evalJs(`(function(){const ps=document.querySelectorAll('.modal-panel');return ps.length?ps[ps.length-1].innerText:'';})()`);
  check('delete confirmation dialog shown', /حذف/.test(confirmText), confirmText.slice(0, 40).replace(/\n/g, ' '));
  await evalJs(`(function(){const ps=document.querySelectorAll('.modal-backdrop');if(ps.length){const b=ps[ps.length-1].querySelector('[data-yes]');if(b)b.click();}})()`);
  await sleep(1200);
  const rmAfter = await evalJs(`fetch('/api/reminders',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.rows.length)`, true);
  check('custom reminder deleted from UI', rmAfter === 0, 'rows=' + rmAfter);

  phase = 'inventory-report';
  await nav(BASE);
  await waitFor(`document.querySelectorAll('#nav [data-nav]').length > 0`);
  await sleep(1200);
  await evalJs(`location.hash = '#/reports'`);
  await waitFor(`!!document.querySelector('[data-rtab="inventory"]')`);
  await sleep(1200);
  await evalJs(`document.querySelector('[data-rtab="inventory"]').click()`);
  await waitFor(`!!document.getElementById('invPrint')`);
  await sleep(900);
  const invKpis = await evalJs(`document.querySelectorAll('.kpi').length`);
  check('inventory report shows kpis', invKpis === 4, 'kpis=' + invKpis);
  const invText = await evalJs(`document.getElementById('repPane').innerText`);
  check('inventory report lists products', /لابتوب|صنف/.test(invText), invText.slice(0, 60).replace(/\n/g, ' '));
  const invApi = await evalJs(`fetch('/api/reports/inventory',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>d.totals)`, true);
  check('inventory api returns totals', invApi && invApi.items > 0 && invApi.cost_value > 0, JSON.stringify(invApi));
  const invPrintHtml = await evalJs(`fetch('/api/print/inventory',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.text())`, true);
  check('inventory print contains report header', invPrintHtml.includes('تقرير المخزون'), 'len=' + invPrintHtml.length);

  phase = 'account-ledger';
  await evalJs(`location.hash = '#/accounting'`);
  await sleep(2000);
  await evalJs(`(function(){const b=[...document.querySelectorAll('[data-tab]')].find(function(x){return x.dataset.tab==='accounts';});if(b)b.click();})()`);
  await waitFor(`!!document.querySelector('[data-aledger]')`);
  await sleep(600);
  await evalJs(`document.querySelector('[data-aledger]').click()`);
  await waitFor(`!!document.getElementById('ldPrint')`);
  await sleep(700);
  const ledgerText = await evalJs(`(function(){const ps=document.querySelectorAll('.modal-panel');return ps.length?ps[ps.length-1].innerText:'';})()`);
  check('account ledger dialog opens', /دفتر الأستاذ/.test(ledgerText), ledgerText.slice(0, 50).replace(/\n/g, ' '));
  await evalJs(`(function(){const ps=document.querySelectorAll('.modal-backdrop');if(ps.length){const b=ps[ps.length-1].querySelector('[data-close]');if(b)b.click();}})()`);
  await sleep(500);

  phase = 'tax-report';
  await evalJs(`fetch('/api/products/${productId}',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({tax_rate:10})}).then(r=>r.json())`, true);
  await evalJs(`fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({tax_mode:'auto'})}).then(r=>r.json())`, true);
  await nav(BASE);
  await waitFor(`!!document.getElementById('main') && !document.getElementById('main').classList.contains('hidden')`);
  await sleep(1000);
  await evalJs(`location.hash = '#/pos'`);
  await waitFor(`!!document.getElementById('posSearch')`);
  await sleep(1200);
  await evalJs(`(function(){const s=document.getElementById('posSearch');s.value='UITEST1';s.dispatchEvent(new Event('input'));})()`);
  await waitFor(`!!document.querySelector('#productGrid [data-id]')`, 40);
  await evalJs(`document.querySelector('#productGrid [data-id]').click()`);
  await sleep(600);
  const taxField = await evalJs(`(function(){const el=document.getElementById('posTax');return el?{ro:el.readOnly,v:el.value}:null;})()`);
  check('pos tax field readonly in auto mode', taxField && taxField.ro === true, JSON.stringify(taxField));
  const taxHint = await evalJs(`(document.getElementById('taxModeHint')||{}).textContent||''`);
  check('pos shows tax mode hint', /تلقائي/.test(taxHint), taxHint);
  const taxValue = await evalJs(`(document.getElementById('sumTax')||{}).textContent||''`);
  check('pos shows computed tax row', taxValue.length > 0 && taxValue !== '0', 'tax=' + taxValue);
  await evalJs(`document.getElementById('clearCart').click()`);
  await sleep(500);
  await evalJs(`(function(){const b=document.querySelector('.modal-backdrop [data-yes]');if(b)b.click();})()`);
  await sleep(400);
  await evalJs(`fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({tax_mode:'manual'})}).then(r=>r.json())`, true);
  await evalJs(`location.hash = '#/reports'`);
  await sleep(1500);
  await evalJs(`document.querySelector('[data-rtab="tax"]').click()`);
  await waitFor(`!!document.getElementById('taxPrint')`);
  await sleep(800);
  const taxKpis = await evalJs(`document.querySelectorAll('#repPane .kpi').length`);
  check('tax report shows kpis', taxKpis === 4, 'kpis=' + taxKpis);
  const taxPrintBtn = await evalJs(`!!document.getElementById('taxPrint')`);
  check('tax report has print button', taxPrintBtn === true);
  const taxApi = await evalJs(`fetch('/api/reports/tax',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>({o:d.output_tax,n:d.net_payable,rows:d.rows.length}))`, true);
  check('tax report api returns totals', taxApi && typeof taxApi.o === 'number' && taxApi.rows >= 0, JSON.stringify(taxApi));

  phase = 'activity-log';
  await nav(BASE);
  await waitFor(`document.querySelectorAll('#nav [data-nav]').length > 0`);
  await sleep(1000);
  const actNav = await evalJs(`!!document.querySelector('#nav [data-nav="activity"]')`);
  check('activity nav link present', actNav === true);
  await evalJs(`location.hash = '#/activity'`);
  await waitFor(`!!document.getElementById('acRows') && document.querySelectorAll('#acRows tr').length > 0`);
  await sleep(700);
  const actRows = await evalJs(`document.querySelectorAll('#acRows tr').length`);
  check('activity view lists log rows', actRows > 0, 'rows=' + actRows);
  const actOpts = await evalJs(`document.getElementById('acAction').options.length`);
  check('activity view populates action filter', actOpts > 1, 'options=' + actOpts);
  const actCount = await evalJs(`document.getElementById('acCount').textContent`);
  check('activity view shows total count', /إجمالي/.test(actCount), actCount);
  await evalJs(`(function(){const s=document.getElementById('acAction');s.value='sale';s.dispatchEvent(new Event('change'));})()`);
  await sleep(900);
  const saleOnly = await evalJs(`(function(){const rows=[...document.querySelectorAll('#acRows tr')];return rows.length?rows.every(function(r){return /بيع/.test(r.innerText);}):true;})()`);
  check('activity view filters by action', saleOnly === true, 'rows=' + actRows);
  const actApi = await evalJs(`fetch('/api/activity',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>({t:d.total,a:d.by_action.length}))`, true);
  check('activity api returns totals', actApi && actApi.t > 0 && actApi.a > 0, JSON.stringify(actApi));

  phase = 'sales-analysis';
  await evalJs(`location.hash = '#/reports'`);
  await sleep(1500);
  await evalJs(`document.querySelector('[data-rtab="analysis"]').click()`);
  await waitFor(`!!document.getElementById('anaPrint')`);
  await sleep(900);
  const anaKpis = await evalJs(`document.querySelectorAll('#repPane .kpi').length`);
  check('sales analysis shows kpis', anaKpis === 4, 'kpis=' + anaKpis);
  const anaText = await evalJs(`document.getElementById('repPane').innerText`);
  check('sales analysis lists top products', /لابتوب|صنف/.test(anaText), anaText.slice(0, 60).replace(/\n/g, ' '));
  const anaApi = await evalJs(`fetch('/api/reports/sales-analysis',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.json()).then(d=>({r:d.totals.revenue,p:d.products.length,c:d.customers.length}))`, true);
  check('sales analysis api returns ranking', anaApi && anaApi.r >= 0 && anaApi.p >= 0 && anaApi.c >= 0, JSON.stringify(anaApi));
  const anaPrintHtml = await evalJs(`fetch('/api/print/sales-analysis',{headers:{'Authorization':'Bearer ${token}'}}).then(r=>r.text())`, true);
  check('sales analysis print contains header', anaPrintHtml.includes('تحليل المبيعات'), 'len=' + anaPrintHtml.length);

  phase = 'quick-search';
  await nav(BASE);
  await waitFor(`document.querySelectorAll('#nav [data-nav]').length > 0`);
  await sleep(900);
  const searchBtn = await evalJs(`!!document.getElementById('searchBtn')`);
  check('header search button present', searchBtn === true);
  await evalJs(`document.getElementById('searchBtn').click()`);
  await waitFor(`!!document.getElementById('gsInput')`);
  await sleep(400);
  check('quick search palette opens', (await evalJs(`!!document.getElementById('gsInput')`)) === true);
  await evalJs(`(function(){const i=document.getElementById('gsInput');i.value='صنف اختبار المتصفح';i.dispatchEvent(new Event('input'));})()`);
  await waitFor(`!!document.querySelector('#gsResults [data-go]')`, 40);
  await sleep(500);
  const gsText = await evalJs(`document.getElementById('gsResults').innerText`);
  check('quick search returns product results', /صنف اختبار المتصفح/.test(gsText), gsText.slice(0, 60).replace(/\n/g, ' '));
  await evalJs(`document.querySelector('#gsResults [data-go]').click()`);
  await sleep(1500);
  const gsRoute = await evalJs(`location.hash`);
  check('quick search navigates to inventory', gsRoute === '#/inventory', gsRoute);
  const gsSearch = await evalJs(`(document.getElementById('pSearch')||{}).value||''`);
  check('quick search prefills view filter', /صنف اختبار/.test(gsSearch), gsSearch);
  await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);
  await sleep(600);
  const gsReopen = await evalJs(`!!document.getElementById('gsInput')`);
  check('ctrl+k reopens quick search', gsReopen === true);
  await evalJs(`(function(){const b=document.querySelector('.modal-backdrop [data-close]');if(b)b.click();})()`);
  await sleep(400);

  phase = 'product-image';
  const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  await evalJs(`fetch('/api/products/${productId}/image',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({data_url:${JSON.stringify(pngDataUrl)}})})`, true);
  await evalJs(`location.hash = '#/dashboard'`);
  await sleep(700);
  await evalJs(`location.hash = '#/products'`);
  await sleep(1800);
  const invImg = await evalJs(`document.querySelectorAll('#pBody img').length`);
  check('inventory list shows product image', invImg >= 1, 'imgs=' + invImg);
  await evalJs(`location.hash = '#/pos'`);
  await sleep(1500);
  await evalJs(`(function(){const s=document.getElementById('posSearch');s.value='UITEST1';s.dispatchEvent(new Event('input'));})()`);
  await waitFor(`!!document.querySelector('#productGrid [data-id]')`, 40);
  await sleep(500);
  const posImg = await evalJs(`document.querySelectorAll('#productGrid img').length`);
  check('pos grid shows product image', posImg >= 1, 'imgs=' + posImg);
  const imgOk = await evalJs(`(function(){const i=document.querySelector('#productGrid img');return i?i.naturalWidth>0:false;})()`);
  check('pos image actually loads', imgOk === true, String(imgOk));
  await evalJs(`location.hash = '#/products'`);
  await sleep(1600);
  await evalJs(`document.querySelector('#pAdd').click()`);
  await sleep(700);
  await evalJs(`(async function(){
    const r=await fetch(${JSON.stringify(pngDataUrl)});
    const b=await r.blob();
    const f=new File([b],'t.png',{type:'image/png'});
    const dt=new DataTransfer();
    dt.items.add(f);
    const inp=document.querySelector('#pfImage');
    inp.files=dt.files;
    inp.dispatchEvent(new Event('change'));
    return true;
  })()`, true);
  await sleep(900);
  const formImg = await evalJs(`(function(){const i=document.querySelector('#pfImgBox img');return i?i.src.slice(0,15):''})()`);
  check('product form shows image preview', formImg.startsWith('data:image/'), formImg);
  await evalJs(`document.querySelector('#pfImageClear').click()`);
  await sleep(300);
  const cleared = await evalJs(`document.querySelector('#pfImageData').value`);
  check('product form clears image', cleared === '', cleared);
  await evalJs(`document.querySelector('[data-cancel]').click()`);
  await sleep(400);
  await evalJs(`fetch('/api/products/${productId}/image',{method:'DELETE',headers:{'Authorization':'Bearer ${token}'}})`, true);

  phase = 'offline';
  const external = [...new Set(requests)].filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:'));
  check('no external network requests (works offline)', external.length === 0, external.join(' , '));

  console.log('\n--- console errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  const passed = results.filter((r) => r[1]).length;
  console.log(`\n${passed}/${results.length} checks passed, ${errors.length} console errors`);

  await send('Browser.close').catch(() => {});
  try { chrome.kill(); } catch {}
  try { server.kill(); } catch {}
  const failed = passed !== results.length || errors.length > 0;
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}

setTimeout(() => main().catch((e) => {
  console.error('FATAL', e);
  if (errors.length) console.error('--- console errors ---\n' + errors.join('\n'));
  try { chrome.kill(); } catch {} try { server.kill(); } catch {} process.exit(1);
}), 2000);
