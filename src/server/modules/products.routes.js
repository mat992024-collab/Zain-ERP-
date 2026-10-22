const db = require('../db');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { sendJson, HttpError } = require('../core/http');
const { parseJsonFields, toBool, pick, buildInsert, buildUpdate, list } = require('../core/crud');

const FIELDS = [
  'sku', 'barcode', 'part_number', 'name', 'author', 'description', 'category', 'brand',
  'unit', 'units', 'cost_price', 'sale_price', 'wholesale_price', 'quantity', 'reorder_level',
  'track_expiry', 'expiry_date', 'tax_rate', 'image', 'supplier_id', 'is_active',
];

function normalizeProduct(data) {
  const out = pick(data, FIELDS);
  delete out.image;
  if (out.units && typeof out.units !== 'string') out.units = JSON.stringify(out.units);
  for (const k of ['track_expiry', 'is_active']) {
    if (k in out) out[k] = toBool(out[k]) ? 1 : 0;
  }
  for (const k of ['cost_price', 'sale_price', 'wholesale_price', 'quantity', 'reorder_level', 'tax_rate']) {
    if (k in out) out[k] = Number(out[k]) || 0;
  }
  return out;
}

function recordMovement(productId, direction, qty, balanceAfter, reason, refTable, refId, userId) {
  db.run(
    `INSERT INTO stock_movements (product_id, direction, qty, balance_after, reason, ref_table, ref_id, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, direction, qty, balanceAfter, reason || null, refTable || null, refId || null, userId || null]
  );
}

module.exports = {
  recordMovement,
  register(router) {
    router.get('/api/products', (ctx) => {
      const { search, category, low_stock, active, page = 1, page_size = 50, sort = 'name ASC' } = ctx.query;
      const where = [];
      const params = [];
      if (category) {
        where.push('category = ?');
        params.push(category);
      }
      if (active !== 'all') {
        where.push('is_active = 1');
      }
      if (low_stock === '1') {
        where.push('quantity <= reorder_level');
      }
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const allowedSort = ['name ASC', 'name DESC', 'quantity ASC', 'quantity DESC', 'sale_price ASC', 'sale_price DESC', 'id DESC', 'created_at DESC'];
      const order = allowedSort.includes(sort) ? sort : 'name ASC';
      const result = list('products', {
        where, params, order, limit, offset,
        search, searchCols: ['name', 'barcode', 'sku', 'part_number', 'author', 'brand'],
      });
      sendJson(ctx.res, 200, result);
    });

    router.get('/api/products/categories', (ctx) => {
      const rows = db.all(
        'SELECT category AS name, COUNT(*) AS count FROM products WHERE is_active = 1 GROUP BY category ORDER BY name'
      );
      sendJson(ctx.res, 200, { categories: rows });
    });

    router.get('/api/products/barcode/:code', (ctx) => {
      const product = db.get('SELECT * FROM products WHERE barcode = ? AND is_active = 1', [ctx.params.code]);
      if (!product) throw new HttpError(404, 'المنتج غير موجود');
      sendJson(ctx.res, 200, { product: parseJsonFields(product, ['units']) });
    });

    router.get('/api/products/quick', (ctx) => {
      const limit = Math.min(Number(ctx.query.limit) || 12, 40);
      const days = Math.min(Number(ctx.query.days) || 30, 365);
      let rows = db.all(
        `SELECT p.id, p.name, p.barcode, p.part_number, p.category, p.unit, p.sale_price, p.wholesale_price,
                p.cost_price, p.quantity, p.reorder_level, p.is_active, p.image,
                COALESCE(SUM(ii.qty), 0) AS sold
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         JOIN products p ON p.id = ii.product_id
         WHERE i.type = 'sale' AND date(i.created_at) >= date('now','localtime', ?)
         GROUP BY p.id
         ORDER BY sold DESC, p.name ASC
         LIMIT ?`,
        [`-${days} days`, limit]
      );
      if (!rows.length) {
        rows = db.all(
          `SELECT id, name, barcode, part_number, category, unit, sale_price, wholesale_price,
                  cost_price, quantity, reorder_level, is_active, image, 0 AS sold
           FROM products WHERE is_active = 1 ORDER BY id DESC LIMIT ?`,
          [limit]
        );
      }
      sendJson(ctx.res, 200, { rows });
    });

    router.get('/api/products/low-stock', (ctx) => {
      const limit = Math.min(Number(ctx.query.limit) || 20, 100);
      const rows = db.all(
        `SELECT id, name, barcode, category, unit, quantity, reorder_level, sale_price
         FROM products
         WHERE is_active = 1 AND quantity <= reorder_level
         ORDER BY (quantity - reorder_level) ASC, name ASC
         LIMIT ?`,
        [limit]
      );
      sendJson(ctx.res, 200, { rows });
    });

    router.get('/api/products/:id/movements', (ctx) => {
      const rows = db.all(
        `SELECT m.*, u.full_name AS user_name FROM stock_movements m
         LEFT JOIN users u ON u.id = m.user_id WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200`,
        [ctx.params.id]
      );
      sendJson(ctx.res, 200, { movements: rows });
    });

    router.get('/api/products/:id', (ctx) => {
      const product = db.get('SELECT * FROM products WHERE id = ?', [ctx.params.id]);
      if (!product) throw new HttpError(404, 'المنتج غير موجود');
      sendJson(ctx.res, 200, { product: parseJsonFields(product, ['units']) });
    });

    router.post('/api/products', (ctx) => {
      if (!ctx.can('inventory.write') && !ctx.can('products.write')) {
        throw new HttpError(403, 'لا تملك صلاحية إضافة المنتجات');
      }
      const data = normalizeProduct(ctx.body || {});
      if (!data.name) throw new HttpError(400, 'اسم المنتج مطلوب');
      if (data.barcode === undefined || data.barcode === '' || data.barcode === null) {
        if (db.getSetting('auto_barcode', '1') === '1') {
          const seq = db.get('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM products').n;
          data.barcode = `${db.getSetting('barcode_prefix', '') || 'ZAIN'}${String(200000 + seq)}`;
        } else {
          delete data.barcode;
        }
      }
      let id;
      db.tx(() => {
        const { sql, values } = buildInsert('products', data);
        const res = db.run(sql, values);
        id = Number(res.lastInsertRowid);
        if (Number(data.quantity) > 0) {
          recordMovement(id, 'in', data.quantity, data.quantity, 'رصيد افتتاحي', 'products', id, ctx.user.id);
        }
      });
      db.logActivity(ctx.user.id, 'create', 'products', id, { name: data.name });
      sendJson(ctx.res, 201, { product: parseJsonFields(db.get('SELECT * FROM products WHERE id = ?', [id]), ['units']) });
    });

    router.put('/api/products/:id', (ctx) => {
      if (!ctx.can('inventory.write') && !ctx.can('products.write')) {
        throw new HttpError(403, 'لا تملك صلاحية التعديل');
      }
      const existing = db.get('SELECT * FROM products WHERE id = ?', [ctx.params.id]);
      if (!existing) throw new HttpError(404, 'المنتج غير موجود');
      const data = normalizeProduct(ctx.body || {});
      data.updated_at = db.get("SELECT datetime('now','localtime') AS t").t;
      if (!data.name) throw new HttpError(400, 'اسم المنتج مطلوب');
      db.tx(() => {
        const { sql, values } = buildUpdate('products', existing.id, data);
        db.run(sql, values);
        if ('quantity' in data && Number(data.quantity) !== Number(existing.quantity)) {
          const diff = Number(data.quantity) - Number(existing.quantity);
          recordMovement(
            existing.id, diff > 0 ? 'in' : 'out', Math.abs(diff), Number(data.quantity),
            'تعديل يدوي للمخزون', 'products', existing.id, ctx.user.id
          );
        }
      });
      db.logActivity(ctx.user.id, 'update', 'products', existing.id);
      sendJson(ctx.res, 200, { product: parseJsonFields(db.get('SELECT * FROM products WHERE id = ?', [existing.id]), ['units']) });
    });

    router.post('/api/products/:id/image', (ctx) => {
      if (!ctx.can('inventory.write') && !ctx.can('products.write')) {
        throw new HttpError(403, 'لا تملك صلاحية تعديل المنتجات');
      }
      const product = db.get('SELECT * FROM products WHERE id = ?', [ctx.params.id]);
      if (!product) throw new HttpError(404, 'المنتج غير موجود');
      const dataUrl = String((ctx.body || {}).data_url || '');
      const match = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) throw new HttpError(400, 'صيغة الصورة غير مدعومة');
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length) throw new HttpError(400, 'الصورة فارغة');
      if (buffer.length > 3 * 1024 * 1024) throw new HttpError(400, 'حجم الصورة كبير جداً');
      fs.mkdirSync(db.IMAGES_DIR, { recursive: true });
      if (product.image) {
        try { fs.unlinkSync(path.join(db.IMAGES_DIR, path.basename(String(product.image)))); } catch { }
      }
      const file = `p${product.id}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(db.IMAGES_DIR, file), buffer);
      const url = `/images/${file}`;
      db.run('UPDATE products SET image = ? WHERE id = ?', [url, product.id]);
      db.logActivity(ctx.user.id, 'update', 'products', product.id, { image: url });
      sendJson(ctx.res, 200, { product: { id: product.id, image: url }, bytes: buffer.length });
    });

    router.delete('/api/products/:id/image', (ctx) => {
      if (!ctx.can('inventory.write') && !ctx.can('products.write')) {
        throw new HttpError(403, 'لا تملك صلاحية تعديل المنتجات');
      }
      const product = db.get('SELECT * FROM products WHERE id = ?', [ctx.params.id]);
      if (!product) throw new HttpError(404, 'المنتج غير موجود');
      if (product.image) {
        const file = path.basename(String(product.image));
        try { fs.unlinkSync(path.join(db.IMAGES_DIR, file)); } catch { }
      }
      db.run('UPDATE products SET image = NULL WHERE id = ?', [product.id]);
      db.logActivity(ctx.user.id, 'update', 'products', product.id, { image: null });
      sendJson(ctx.res, 200, { ok: true });
    });

    router.post('/api/products/:id/adjust', (ctx) => {
      if (!ctx.can('inventory.write')) throw new HttpError(403, 'لا تملك صلاحية تسوية المخزون');
      const product = db.get('SELECT * FROM products WHERE id = ?', [ctx.params.id]);
      if (!product) throw new HttpError(404, 'المنتج غير موجود');
      const { qty, direction, reason } = ctx.body || {};
      const amount = Number(qty);
      if (!amount || amount <= 0) throw new HttpError(400, 'الكمية غير صحيحة');
      const dir = direction === 'out' ? 'out' : 'in';
      const newQty = Number(product.quantity) + (dir === 'in' ? amount : -amount);
      if (newQty < 0 && db.getSetting('negative_stock', '0') === '0') {
        throw new HttpError(400, 'الكمية المتوفرة غير كافية');
      }
      db.tx(() => {
        db.run('UPDATE products SET quantity = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?', [newQty, product.id]);
        recordMovement(product.id, dir, amount, newQty, reason || 'تسوية مخزون', 'products', product.id, ctx.user.id);
      });
      db.logActivity(ctx.user.id, 'adjust_stock', 'products', product.id, { qty: amount, direction: dir });
      sendJson(ctx.res, 200, { ok: true, quantity: newQty });
    });

    router.delete('/api/products/:id', (ctx) => {
      if (!ctx.can('inventory.write') && !ctx.can('products.write')) {
        throw new HttpError(403, 'لا تملك صلاحية الحذف');
      }
      const product = db.get('SELECT * FROM products WHERE id = ?', [ctx.params.id]);
      if (!product) throw new HttpError(404, 'المنتج غير موجود');
      const used = db.get('SELECT COUNT(*) AS c FROM invoice_items WHERE product_id = ?', [product.id]).c;
      if (used > 0) {
        db.run('UPDATE products SET is_active = 0 WHERE id = ?', [product.id]);
        db.logActivity(ctx.user.id, 'archive', 'products', product.id);
        sendJson(ctx.res, 200, { ok: true, archived: true });
        return;
      }
      db.run('DELETE FROM products WHERE id = ?', [product.id]);
      db.logActivity(ctx.user.id, 'delete', 'products', product.id);
      sendJson(ctx.res, 200, { ok: true });
    });

    router.post('/api/products/bulk-price', (ctx) => {
      if (!ctx.can('inventory.write')) throw new HttpError(403, 'لا تملك صلاحية التعديل');
      const { category, field, mode, value } = ctx.body || {};
      const allowed = ['sale_price', 'cost_price', 'wholesale_price'];
      if (!allowed.includes(field)) throw new HttpError(400, 'حقل غير مسموح');
      const val = Number(value) || 0;
      const expr = mode === 'percent'
        ? `${field} = ROUND(${field} * (1 + (?/100.0)), 2)`
        : `${field} = ?`;
      const where = category ? 'WHERE category = ?' : '';
      const params = category ? [val, category] : [val];
      const res = db.run(`UPDATE products SET ${expr} ${where}`, params);
      db.logActivity(ctx.user.id, 'bulk_price', 'products', null, { field, mode, value, category });
      sendJson(ctx.res, 200, { ok: true, updated: res.changes });
    });
  },
};
