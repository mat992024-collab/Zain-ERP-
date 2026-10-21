const db = require('../db');
const auth = require('../core/auth');
const { sendJson, HttpError } = require('../core/http');

module.exports = {
  register(router) {
    router.post('/api/auth/login', (ctx) => {
      const { username, password } = ctx.body || {};
      if (!username || !password) throw new HttpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');
      const result = auth.login(username, password);
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `zain_token=${encodeURIComponent(result.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`,
        'Cache-Control': 'no-store',
      });
      ctx.res.end(JSON.stringify(result));
    }, { auth: false });

    router.post('/api/auth/logout', (ctx) => {
      if (ctx.token) auth.destroySession(ctx.token);
      sendJson(ctx.res, 200, { ok: true });
    }, { auth: false });

    router.get('/api/auth/me', (ctx) => {
      sendJson(ctx.res, 200, { user: ctx.user });
    });

    router.post('/api/auth/change-password', (ctx) => {
      const { current_password, new_password } = ctx.body || {};
      if (!new_password || String(new_password).length < 4) {
        throw new HttpError(400, 'كلمة المرور الجديدة قصيرة جداً');
      }
      const row = db.get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
      if (!db.verifyPassword(current_password || '', row.password_salt, row.password_hash)) {
        throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
      }
      const { hash, salt } = db.hashPassword(new_password);
      db.run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, ctx.user.id]);
      db.logActivity(ctx.user.id, 'change_password', 'users', ctx.user.id);
      sendJson(ctx.res, 200, { ok: true });
    });
  },
};
