const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const ledger = require('../core/ledger');
const { recordMovement } = require('./products.routes');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const MOVEMENT_LABELS = {
  sale: 'بيع',
  return_sale: 'إرجاع مبيعات',
  purchase: 'شراء',
  return_purchase: 'مرتجع شراء',
};

function creditLimitCheck({ customerId, due, force, canOverride }) {
  if (!customerId || !(due > 0)) return null;
  const mode = db.getSetting('credit_limit_mode', 'warn');
  if (mode === 'off') return null;
  const customer = db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
  if (!customer) return null;
  const limit = Number(customer.credit_limit) || 0;
  if (limit <= 0) return null;
  const current = Number(customer.balance) || 0;
  const projected = round2(current + due);
  if (projected <= limit + 0.001) return null;
  const details = {
    customer: customer.name,
    limit,
    current,
    due: round2(due),
    projected,
    over: round2(projected - limit),
  };
  if (mode === 'block') {
    const err = new HttpError(400, `تجاوز حد ائتمان العميل ${customer.name} — الحد ${limit} والمتبقي بعد البيع ${projected}`);
    err.code = 'CREDIT_LIMIT';
    err.details = details;
    throw err;
  }
  if (!force) {
    if (!canOverride) {
      const err = new HttpError(403, `تجاوز حد ائتمان العميل ${customer.name} — يلزم صلاحية مدير للتجاوز`);
      err.code = 'CREDIT_LIMIT';
      err.details = details;
      throw err;
    }
    const err = new HttpError(409, `تجاوز حد ائتمان العميل ${customer.name}`);
    err.code = 'CREDIT_LIMIT';
    err.details = details;
    throw err;
  }
  return details;
}

function profitOf(invoice) {
  const total = Number(invoice.total) || 0;
  const cost = Number(invoice.cost_total) || 0;
  if (invoice.type === 'sale') return round2(total - cost);
  if (invoice.type === 'return_sale') return round2(cost - total);
  return 0;
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new HttpError(400, 'الفاتورة لا تحتوي على أصناف');
  return rawItems.map((item) => {
    const productId = item.product_id || item.productId || null;
    const product = productId ? db.get('SELECT * FROM products WHERE id = ?', [productId]) : null;
    const qty = Number(item.qty ?? item.quantity ?? 1) || 1;
    const unitPrice = Number(item.unit_price ?? item.price ?? (product ? product.sale_price : 0)) || 0;
    const discount = Number(item.discount) || 0;
    const costPrice = Number(item.cost_price ?? (product ? product.cost_price : 0)) || 0;
    const total = round2(qty * unitPrice - discount);
    return {
      product_id: product ? product.id : null,
      name: item.name || (product ? product.name : 'صنف'),
      qty,
      unit: item.unit || (product ? product.unit : 'قطعة'),
      unit_price: unitPrice,
      cost_price: costPrice,
      discount,
      total,
      product,
    };
  });
}

function persistInvoice({ type, posMode, customerId, supplierId, userId, shiftId, items, discount, tax, paid, paymentMethod, notes, installmentPlan }) {
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.unit_price, 0));
  const itemsDiscount = round2(items.reduce((s, i) => s + i.discount, 0));
  const invoiceDiscount = round2(discount || 0);
  const taxAmount = round2(tax || 0);
  const total = round2(subtotal - itemsDiscount - invoiceDiscount + taxAmount);
  const paidAmount = paid === undefined || paid === null ? (paymentMethod === 'credit' ? 0 : total) : round2(paid);
  const due = round2(total - paidAmount);

  if (paymentMethod === 'credit' && type === 'sale' && !customerId) {
    throw new HttpError(400, 'البيع بالآجل يتطلب اختيار عميل');
  }

  const invoiceNo = ledger.nextInvoiceNo(type);
  let invoiceId;
  db.tx(() => {
    const res = db.run(
      `INSERT INTO invoices (invoice_no, type, pos_mode, customer_id, supplier_id, user_id, shift_id,
        subtotal, discount, tax, total, paid, due, payment_method, status, notes, installment_plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      [invoiceNo, type, posMode, customerId || null, supplierId || null, userId || null, shiftId || null,
        subtotal, round2(itemsDiscount + invoiceDiscount), taxAmount, total, paidAmount, due,
        paymentMethod, notes || null, installmentPlan ? JSON.stringify(installmentPlan) : null]
    );
    invoiceId = Number(res.lastInsertRowid);

    for (const item of items) {
      db.run(
        `INSERT INTO invoice_items (invoice_id, product_id, name, qty, unit, unit_price, cost_price, discount, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [invoiceId, item.product_id, item.name, item.qty, item.unit, item.unit_price, item.cost_price, item.discount, item.total]
      );
      if (item.product) {
        const delta = type === 'purchase' || type === 'return_sale' ? item.qty : -item.qty;
        const newQty = round2(Number(item.product.quantity) + delta);
        if (newQty < 0 && db.getSetting('negative_stock', '0') === '0') {
          throw new HttpError(400, `الكمية المتوفرة من "${item.name}" غير كافية`);
        }
        db.run('UPDATE products SET quantity = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?', [newQty, item.product.id]);
        recordMovement(
          item.product.id, delta >= 0 ? 'in' : 'out', Math.abs(delta), newQty,
          `${MOVEMENT_LABELS[type] || type} - ${invoiceNo}`,
          'invoices', invoiceId, userId
        );
      }
    }

    const costTotal = round2(items.reduce((s, i) => s + i.cost_price * i.qty, 0));
    const isSale = type === 'sale';
    const isReturnSale = type === 'return_sale';
    const isPurchase = type === 'purchase';
    const isReturnPurchase = type === 'return_purchase';

    if (isSale || isPurchase) {
      if (isSale) {
        if (customerId && due > 0) db.run('UPDATE customers SET balance = balance + ? WHERE id = ?', [due, customerId]);
        if (paidAmount > 0) {
          const isCash = paymentMethod === 'cash';
          ledger.addTreasury({
            direction: 'in', amount: paidAmount, source: isCash ? 'sale_cash' : 'sale_card',
            refTable: 'invoices', refId: invoiceId, description: `فاتورة بيع ${invoiceNo}`,
            userId, shiftId,
          });
          ledger.addAccountEntry({ code: '1100', direction: 'debit', amount: paidAmount, refTable: 'invoices', refId: invoiceId, description: `فاتورة ${invoiceNo}` });
        }
        if (due > 0) ledger.addAccountEntry({ code: '1300', direction: 'debit', amount: due, refTable: 'invoices', refId: invoiceId, description: `آجل ${invoiceNo}` });
        ledger.addAccountEntry({ code: '4100', direction: 'credit', amount: total, refTable: 'invoices', refId: invoiceId, description: `إيراد ${invoiceNo}` });
        if (costTotal > 0) {
          ledger.addAccountEntry({ code: '5100', direction: 'debit', amount: costTotal, refTable: 'invoices', refId: invoiceId, description: `تكلفة ${invoiceNo}` });
          ledger.addAccountEntry({ code: '1200', direction: 'credit', amount: costTotal, refTable: 'invoices', refId: invoiceId, description: `صرف مخزون ${invoiceNo}` });
        }
      } else {
        if (supplierId && due > 0) db.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [due, supplierId]);
        if (paidAmount > 0) {
          ledger.addTreasury({
            direction: 'out', amount: paidAmount, source: 'purchase', refTable: 'invoices',
            refId: invoiceId, description: `فاتورة شراء ${invoiceNo}`, userId, shiftId,
          });
          ledger.addAccountEntry({ code: '2100', direction: 'debit', amount: paidAmount, refTable: 'invoices', refId: invoiceId, description: `دفعة شراء ${invoiceNo}` });
          ledger.addAccountEntry({ code: '1100', direction: 'credit', amount: paidAmount, refTable: 'invoices', refId: invoiceId, description: `صرف نقدي ${invoiceNo}` });
        }
        if (due > 0) ledger.addAccountEntry({ code: '2100', direction: 'credit', amount: due, refTable: 'invoices', refId: invoiceId, description: `آجل مورد ${invoiceNo}` });
        ledger.addAccountEntry({ code: '1200', direction: 'debit', amount: total, refTable: 'invoices', refId: invoiceId, description: `إضافة مخزون ${invoiceNo}` });
      }
    }

    if (isReturnSale) {
      if (customerId && due > 0) db.run('UPDATE customers SET balance = balance - ? WHERE id = ?', [due, customerId]);
      ledger.addAccountEntry({ code: '4100', direction: 'debit', amount: total, refTable: 'invoices', refId: invoiceId, description: `مرتجع ${invoiceNo}` });
      if (paidAmount > 0) {
        ledger.addTreasury({
          direction: 'out', amount: paidAmount, source: 'return_sale', refTable: 'invoices',
          refId: invoiceId, description: `مرتجع بيع ${invoiceNo}`, userId, shiftId,
        });
        ledger.addAccountEntry({ code: '1100', direction: 'credit', amount: paidAmount, refTable: 'invoices', refId: invoiceId, description: `رد نقدي ${invoiceNo}` });
      }
      if (costTotal > 0) {
        ledger.addAccountEntry({ code: '1200', direction: 'debit', amount: costTotal, refTable: 'invoices', refId: invoiceId, description: `إرجاع مخزون ${invoiceNo}` });
        ledger.addAccountEntry({ code: '5100', direction: 'credit', amount: costTotal, refTable: 'invoices', refId: invoiceId, description: `عكس تكلفة ${invoiceNo}` });
      }
    }

    if (isReturnPurchase) {
      if (supplierId) db.run('UPDATE suppliers SET balance = balance - ? WHERE id = ?', [total, supplierId]);
      if (paidAmount > 0) {
        ledger.addTreasury({
          direction: 'in', amount: paidAmount, source: 'return_purchase', refTable: 'invoices',
          refId: invoiceId, description: `مرتجع شراء ${invoiceNo}`, userId, shiftId,
        });
        ledger.addAccountEntry({ code: '1100', direction: 'debit', amount: paidAmount, refTable: 'invoices', refId: invoiceId, description: `استلام نقدي ${invoiceNo}` });
      }
      if (total - paidAmount > 0) {
        ledger.addAccountEntry({ code: '2100', direction: 'debit', amount: round2(total - paidAmount), refTable: 'invoices', refId: invoiceId, description: `تخفيض مستحق المورد ${invoiceNo}` });
      }
      ledger.addAccountEntry({ code: '1200', direction: 'credit', amount: total, refTable: 'invoices', refId: invoiceId, description: `خروج مخزون ${invoiceNo}` });
    }

    if (type === 'sale' && installmentPlan && due > 0 && customerId) {
      db.run(
        `INSERT INTO installments (invoice_id, customer_id, total, paid_amount, remaining, installments_count, due_date, status, notes)
         VALUES (?, ?, ?, 0, ?, ?, ?, 'active', ?)`,
        [invoiceId, customerId, total, due, Number(installmentPlan.count) || 1, installmentPlan.due_date || null,
          `تقسيط فاتورة ${invoiceNo}`]
      );
    }

    if (shiftId && (isSale || isReturnSale)) {
      const isCash = paymentMethod === 'cash';
      const sign = isReturnSale ? -1 : 1;
      db.run(
        `UPDATE shifts SET total_sales = total_sales + ?,
          total_cash = total_cash + ?,
          total_card = total_card + ?,
          total_credit = total_credit + ?
         WHERE id = ?`,
        [sign * total, isCash ? sign * paidAmount : 0, isCash ? 0 : sign * paidAmount, sign * due, shiftId]
      );
    }
  });

  return { id: invoiceId, invoice_no: invoiceNo };
}

function mapReturnItems(originalItems, requested, label) {
  if (!requested || !requested.length) {
    return originalItems.map((o) => ({
      product_id: o.product_id, name: o.name, qty: o.qty, unit: o.unit,
      unit_price: o.unit_price, cost_price: o.cost_price, discount: 0,
    }));
  }
  return requested.map((r) => {
    const src = originalItems.find((o) => o.id === Number(r.item_id || r.id));
    if (!src) throw new HttpError(400, `أحد الأصناف المطلوبة غير موجود في ${label}`);
    return {
      product_id: src.product_id,
      name: src.name,
      qty: Number(r.qty) || src.qty,
      unit: src.unit,
      unit_price: src.unit_price,
      cost_price: src.cost_price,
      discount: 0,
    };
  });
}

module.exports = {
  persistInvoice,
  normalizeItems,
  register(router) {
    router.get('/api/sales', (ctx) => {
      const { type, pos_mode, customer_id, user_id, from, to, search, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];
      if (type) { where.push('i.type = ?'); params.push(type); }
      if (pos_mode) { where.push('i.pos_mode = ?'); params.push(pos_mode); }
      if (customer_id) { where.push('i.customer_id = ?'); params.push(customer_id); }
      if (user_id) { where.push('i.user_id = ?'); params.push(user_id); }
      if (from) { where.push("date(i.created_at) >= date(?)"); params.push(from); }
      if (to) { where.push("date(i.created_at) <= date(?)"); params.push(to); }
      if (search) { where.push('(i.invoice_no LIKE ? OR c.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

      const rows = db.all(
        `SELECT i.*, c.name AS customer_name, s.name AS supplier_name, u.full_name AS user_name,
           (SELECT COUNT(*) FROM invoice_items it WHERE it.invoice_id = i.id) AS items_count,
           (SELECT COALESCE(SUM(it.cost_price * it.qty), 0) FROM invoice_items it WHERE it.invoice_id = i.id) AS cost_total
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN suppliers s ON s.id = i.supplier_id
         LEFT JOIN users u ON u.id = i.user_id
         ${whereSql} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      for (const row of rows) {
        row.profit = profitOf(row);
        row.margin_pct = Number(row.total) ? round2((row.profit / Number(row.total)) * 100) : 0;
      }
      const total = db.get(
        `SELECT COUNT(*) AS c, COALESCE(SUM(i.total), 0) AS sum_total
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id ${whereSql}`,
        params
      );
      sendJson(ctx.res, 200, { rows, total: total.c, sum_total: total.sum_total, page: Number(page), page_size: limit });
    });

    router.get('/api/sales/last', (ctx) => {
      const invoice = db.get(
        `SELECT i.*, c.name AS customer_name
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
         WHERE i.type = 'sale' ORDER BY i.id DESC LIMIT 1`
      );
      if (!invoice) throw new HttpError(404, 'لا توجد فواتير بيع سابقة');
      const items = db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', [invoice.id]);
      sendJson(ctx.res, 200, { invoice, items });
    });

    router.get('/api/sales/:id', (ctx) => {
      const invoice = db.get(
        `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, s.name AS supplier_name,
           u.full_name AS user_name,
           (SELECT COALESCE(SUM(it.cost_price * it.qty), 0) FROM invoice_items it WHERE it.invoice_id = i.id) AS cost_total
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN users u ON u.id = i.user_id
         WHERE i.id = ?`,
        [ctx.params.id]
      );
      if (!invoice) throw new HttpError(404, 'الفاتورة غير موجودة');
      invoice.profit = profitOf(invoice);
      invoice.margin_pct = Number(invoice.total) ? round2((invoice.profit / Number(invoice.total)) * 100) : 0;
      const items = db.all('SELECT * FROM invoice_items WHERE invoice_id = ?', [ctx.params.id]);
      const payments = db.all('SELECT * FROM treasury WHERE ref_table = \'invoices\' AND ref_id = ? ORDER BY id', [ctx.params.id]);
      sendJson(ctx.res, 200, { invoice, items, payments });
    });

    router.post('/api/sales', (ctx) => {
      if (!ctx.can('pos.sell') && !ctx.can('sales.write')) throw new HttpError(403, 'لا تملك صلاحية البيع');
      const body = ctx.body || {};
      if (db.getSetting('shift_required', '0') === '1' && !body.shift_id) {
        throw new HttpError(400, 'يجب فتح وردية قبل البيع');
      }
      const items = normalizeItems(body.items);
      const type = ['sale', 'return_sale', 'purchase', 'return_purchase'].includes(body.type) ? body.type : 'sale';
      const total = round2(
        items.reduce((s, i) => s + i.qty * i.unit_price, 0)
        - items.reduce((s, i) => s + i.discount, 0)
        - (Number(body.discount) || 0)
        + (Number(body.tax) || 0)
      );
      const paidValue = body.paid === undefined || body.paid === null
        ? (body.payment_method === 'credit' ? 0 : total)
        : round2(body.paid);
      const due = round2(total - paidValue);
      let creditWarning = null;
      if (type === 'sale') {
        creditWarning = creditLimitCheck({
          customerId: body.customer_id || null,
          due,
          force: body.force_credit_limit === true,
          canOverride: ctx.can('sales.write'),
        });
      }
      const result = persistInvoice({
        type,
        posMode: body.pos_mode || db.getSetting('default_pos_mode', 'fast'),
        customerId: body.customer_id || null,
        supplierId: body.supplier_id || null,
        userId: ctx.user.id,
        shiftId: body.shift_id || null,
        items,
        discount: body.discount,
        tax: body.tax,
        paid: paidValue,
        paymentMethod: body.payment_method || 'cash',
        notes: body.notes,
        installmentPlan: body.installment_plan,
      });
      db.logActivity(ctx.user.id, 'sale', 'invoices', result.id, { total: body.total });
      if (creditWarning) db.logActivity(ctx.user.id, 'credit_limit_override', 'invoices', result.id, creditWarning);
      sendJson(ctx.res, 201, {
        invoice: db.get('SELECT * FROM invoices WHERE id = ?', [result.id]),
        id: result.id,
        credit_warning: creditWarning,
      });
    });

    router.post('/api/purchases', (ctx) => {
      if (!ctx.can('purchases.write') && !ctx.can('inventory.write')) throw new HttpError(403, 'لا تملك صلاحية الشراء');
      const body = ctx.body || {};
      const items = normalizeItems(body.items);
      const result = persistInvoice({
        type: 'purchase',
        posMode: 'purchase',
        supplierId: body.supplier_id || null,
        userId: ctx.user.id,
        shiftId: body.shift_id || null,
        items,
        discount: body.discount,
        tax: body.tax,
        paid: body.paid,
        paymentMethod: body.payment_method || 'cash',
        notes: body.notes,
      });
      db.logActivity(ctx.user.id, 'purchase', 'invoices', result.id);
      sendJson(ctx.res, 201, { invoice: db.get('SELECT * FROM invoices WHERE id = ?', [result.id]), id: result.id });
    });

    router.post('/api/purchases/:id/return', (ctx) => {
      if (!ctx.can('purchases.write') && !ctx.can('inventory.write')) throw new HttpError(403, 'لا تملك صلاحية مرتجع الشراء');
      const original = db.get('SELECT * FROM invoices WHERE id = ?', [ctx.params.id]);
      if (!original) throw new HttpError(404, 'الفاتورة غير موجودة');
      if (original.type !== 'purchase') throw new HttpError(400, 'يمكن إرجاع فواتير الشراء فقط');
      const originalItems = db.all('SELECT * FROM invoice_items WHERE invoice_id = ?', [original.id]);
      const requested = Array.isArray(ctx.body.items) ? ctx.body.items : null;
      const items = normalizeItems(mapReturnItems(originalItems, requested, 'فاتورة الشراء الأصلية'));
      const itemsTotal = round2(items.reduce((s, i) => s + i.qty * i.unit_price, 0));
      const originalSubtotal = Number(original.subtotal) || 0;
      const discountShare = originalSubtotal > 0
        ? round2((Number(original.discount) || 0) * (itemsTotal / originalSubtotal))
        : 0;
      const refund = Math.min(Math.max(Number(ctx.body.paid) || 0, 0), round2(itemsTotal - discountShare));
      const result = persistInvoice({
        type: 'return_purchase',
        posMode: 'purchase',
        supplierId: original.supplier_id,
        userId: ctx.user.id,
        shiftId: ctx.body.shift_id || null,
        items,
        discount: discountShare,
        tax: 0,
        paid: refund,
        paymentMethod: refund > 0 ? 'cash' : 'credit',
        notes: `مرتجع من فاتورة الشراء ${original.invoice_no}`,
      });
      db.logActivity(ctx.user.id, 'purchase_return', 'invoices', result.id, { source: original.invoice_no });
      sendJson(ctx.res, 201, { invoice: db.get('SELECT * FROM invoices WHERE id = ?', [result.id]), id: result.id });
    });

    router.post('/api/sales/:id/return', (ctx) => {
      if (!ctx.can('pos.sell') && !ctx.can('sales.write')) throw new HttpError(403, 'لا تملك صلاحية الإرجاع');
      const original = db.get('SELECT * FROM invoices WHERE id = ?', [ctx.params.id]);
      if (!original) throw new HttpError(404, 'الفاتورة غير موجودة');
      if (original.type !== 'sale') throw new HttpError(400, 'يمكن إرجاع فواتير البيع فقط');
      const originalItems = db.all('SELECT * FROM invoice_items WHERE invoice_id = ?', [original.id]);
      const requested = Array.isArray(ctx.body.items) ? ctx.body.items : null;
      const items = normalizeItems(mapReturnItems(originalItems, requested, 'الفاتورة الأصلية'));
      const result = persistInvoice({
        type: 'return_sale',
        posMode: original.pos_mode,
        customerId: original.customer_id,
        userId: ctx.user.id,
        shiftId: ctx.body.shift_id || null,
        items,
        discount: 0,
        tax: 0,
        paid: ctx.body.refund === false ? 0 : items.reduce((s, i) => s + i.total, 0),
        paymentMethod: original.payment_method,
        notes: `مرتجع من الفاتورة ${original.invoice_no}`,
      });
      sendJson(ctx.res, 201, { invoice: db.get('SELECT * FROM invoices WHERE id = ?', [result.id]), id: result.id });
    });
  },
};
