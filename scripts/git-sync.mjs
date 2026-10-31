import { watch } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

let timer = null;
let syncing = false;

async function doSync() {
  if (syncing) return;
  syncing = true;
  try {
    const { stdout: status } = await execAsync('git status -s');
    if (!status.trim()) {
      syncing = false;
      return;
    }
    const d = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await execAsync('git add -A');
    await execAsync(`git commit -m "auto: update ${d}"`);
    console.log(`[Auto-Sync] تم حفظ التعديلات محلياً`);
    const { stdout: remotes } = await execAsync('git remote');
    if (remotes.includes('origin')) {
      console.log(`[Auto-Sync] جاري الرفع إلى GitHub...`);
      await execAsync('git push origin master');
      console.log(`[Auto-Sync] تم الرفع والمزامنة مع GitHub بنجاح`);
    }
  } catch (err) {
    console.error('[Auto-Sync Error]', err.message);
  } finally {
    syncing = false;
  }
}

function queueSync() {
  clearTimeout(timer);
  timer = setTimeout(doSync, 3000);
}

console.log('[Auto-Sync] جاري مراقبة التعديلات لرفعها تلقائياً إلى GitHub...');
watch('src', { recursive: true }, queueSync);
watch('tests', { recursive: true }, queueSync);
