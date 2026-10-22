const backup = require('../modules/backup.routes');
const reminders = require('../modules/reminders.routes');
const scheduled = require('../modules/scheduled.routes');
const db = require('../db');

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

function digestDue(now = new Date()) {
  const s = db.getSettings();
  const [hh, mm] = String(s.reminder_daily_time || '08:00').split(':').map((n) => Number(n) || 0);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < (hh || 0) * 60 + (mm || 0)) return false;
  return s.reminder_last_digest_at !== reminders.localDate(now);
}

function runDailyDigest() {
  try {
    if (!digestDue()) return null;
    const digest = reminders.buildDigest();
    db.setSetting('reminder_last_digest', digest.text, 'reminders');
    db.setSetting('reminder_last_digest_at', digest.date, 'reminders');
    markDueRemindersRun();
    return digest;
  } catch (err) {
    console.error('[zain] daily digest failed:', err.message);
    return null;
  }
}

function markDueRemindersRun() {
  const due = db.all(
    `SELECT * FROM reminders WHERE active = 1 AND next_run IS NOT NULL AND next_run <= datetime('now','localtime')`
  );
  for (const row of due) {
    db.run("UPDATE reminders SET last_run = datetime('now','localtime'), next_run = ? WHERE id = ?", [
      row.repeat_type === 'once' ? null : reminders.nextRunFor(row),
      row.id,
    ]);
  }
}

let timer = null;

function markOverdueInstallments() {
  try {
    const due = db.all(
      `SELECT id FROM installments WHERE status = 'active' AND remaining > 0.001
       AND due_date IS NOT NULL AND date(due_date) < date('now','localtime')`
    );
    if (!due.length) return 0;
    db.run(
      `UPDATE installments SET status = 'overdue' WHERE status = 'active' AND remaining > 0.001
       AND due_date IS NOT NULL AND date(due_date) < date('now','localtime')`
    );
    db.logActivity(null, 'installments_overdue', 'installments', null, { count: due.length });
    return due.length;
  } catch (err) {
    console.error('[zain] overdue installments failed:', err.message);
    return 0;
  }
}

function runScheduledInvoices() {
  try {
    return scheduled.runDue(null);
  } catch (err) {
    console.error('[zain] scheduled invoices failed:', err.message);
    return [];
  }
}

function tick() {
  runAutoBackup();
  runDailyDigest();
  runScheduledInvoices();
  markOverdueInstallments();
}

function start() {
  const kick = setTimeout(tick, 8000);
  kick.unref();
  timer = setInterval(tick, 60 * 1000);
  timer.unref();
  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  start, stop, tick,
  runAutoBackup, autoBackupDue,
  runDailyDigest, digestDue,
  runScheduledInvoices, markOverdueInstallments,
};
