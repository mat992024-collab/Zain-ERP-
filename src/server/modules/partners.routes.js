const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const { pick, buildInsert, buildUpdate, list } = require('../core/crud');

const FIELDS = ['name', 'phone', 'share_percent', 'capital', 'balance', 'notes', 'is_active'];

function normalize(data) {
  const out = pick(data, FIELDS);
  for (const k of ['share_percent', 'capital', 'balance']) {
    if (k in out) out[k] = Number(out[k]) || 0;
  }
  if ('is_active' in out) out.is_active = out.is_active ? 1 : 0;
  return out;
}

module.exports = {
  register(router) {
    router.get('/api/partners', (ctx) => {
      const { search, page = 1, page_size = 100 } = ctx.query;
      const limit = Math.min(Number(page_size) || 100, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const result = list('partners', {
        where: ['is_active = 1'], params: [], order: 'name ASC', limit, offset,
        search, searchCols: ['name', 'phone'],
      });
      const capital = db.get('SELECT COALESCE(SUM(capital), 0) AS c FROM partners WHERE is_active = 1').c;
      sendJson(ctx.res, 200, { ...result, total_capital: capital });
    });

    router.post('/api/partners', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الإضافة');
      const data = normalize(ctx.body || {});
      if (!data.name) throw new HttpError(400, 'اسم الشريك مطلوب');
      const { sql, values } = buildInsert('partners', data);
      const res = db.run(sql, values);
      db.logActivity(ctx.user.id, 'create', 'partners', res.lastInsertRowid, { name: data.name });
      sendJson(ctx.res, 201, { partner: db.get('SELECT * FROM partners WHERE id = ?', [res.lastInsertRowid]) });
    });

    router.put('/api/partners/:id', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية التعديل');
      const existing = db.get('SELECT * FROM partners WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'الشريك غير موجود');
      const data = normalize(ctx.body || {});
      const { sql, values } = buildUpdate('partners', existing.id, data);
      db.run(sql, values);
      db.logActivity(ctx.user.id, 'update', 'partners', existing.id);
      sendJson(ctx.res, 200, { partner: db.get('SELECT * FROM partners WHERE id = ?', [existing.id]) });
    });

    router.delete('/api/partners/:id', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الحذف');
      const existing = db.get('SELECT * FROM partners WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'الشريك غير موجود');
      db.run('UPDATE partners SET is_active = 0 WHERE id = ?', [existing.id]);
      sendJson(ctx.res, 200, { ok: true });
    });
  },
};
