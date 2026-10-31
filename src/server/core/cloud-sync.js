const db = require('../db');

function enqueue(entity, entityId, action, payload = {}, branch = 'الفرع الرئيسي') {
  try {
    const pl = typeof payload === 'string' ? payload : JSON.stringify(payload);
    db.run(
      `INSERT INTO sync_queue (entity, entity_id, action, payload, branch, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [entity, entityId || null, action, pl, branch || 'الفرع الرئيسي']
    );
  } catch {}
}

function getStatus() {
  const enabled = db.getSetting('cloud_sync_enabled', '0') === '1';
  const url = db.getSetting('cloud_sync_url', '');
  const lastRun = db.getSetting('cloud_sync_last_run', '');
  const statusSetting = db.getSetting('cloud_sync_status', 'idle');
  const counts = db.get(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) AS synced,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM sync_queue`
  ) || {};

  return {
    enabled,
    url,
    status: statusSetting,
    pending: counts.pending || 0,
    synced: counts.synced || 0,
    failed: counts.failed || 0,
    last_run: lastRun,
  };
}

async function syncNow() {
  const enabled = db.getSetting('cloud_sync_enabled', '0') === '1';
  const url = db.getSetting('cloud_sync_url', '');
  const apiKey = db.getSetting('cloud_sync_api_key', '');
  const pendingRows = db.all(
    `SELECT id, entity, entity_id, action, payload, branch, created_at, attempts
     FROM sync_queue
     WHERE status = 'pending'
     ORDER BY id ASC
     LIMIT 50`
  );

  const now = db.get("SELECT datetime('now','localtime') AS t").t;
  db.setSetting('cloud_sync_last_run', now);

  if (!url) {
    db.setSetting('cloud_sync_status', 'idle');
    return { ok: true, synced: 0, pending: pendingRows.length, status: 'idle', message: 'لم يتم ضبط عنوان السيرفر السحابي' };
  }

  if (!pendingRows.length) {
    db.setSetting('cloud_sync_status', 'synced');
    return { ok: true, synced: 0, pending: 0, status: 'synced', message: 'جميع البيانات متزامنة محلياً' };
  }

  try {
    const payloadItems = pendingRows.map((r) => {
      let data = {};
      try { data = JSON.parse(r.payload); } catch {}
      return { id: r.id, entity: r.entity, entity_id: r.entity_id, action: r.action, branch: r.branch, data, created_at: r.created_at };
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey ? `Bearer ${apiKey}` : '',
        'X-Branch': db.getSetting('active_branch', 'الفرع الرئيسي'),
      },
      body: JSON.stringify({
        branch: db.getSetting('active_branch', 'الفرع الرئيسي'),
        items: payloadItems,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Cloud server returned HTTP ${res.status}`);
    }

    const resData = await res.json().catch(() => ({}));
    const ids = pendingRows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');

    db.run(
      `UPDATE sync_queue
       SET status = 'synced', synced_at = datetime('now','localtime')
       WHERE id IN (${placeholders})`,
      ids
    );

    if (Array.isArray(resData.inbound) && resData.inbound.length) {
      applyInbound(resData.inbound);
    }

    db.setSetting('cloud_sync_status', 'synced');
    return { ok: true, synced: ids.length, pending: 0, status: 'synced' };
  } catch (err) {
    const ids = pendingRows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.run(
      `UPDATE sync_queue
       SET attempts = attempts + 1, last_error = ?
       WHERE id IN (${placeholders})`,
      [err.message, ...ids]
    );

    const isOffline = /abort|fetch failed|connect|ECONNREFUSED|ENOTFOUND/i.test(err.message || '');
    const newStatus = isOffline ? 'offline' : 'error';
    db.setSetting('cloud_sync_status', newStatus);

    return {
      ok: false,
      synced: 0,
      pending: pendingRows.length,
      status: newStatus,
      error: err.message,
    };
  }
}

function applyInbound(items) {
  db.tx(() => {
    for (const item of items) {
      if (item.entity === 'products' && item.data) {
        const p = item.data;
        if (!p.name) continue;
        const exists = p.barcode ? db.get('SELECT id FROM products WHERE barcode = ?', [p.barcode]) : null;
        if (!exists) {
          db.run(
            `INSERT INTO products (name, barcode, category, unit, cost_price, sale_price, quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [p.name, p.barcode || null, p.category || 'عام', p.unit || 'قطعة', p.cost_price || 0, p.sale_price || 0, p.quantity || 0]
          );
        }
      }
    }
  });
}

module.exports = { enqueue, getStatus, syncNow, applyInbound };
