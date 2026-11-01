const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const { pick } = require('../core/crud');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const FIELDS = [
  'customer_id', 'customer_name', 'customer_phone', 'title', 'description',
  'material', 'width', 'height', 'quantity', 'total_area',
  'unit_cost', 'unit_price', 'total_cost', 'total_price', 'deposit', 'remaining',
  'priority', 'status', 'receive_date', 'delivery_date', 'design_file',
  'branch_name', 'assigned_worker', 'notes'
];

function generateOrderNo(branchName) {
  const prefix = branchName && branchName.includes('2') ? 'ORD-B2' : 'ORD-B1';
  const d = new Date();
  const year = d.getFullYear();
  const countRow = db.get("SELECT COUNT(*) AS c FROM work_orders WHERE order_no LIKE ?", [`${prefix}-${year}-%`]);
  const seq = String((countRow ? countRow.c : 0) + 1).padStart(5, '0');
  return `${prefix}-${year}-${seq}`;
}

module.exports = {
  register(router) {
    router.get('/api/work-orders', (ctx) => {
      const { status, branch, priority, search, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];

      if (status) { where.push('status = ?'); params.push(status); }
      if (branch) { where.push('branch_name = ?'); params.push(branch); }
      if (priority) { where.push('priority = ?'); params.push(priority); }
      if (search) {
        where.push('(order_no LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR title LIKE ?)');
        const s = `%${search}%`;
        params.push(s, s, s, s);
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Number(page_size) || 50, 200);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

      const total = db.get(`SELECT COUNT(*) AS c FROM work_orders ${whereClause}`, params).c;
      const rows = db.all(
        `SELECT w.*, u.full_name AS worker_name, c.name AS customer_full_name
         FROM work_orders w
         LEFT JOIN users u ON u.id = w.assigned_worker
         LEFT JOIN customers c ON c.id = w.customer_id
         ${whereClause}
         ORDER BY 
           CASE w.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END ASC,
           w.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      sendJson(ctx.res, 200, { rows, total, page: Number(page) || 1, page_size: limit });
    });

    router.get('/api/work-orders/stats', (ctx) => {
      const branch = ctx.query.branch;
      const where = branch ? 'WHERE branch_name = ?' : '';
      const params = branch ? [branch] : [];

      const byStatus = db.all(
        `SELECT status, COUNT(*) AS count, SUM(total_price) AS total_amount, SUM(remaining) AS total_remaining
         FROM work_orders ${where} GROUP BY status`,
        params
      );
      const totalOrders = db.get(`SELECT COUNT(*) AS c FROM work_orders ${where}`, params).c;
      const urgentOrders = db.get(`SELECT COUNT(*) AS c FROM work_orders ${where ? where + ' AND' : 'WHERE'} priority IN ('urgent', 'high') AND status IN ('in_progress', 'ready')`, params).c;

      sendJson(ctx.res, 200, { byStatus, totalOrders, urgentOrders });
    });

    router.get('/api/work-orders/:id', (ctx) => {
      const order = db.get(
        `SELECT w.*, u.full_name AS worker_name, c.name AS customer_full_name
         FROM work_orders w
         LEFT JOIN users u ON u.id = w.assigned_worker
         LEFT JOIN customers c ON c.id = w.customer_id
         WHERE w.id = ?`,
        [ctx.params.id]
      );
      if (!order) throw new HttpError(404, 'أمر الشغل غير موجود');
      const logs = db.all(
        `SELECT l.*, u.full_name AS user_name
         FROM work_order_logs l
         LEFT JOIN users u ON u.id = l.user_id
         WHERE l.work_order_id = ?
         ORDER BY l.id ASC`,
        [order.id]
      );
      sendJson(ctx.res, 200, { order, logs });
    });

    router.post('/api/work-orders', (ctx) => {
      const data = pick(ctx.body || {}, FIELDS);
      if (!data.title) throw new HttpError(400, 'عنوان أمر الشغل مطلوب');
      if (!data.customer_name) throw new HttpError(400, 'اسم العميل مطلوب');

      const width = Number(data.width) || 0;
      const height = Number(data.height) || 0;
      const quantity = Math.max(Number(data.quantity) || 1, 1);
      const totalArea = width > 0 && height > 0 ? Number((width * height * quantity).toFixed(4)) : Number(data.total_area) || 0;

      const unitCost = Number(data.unit_cost) || 0;
      const unitPrice = Number(data.unit_price) || 0;
      const totalCost = totalArea > 0 ? Number((totalArea * unitCost).toFixed(2)) : Number((quantity * unitCost).toFixed(2));
      const totalPrice = totalArea > 0 ? Number((totalArea * unitPrice).toFixed(2)) : (Number(data.total_price) || Number((quantity * unitPrice).toFixed(2)));
      const deposit = Math.max(Number(data.deposit) || 0, 0);
      const remaining = Math.max(totalPrice - deposit, 0);

      const branchName = data.branch_name || (ctx.user ? ctx.user.branch : null) || 'الفرع الرئيسي';
      const orderNo = generateOrderNo(branchName);

      const res = db.run(
        `INSERT INTO work_orders (
          order_no, customer_id, customer_name, customer_phone, title, description,
          material, width, height, quantity, total_area, unit_cost, unit_price,
          total_cost, total_price, deposit, remaining, priority, status,
          receive_date, delivery_date, design_file, branch_name, created_by,
          assigned_worker, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderNo, data.customer_id || null, data.customer_name.trim(), data.customer_phone || null,
          data.title.trim(), data.description || null, data.material || null,
          width, height, quantity, totalArea, unitCost, unitPrice,
          totalCost, totalPrice, deposit, remaining, data.priority || 'normal',
          data.status || 'in_progress', data.receive_date || new Date().toISOString().slice(0, 19).replace('T', ' '),
          data.delivery_date || null, data.design_file || null, branchName,
          ctx.user ? ctx.user.id : null, data.assigned_worker || null, data.notes || null
        ]
      );

      const orderId = res.lastInsertRowid;
      db.run(
        `INSERT INTO work_order_logs (work_order_id, user_id, from_status, to_status, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, ctx.user ? ctx.user.id : null, null, data.status || 'in_progress', 'إنشاء أمر شغل جديد']
      );

      db.logActivity(ctx.user ? ctx.user.id : null, 'create', 'work_orders', orderId, { order_no: orderNo, title: data.title, branch: branchName });

      const created = db.get('SELECT * FROM work_orders WHERE id = ?', [orderId]);
      sendJson(ctx.res, 201, { order: created });
    });

    router.put('/api/work-orders/:id', (ctx) => {
      const existing = db.get('SELECT * FROM work_orders WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'أمر الشغل غير موجود');

      const data = pick(ctx.body || {}, FIELDS);
      const width = data.width !== undefined ? Number(data.width) || 0 : existing.width;
      const height = data.height !== undefined ? Number(data.height) || 0 : existing.height;
      const quantity = data.quantity !== undefined ? Math.max(Number(data.quantity) || 1, 1) : existing.quantity;
      const totalArea = width > 0 && height > 0 ? Number((width * height * quantity).toFixed(4)) : (data.total_area !== undefined ? Number(data.total_area) || 0 : existing.total_area);

      const unitCost = data.unit_cost !== undefined ? Number(data.unit_cost) || 0 : existing.unit_cost;
      const unitPrice = data.unit_price !== undefined ? Number(data.unit_price) || 0 : existing.unit_price;
      const totalCost = totalArea > 0 ? Number((totalArea * unitCost).toFixed(2)) : Number((quantity * unitCost).toFixed(2));
      const totalPrice = data.total_price !== undefined ? Number(data.total_price) || 0 : (totalArea > 0 ? Number((totalArea * unitPrice).toFixed(2)) : Number((quantity * unitPrice).toFixed(2)));
      const deposit = data.deposit !== undefined ? Math.max(Number(data.deposit) || 0, 0) : existing.deposit;
      const remaining = Math.max(totalPrice - deposit, 0);

      db.run(
        `UPDATE work_orders SET
          customer_id = ?, customer_name = ?, customer_phone = ?, title = ?, description = ?,
          material = ?, width = ?, height = ?, quantity = ?, total_area = ?,
          unit_cost = ?, unit_price = ?, total_cost = ?, total_price = ?, deposit = ?, remaining = ?,
          priority = ?, delivery_date = ?, design_file = ?, assigned_worker = ?, notes = ?,
          updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [
          data.customer_id !== undefined ? data.customer_id : existing.customer_id,
          data.customer_name ? data.customer_name.trim() : existing.customer_name,
          data.customer_phone !== undefined ? data.customer_phone : existing.customer_phone,
          data.title ? data.title.trim() : existing.title,
          data.description !== undefined ? data.description : existing.description,
          data.material !== undefined ? data.material : existing.material,
          width, height, quantity, totalArea, unitCost, unitPrice, totalCost, totalPrice, deposit, remaining,
          data.priority || existing.priority, data.delivery_date !== undefined ? data.delivery_date : existing.delivery_date,
          data.design_file !== undefined ? data.design_file : existing.design_file,
          data.assigned_worker !== undefined ? data.assigned_worker : existing.assigned_worker,
          data.notes !== undefined ? data.notes : existing.notes,
          existing.id
        ]
      );

      db.logActivity(ctx.user ? ctx.user.id : null, 'update', 'work_orders', existing.id, { order_no: existing.order_no });
      const updated = db.get('SELECT * FROM work_orders WHERE id = ?', [existing.id]);
      sendJson(ctx.res, 200, { order: updated });
    });

    router.patch('/api/work-orders/:id/status', (ctx) => {
      const existing = db.get('SELECT * FROM work_orders WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'أمر الشغل غير موجود');

      const { status, notes } = ctx.body || {};
      const validStatuses = ['in_progress', 'ready', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) throw new HttpError(400, 'حالة الطلب غير صالحة');

      db.run(
        `UPDATE work_orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [status, existing.id]
      );

      db.run(
        `INSERT INTO work_order_logs (work_order_id, user_id, from_status, to_status, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [existing.id, ctx.user ? ctx.user.id : null, existing.status, status, notes || 'تحديث حالة الطلب']
      );

      db.logActivity(ctx.user ? ctx.user.id : null, 'status_change', 'work_orders', existing.id, {
        order_no: existing.order_no,
        from: existing.status,
        to: status
      });

      const updated = db.get('SELECT * FROM work_orders WHERE id = ?', [existing.id]);
      sendJson(ctx.res, 200, { order: updated });
    });

    router.post('/api/work-orders/:id/transfer', (ctx) => {
      const existing = db.get('SELECT * FROM work_orders WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'أمر الشغل غير موجود');

      const { target_branch, reason } = ctx.body || {};
      if (!target_branch || target_branch === existing.branch_name) {
        throw new HttpError(400, 'يجب تحديد فرع مختلف للتحويل إليه');
      }

      db.run(
        `UPDATE work_orders SET 
          transferred_from_branch = branch_name,
          branch_name = ?,
          transferred_at = datetime('now','localtime'),
          updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [target_branch, existing.id]
      );

      db.run(
        `INSERT INTO work_order_logs (work_order_id, user_id, from_status, to_status, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [existing.id, ctx.user ? ctx.user.id : null, existing.status, existing.status, `تم تحويل الطلب من ${existing.branch_name} إلى ${target_branch}. السبب: ${reason || 'ضغط عمل'}`]
      );

      db.logActivity(ctx.user ? ctx.user.id : null, 'transfer', 'work_orders', existing.id, {
        order_no: existing.order_no,
        from_branch: existing.branch_name,
        to_branch: target_branch
      });

      const updated = db.get('SELECT * FROM work_orders WHERE id = ?', [existing.id]);
      sendJson(ctx.res, 200, { order: updated });
    });

    router.post('/api/work-orders/design', (ctx) => {
      const { data_url, filename } = ctx.body || {};
      if (!data_url || !data_url.startsWith('data:')) throw new HttpError(400, 'ملف التصميم غير صالح');

      const match = data_url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new HttpError(400, 'صيغة الملف غير مدعومة');

      const ext = match[1].includes('png') ? '.png' : match[1].includes('pdf') ? '.pdf' : '.jpg';
      const buffer = Buffer.from(match[2], 'base64');
      const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
      const safeName = `design-${Date.now()}-${hash}${ext}`;
      const targetPath = path.join(db.IMAGES_DIR, safeName);

      fs.mkdirSync(db.IMAGES_DIR, { recursive: true });
      fs.writeFileSync(targetPath, buffer);

      sendJson(ctx.res, 201, { url: `/images/${safeName}`, bytes: buffer.length });
    });
  }
};
