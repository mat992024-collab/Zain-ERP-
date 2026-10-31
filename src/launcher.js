const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { start } = require('./server/index');

const LOG_FILE = path.join(__dirname, '..', 'launcher.log');

function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
}

function resolveBrowser() {
  const env = process.env;
  const sysDrive = env.SystemDrive || 'C:';
  const progFiles = env.ProgramFiles || `${sysDrive}\\Program Files`;
  const progFilesX86 = env['ProgramFiles(x86)'] || `${sysDrive}\\Program Files (x86)`;
  const localApp = env.LOCALAPPDATA || '';

  const candidates = [
    path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    localApp ? path.join(localApp, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
    path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localApp ? path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(progFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    localApp ? path.join(localApp, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'D:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'D:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'D:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

async function main() {
  log(`Starting Zain ERP launcher on ${process.platform} ${process.arch} node ${process.version}`);
  const port = Number(process.env.ZAIN_PORT || 4782);
  const host = process.env.ZAIN_HOST || '0.0.0.0';
  let p = port;
  try {
    const s = await start(port, host);
    p = s.port;
  } catch (err) {
    log(`Failed to start server: ${err.message}`);
    process.exit(1);
  }

  const url = `http://127.0.0.1:${p}`;
  log(`Server listening on ${url}`);

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url + '/');
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  const exe = resolveBrowser();
  const args = [
    `--app=${url}`,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-dev-shm-usage',
  ];

  if (exe) {
    log(`Spawning browser: ${exe} --app=${url}`);
    const proc = spawn(exe, args, { stdio: 'ignore', windowsHide: false });
    proc.on('exit', () => {
      log('Browser window closed, exiting launcher');
      process.exit(0);
    });
    proc.on('error', (err) => {
      log(`Browser launch error: ${err.message}, falling back to system default`);
      if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true });
      }
    });
  } else {
    log(`No Chromium browser executable found. Opening system default browser for ${url}`);
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true });
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore' });
    }
  }

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1e7);
}

if (require.main === module) {
  main();
}
