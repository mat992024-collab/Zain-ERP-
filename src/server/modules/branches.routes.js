const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const { pick } = require('../core/crud');

const FIELDS = ['code', 'name', 'phone', 'address', 'is_active'];

module.exports = {
  register(router) {
    router.get('/api/branches', (ctx) => {
      const rows = db.all('SELECT * FROM branches ORDER BY id ASC');
      sendJson(ctx.res, 200, { rows, total: rows.length });
    });

    router.get('/api/branches/:id', (ctx) => {
      const row = db.get('SELECT * FROM branches WHERE id = ?', [ctx.params.id]);
      if (!row) throw new HttpError(404, 'الفرع غير موجود');
      sendJson(ctx.res, 200, { branch: row });
    });

    router.post('/api/branches', (ctx) => {
      if (!ctx.can('admin.settings') && !ctx.can('admin.users')) throw new HttpError(403, 'لا تملك صلاحية إدارة الفروع');
      const data = pick(ctx.body || {}, FIELDS);
      if (!data.name || !data.code) throw new HttpError(400, 'اسم الفرع وكوده مطلوبان');
      const exists = db.get('SELECT id FROM branches WHERE code = ?', [String(data.code).trim()]);
      if (exists) throw new HttpError(400, 'كود الفرع مستخدم مسبقاً');
      const res = db.run(
        `INSERT INTO branches (code, name, phone, address, is_active) VALUES (?, ?, ?, ?, ?)`,
        [String(data.code).trim(), String(data.name).trim(), data.phone || '', data.address || '', data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1]
      );
      db.logActivity(ctx.user.id, 'create', 'branches', res.lastInsertRowid, { code: data.code, name: data.name });
      const branch = db.get('SELECT * FROM branches WHERE id = ?', [res.lastInsertRowid]);
      sendJson(ctx.res, 201, { branch });
    });

    router.put('/api/branches/:id', (ctx) => {
      if (!ctx.can('admin.settings') && !ctx.can('admin.users')) throw new HttpError(403, 'لا تملك صلاحية إدارة الفروع');
      const existing = db.get('SELECT * FROM branches WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'الفرع غير موجود');
      const data = pick(ctx.body || {}, FIELDS);
      const code = data.code ? String(data.code).trim() : existing.code;
      const name = data.name ? String(data.name).trim() : existing.name;
      const phone = data.phone !== undefined ? data.phone : existing.phone;
      const address = data.address !== undefined ? data.address : existing.address;
      const isActive = data.is_active !== undefined ? (data.is_active ? 1 : 0) : existing.is_active;

      const codeConflict = db.get('SELECT id FROM branches WHERE code = ? AND id != ?', [code, existing.id]);
      if (codeConflict) throw new HttpError(400, 'كود الفرع مستخدم في فرع آخر');

      db.run(
        `UPDATE branches SET code = ?, name = ?, phone = ?, address = ?, is_active = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [code, name, phone, address, isActive, existing.id]
      );
      db.logActivity(ctx.user.id, 'update', 'branches', existing.id, { code, name });
      const updated = db.get('SELECT * FROM branches WHERE id = ?', [existing.id]);
      sendJson(ctx.res, 200, { branch: updated });
    });

    router.delete('/api/branches/:id', (ctx) => {
      if (!ctx.can('admin.settings')) throw new HttpError(403, 'لا تملك صلاحية إدارة الفروع');
      const existing = db.get('SELECT * FROM branches WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'الفرع غير موجود');
      const count = db.get('SELECT COUNT(*) AS c FROM branches').c;
      if (count <= 1) throw new HttpError(400, 'لا يمكن حذف الفرع الوحيد المتبقي');

      const hasInvoices = db.get('SELECT id FROM invoices WHERE branch = ? LIMIT 1', [existing.name]);
      const hasWorkOrders = db.get('SELECT id FROM work_orders WHERE branch_name = ? LIMIT 1', [existing.name]);
      if (hasInvoices || hasWorkOrders) {
        throw new HttpError(400, 'لا يمكن حذف الفرع لاحتوائه على فواتير أو أوامر شغل سابقة؛ يمكنك إلغاء تفعيله بدلاً من ذلك لحماية الحسابات');
      }

      db.run('DELETE FROM branches WHERE id = ?', [existing.id]);
      db.logActivity(ctx.user.id, 'delete', 'branches', existing.id, { name: existing.name });
      sendJson(ctx.res, 200, { ok: true });
    });
  },
};
