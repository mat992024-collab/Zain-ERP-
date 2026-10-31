const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const cloudSync = require('../core/cloud-sync');

module.exports = {
  register(router) {
    router.get('/api/sync/status', (ctx) => {
      if (!ctx.user) throw new HttpError(401, 'يجب تسجيل الدخول');
      sendJson(ctx.res, 200, cloudSync.getStatus());
    });

    router.post('/api/sync/trigger', async (ctx) => {
      if (!ctx.user) throw new HttpError(401, 'يجب تسجيل الدخول');
      if (!ctx.can('admin') && !ctx.can('settings.write')) throw new HttpError(403, 'غير مسموح');
      const result = await cloudSync.syncNow();
      sendJson(ctx.res, 200, result);
    });

    router.post('/api/sync/config', (ctx) => {
      if (!ctx.user) throw new HttpError(401, 'يجب تسجيل الدخول');
      if (!ctx.can('admin') && !ctx.can('settings.write')) throw new HttpError(403, 'غير مسموح');
      const b = ctx.body || {};
      if (b.enabled !== undefined) db.setSetting('cloud_sync_enabled', b.enabled ? '1' : '0');
      if (b.url !== undefined) db.setSetting('cloud_sync_url', String(b.url || '').trim());
      if (b.api_key !== undefined) db.setSetting('cloud_sync_api_key', String(b.api_key || '').trim());
      if (b.interval !== undefined) db.setSetting('cloud_sync_interval', String(Number(b.interval) || 30));
      sendJson(ctx.res, 200, { ok: true, status: cloudSync.getStatus() });
    });

    router.get('/api/sync/queue', (ctx) => {
      if (!ctx.user) throw new HttpError(401, 'يجب تسجيل الدخول');
      if (!ctx.can('admin')) throw new HttpError(403, 'غير مسموح');
      const rows = db.all(
        `SELECT id, entity, entity_id, action, branch, status, attempts, last_error, created_at, synced_at
         FROM sync_queue
         ORDER BY id DESC
         LIMIT 100`
      );
      sendJson(ctx.res, 200, { rows, total: rows.length });
    });

    router.post('/api/sync/receive', (ctx) => {
      const b = ctx.body || {};
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) {
        sendJson(ctx.res, 200, { ok: true, received: 0 });
        return;
      }
      cloudSync.applyInbound(items);
      sendJson(ctx.res, 200, { ok: true, received: items.length });
    });
  },
};
