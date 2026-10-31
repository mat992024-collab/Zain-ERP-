const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const license = require('../core/license');

module.exports = {
  register(router) {
    router.get('/api/license/status', (ctx) => {
      const status = license.getLicenseStatus(db);
      sendJson(ctx.res, 200, status);
    });

    router.post('/api/license/activate', (ctx) => {
      const key = (ctx.body || {}).license_key || (ctx.body || {}).key;
      if (!key) throw new HttpError(400, 'يرجى إدخال رمز التفعيل');
      const res = license.activateLicense(db, key);
      if (!res.valid) {
        throw new HttpError(400, res.error || 'رمز التفعيل غير صالح');
      }
      db.logActivity(ctx.user ? ctx.user.id : 1, 'license_activate', 'settings', null, { type: res.type, expires_at: res.expires_at });
      sendJson(ctx.res, 200, { ok: true, license: res });
    });

    router.get('/api/license/machine-id', (ctx) => {
      sendJson(ctx.res, 200, { machine_id: license.getMachineId() });
    });
  },
};
