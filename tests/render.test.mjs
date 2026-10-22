import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, 'data', 'render-test.db');

for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }

function el() {
  const target = {
    innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    appendChild(x) { return x; }, remove() {}, focus() {}, scrollIntoView() {},
    querySelector() { return el(); },
    querySelectorAll() { return []; },
    closest() { return el(); },
    setAttribute() {}, getAttribute() { return null; },
    insertAdjacentHTML() {},
  };
  return new Proxy(target, {
    get(t, p) { return p in t ? t[p] : undefined; },
    set(t, p, v) { t[p] = v; return true; },
  });
}

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = {
  getElementById: () => el(),
  querySelector: () => el(),
  querySelectorAll: () => [],
  createElement: () => el(),
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {} },
};
globalThis.window = { location: { hash: '' }, addEventListener() {}, open: () => null };
globalThis.location = { hash: '' };
globalThis.confirm = () => false;
globalThis.alert = () => {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(e); console.log('ASYNC FAIL => ' + (e && e.message || e)); });

const child = spawn(process.execPath, ['src/server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, ZAIN_PORT: String(PORT), ZAIN_DB: DB },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stdout.write('[err] ' + d));
child.on('exit', (c) => process.stdout.write('[srv exit] ' + c + '\n'));

async function main() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, o) => realFetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : u, o);
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/'); break; } catch { await sleep(150); } }

  const lr = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  })).json();

  const core = await import('../src/web/js/core.js');
  core.state.token = lr.token;
  core.state.user = (await (await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + lr.token } })).json()).user;
  const st = await (await fetch(BASE + '/api/settings', { headers: { Authorization: 'Bearer ' + lr.token } })).json();
  core.state.settings = st.settings;
  core.state.modules = st.modules;
  core.state.shift = null;

  const { render } = await import('../src/web/js/views/pos.js');
  const inv = await import('../src/web/js/views/inventory.js');
  const con = await import('../src/web/js/views/contacts.js');
  const sal = await import('../src/web/js/views/sales.js');
  const acc = await import('../src/web/js/views/accounting.js');
  const ai = await import('../src/web/js/views/ai.js');
  const adm = await import('../src/web/js/views/admin.js');
  const act = await import('../src/web/js/views/activity.js');

  const jobs = [
    ['pos.render', render],
    ['inventory.renderInventory', inv.renderInventory],
    ['inventory.renderProducts', inv.renderProducts],
    ['contacts.renderCustomers', con.renderCustomers],
    ['contacts.renderSuppliers', con.renderSuppliers],
    ['sales.renderSales', sal.renderSales],
    ['sales.renderPurchases', sal.renderPurchases],
    ['accounting.renderAccounting', acc.renderAccounting],
    ['accounting.renderShifts', acc.renderShifts],
    ['ai.renderAi', ai.renderAi],
    ['ai.renderReports', ai.renderReports],
    ['admin.renderAdmin', adm.renderAdmin],
    ['activity.renderActivity', act.renderActivity],
  ];

  let pass = 0, fail = 0;
  for (const [name, fn] of jobs) {
    try {
      await fn(el());
      console.log('OK   ' + name);
      pass++;
    } catch (e) {
      console.log('FAIL ' + name + ' => ' + (e && e.stack || e));
      fail++;
    }
  }
  await sleep(1500);
  console.log(`\n${pass} ok, ${fail} fail, ${unhandled.length} async-fail`);
  child.kill();
  process.exit(fail || unhandled.length ? 1 : 0);
}

setTimeout(() => main().catch((e) => { console.error('FATAL', e); child.kill(); process.exit(1); }), 1500);
