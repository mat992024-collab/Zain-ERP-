const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { start } = require('./server/index');

function resolveEdge() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function main() {
  const port = Number(process.env.ZAIN_PORT || 4782);
  const host = process.env.ZAIN_HOST || '0.0.0.0';
  const { port: p } = await start(port, host);
  const url = `http://127.0.0.1:${p}`;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url + '/');
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const exe = resolveEdge();
  const args = [`--app=${url}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-dev-shm-usage'];
  if (exe) {
    console.log('Launching Zain ERP:', exe);
    const proc = spawn(exe, args, { stdio: 'ignore' });
    proc.on('exit', () => process.exit(0));
  } else {
    console.log('Zain ERP running:', url);
    console.log('No Edge/Chrome found; open in your browser.');
  }
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1e7);
}

if (require.main === module) {
  main();
}
