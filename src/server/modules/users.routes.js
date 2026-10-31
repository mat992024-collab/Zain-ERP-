const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const auth = require('../core/auth');
const { pick, buildInsert, buildUpdate, list } = require('../core/crud');

const FIELDS = ['username', 'full_name', 'role', 'phone', 'permissions', 'branch'];

module.exports = {
  register(router) {
    router.get('/api/users', (ctx) => {
      if (!ctx.can('admin.users')) throw new HttpError(403, 'لا تملك صلاحية الإدارة');
      const { search, role, branch, page = 1, page_size = 100 } = ctx.query;
      const where = [];
      const params = [];
      if (role) { where.push('role = ?'); params.push(role); }
      if (branch) { where.push('branch = ?'); params.push(branch); }
      const limit = Math.min(Number(page_size) || 100, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const result = list('users', {
        where, params, order: 'id ASC', limit, offset,
        search, searchCols: ['username', 'full_name', 'phone', 'branch'],
      });
      for (const row of result.rows) {
        row.permissions = (() => { try { return JSON.parse(row.permissions || '[]'); } catch { return []; } })();
      }
      sendJson(ctx.res, 200, result);
    });

    router.post('/api/users', (ctx) => {
      if (!ctx.can('admin.users')) throw new HttpError(403, 'لا تملك صلاحية الإدارة');
      const data = pick(ctx.body || {}, FIELDS);
      const password = (ctx.body || {}).password;
      if (!data.username || !data.full_name || !password) throw new HttpError(400, 'معلومات المستخدم غير مكتملة');
      const exists = db.get('SELECT id FROM users WHERE username = ?', [String(data.username).trim()]);
      if (exists) throw new HttpError(400, 'اسم المستخدم موجود مسبقاً');
      data.username = String(data.username).trim();
      data.role = data.role || 'cashier';
      data.branch = data.branch || db.getSetting('active_branch', 'الفرع الرئيسي');
      data.permissions = JSON.stringify(Array.isArray(ctx.body.permissions) ? ctx.body.permissions : []);
      const { hash, salt } = db.hashPassword(password);
      const res = db.run(
        `INSERT INTO users (username, full_name, password_hash, password_salt, role, permissions, phone, branch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.username, data.full_name, hash, salt, data.role, data.permissions, data.phone || null, data.branch]
      );
      db.logActivity(ctx.user.id, 'create', 'users', res.lastInsertRowid, { username: data.username, branch: data.branch });
      sendJson(ctx.res, 201, { user: { id: res.lastInsertRowid, ...data, permissions: JSON.parse(data.permissions) } });
    });

    router.put('/api/users/:id', (ctx) => {
      if (!ctx.can('admin.users')) throw new HttpError(403, 'لا تملك صلاحية الإدارة');
      const existing = db.get('SELECT * FROM users WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'المستخدم غير موجود');
      const data = pick(ctx.body || {}, FIELDS);
      if ('password' in ctx.body && ctx.body.password) {
        const { hash, salt } = db.hashPassword(ctx.body.password);
        db.run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, existing.id]);
      }
      if ('permissions' in ctx.body) data.permissions = JSON.stringify(Array.isArray(ctx.body.permissions) ? ctx.body.permissions : []);
      data.username = String(data.username || existing.username).trim();
      data.full_name = data.full_name || existing.full_name;
      data.role = data.role || existing.role;
      const { sql, values } = buildUpdate('users', existing.id, data);
      db.run(sql, values);
      db.logActivity(ctx.user.id, 'update', 'users', existing.id);
      sendJson(ctx.res, 200, { user: { id: existing.id, ...data, permissions: Array.isArray(ctx.body.permissions) ? ctx.body.permissions : JSON.parse(existing.permissions || '[]') } });
    });

    router.patch('/api/users/:id/status', (ctx) => {
      if (!ctx.can('admin.users')) throw new HttpError(403, 'لا تملك صلاحية الإدارة');
      const existing = db.get('SELECT * FROM users WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'المستخدم غير موجود');
      if (existing.id === ctx.user.id) throw new HttpError(400, 'لا يمكنك تعطيل حسابك');
      const active = (ctx.body || {}).is_active ? 1 : 0;
      db.run('UPDATE users SET is_active = ? WHERE id = ?', [active, existing.id]);
      db.logActivity(ctx.user.id, 'status', 'users', existing.id, { active });
      sendJson(ctx.res, 200, { ok: true });
    });
  },
};
