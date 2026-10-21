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

  phase = 'credit-limit';
  await evalJs(`location.hash = '#/pos'`);
  await sleep(1200);
  await evalJs(`(function(){const s=document.getElementById('posCustomer');s.value='${customerId}';s.dispatchEvent(new Event('change'));})()`);
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
  await sleep(700);
  const settingsField = await evalJs(`!!document.querySelector('#set_company_name')`);
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
  await sleep(3000);
  const dlFiles = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
  const csvFile = dlFiles.find((f) => f.endsWith('.csv'));
  check('CSV downloaded by the browser', !!csvFile, dlFiles.join(','));
  if (csvFile) {
    const body = fs.readFileSync(path.join(dlDir, csvFile));
    check('downloaded CSV is valid UTF-8 with BOM', body[0] === 0xEF && body[1] === 0xBB && body[2] === 0xBF && body.toString('utf8').includes('رقم الفاتورة'), 'bytes=' + body.length);
  }

  phase = 'backup';
  await evalJs(`location.hash = '#/admin'`);
  await sleep(2200);
  const bkCard = await evalJs(`!!document.getElementById('backupCard')`);
  check('backup card rendered in admin', bkCard === true);
  await evalJs(`document.getElementById('bkCreate').click()`);
  await sleep(2500);
  const bkRows = await evalJs(`document.querySelectorAll('#backupCard [data-bk-dl]').length`);
  check('backup snapshot created and listed', bkRows >= 1, 'rows=' + bkRows);

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
