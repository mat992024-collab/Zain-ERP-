const db = require('../db');
const { sendJson, HttpError } = require('../core/http');

const ACTION_LABELS = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  sale: 'بيع',
  purchase: 'شراء',
  sale_return: 'مرتجع بيع',
  purchase_return: 'مرتجع شراء',
  credit_limit_override: 'تجاوز حد ائتمان',
  installment_pay: 'سداد قسط',
  voucher_create: 'إنشاء سند',
  voucher_cancel: 'إلغاء سند',
  transfer: 'تحويل بين الحسابات',
  expense: 'مصروف',
  backup_create: 'نسخة احتياطية',
  backup_restore: 'استعادة نسخة',
  reminder_create: 'إنشاء تذكير',
  reminder_update: 'تعديل تذكير',
  reminder_delete: 'حذف تذكير',
  login: 'دخول',
  logout: 'خروج',
};

module.exports = {
  ACTION_LABELS,
  register(router) {
    router.get('/api/activity', (ctx) => {
      if (!ctx.can('activity.view') && !ctx.can('admin.users')) {
        throw new HttpError(403, 'لا تملك صلاحية عرض سجل النشاط');
      }
      const { user_id, action, from, to, search, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];
      if (user_id) { where.push('l.user_id = ?'); params.push(user_id); }
      if (action) { where.push('l.action = ?'); params.push(action); }
      if (from) { where.push('date(l.created_at) >= date(?)'); params.push(from); }
      if (to) { where.push('date(l.created_at) <= date(?)'); params.push(to); }
      if (search) {
        where.push('(l.action LIKE ? OR l.entity LIKE ? OR u.username LIKE ? OR l.details LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const total = db.get(
        `SELECT COUNT(*) AS c FROM activity_log l LEFT JOIN users u ON u.id = l.user_id ${whereSql}`,
        params
      ).c;
      const rows = db.all(
        `SELECT l.id, l.created_at, l.action, l.entity, l.entity_id, l.details, l.user_id,
                u.username, u.full_name
         FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
         ${whereSql} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const byAction = db.all(
        `SELECT action, COUNT(*) AS count FROM activity_log GROUP BY action ORDER BY count DESC`
      );
      const users = db.all('SELECT id, username, full_name FROM users ORDER BY full_name');
      sendJson(ctx.res, 200, {
        rows, total, by_action: byAction, users,
        page: Math.max(Number(page) || 1, 1),
        page_size: limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      });
    });
  },
};
