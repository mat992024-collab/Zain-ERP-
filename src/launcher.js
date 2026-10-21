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
  const port = Number(process.env.ZAIN_PORT || 4180);
  const { port: p } = await start(port);
  const url = `http://127.0.0.1:${p}`;
  const exe = resolveEdge();
  const args = [`--app=${url}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-dev-shm-usage'];
  if (exe) {
    console.log('Launching Zain ERP:', exe);
    spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
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
