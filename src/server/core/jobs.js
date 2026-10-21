const backup = require('../modules/backup.routes');

function autoBackupDue(state, now = new Date()) {
  if (!state.enabled) return false;
  const [hh, mm] = String(state.time).split(':').map((n) => Number(n) || 0);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < (hh || 0) * 60 + (mm || 0)) return false;
  return state.last !== state.today;
}

function runAutoBackup() {
  try {
    const state = backup.autoState();
    if (!autoBackupDue(state)) return null;
    return backup.createAutoSnapshot();
  } catch (err) {
    console.error('[zain] auto backup failed:', err.message);
    return null;
  }
}

function start() {
  const kick = setTimeout(() => { runAutoBackup(); }, 8000);
  kick.unref();
  const timer = setInterval(() => { runAutoBackup(); }, 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { start, runAutoBackup, autoBackupDue };
