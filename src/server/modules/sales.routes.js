const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const ledger = require('../core/ledger');
const cloudSync = require('../core/cloud-sync');
const { recordMovement } = require('./products.routes');
const currency = require('./currency.routes');

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

function computeTax(items, mode) {
  if (mode === 'manual') return 0;
  let total = 0;
  for (const item of items) {
    const rate = Number(item.tax_rate) || 0;
    if (rate <= 0) continue;
    const net = round2(item.qty * item.unit_price - item.discount);
    if (mode === 'inclusive') {
      total += round2(net - net / (1 + rate / 100));
    } else {
      total += round2(net * rate / 100);
    }
  }
  return round2(total);
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new HttpError(400, 'الفاتورة لا تحتوي على أصناف');
  return rawItems.map((item) => {
    const productId = item.product_id || item.productId || null;
    const product = productId ? db.get('SELECT * FROM products WHERE id = ?', [productId]) : null;
    let qty = Number(item.qty ?? item.quantity ?? 1) || 1;
    let dimensions = item.dimensions || null;
    if (item.meter_length && item.meter_width) {
      const l = Number(item.meter_length) || 0;
      const w = Number(item.meter_width) || 0;
      if (l > 0 && w > 0) {
        qty = round2(l * w * (Number(item.count || item.pieces || 1) || 1));
        dimensions = `${l}م × ${w}م (${item.count || 1} ق)`;
      }
    }
    const unitPrice = Number(item.unit_price ?? item.price ?? (product ? product.sale_price : 0)) || 0;
    const discount = Number(item.discount) || 0;
    const costPrice = Number(item.cost_price ?? (product ? product.cost_price : 0)) || 0;
    const taxRate = Number(item.tax_rate ?? (product ? product.tax_rate : 0)) || 0;
    const total = round2(qty * unitPrice - discount);
    return {
      product_id: product ? product.id : null,
      name: item.name || (product ? product.name : 'صنف'),
      qty,
      unit: item.unit || (product ? product.unit : 'قطعة'),
      dimensions,
      unit_price: unitPrice,
      cost_price: costPrice,
      discount,
      total,
      tax_rate: taxRate,
      restock: item.restock === false ? false : true,
      product,
    };
  });
}

const PAY_METHODS = ['cash', 'card', 'wallet', 'vodafone_cash'];
const PAY_LABELS = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', vodafone_cash: 'فودافون كاش', credit: 'آجل', mixed: 'مختلط' };

function normalizePayments(payments, paymentMethod, applied) {
  const list = [];
  if (Array.isArray(payments)) {
    for (const p of payments) {
      const method = p && PAY_METHODS.includes(p.method) ? p.method : null;
      const amount = round2(Number(p && p.amount) || 0);
      if (!method || amount <= 0) continue;
      list.push({ method, amount });
    }
  }
  if (!list.length) {
    const method = PAY_METHODS.includes(paymentMethod) ? paymentMethod : 'cash';
    return applied > 0 ? [{ method, amount: applied }] : [];
  }
  let sum = round2(list.reduce((s, p) => s + p.amount, 0));
  let change = round2(sum - applied);
  const trim = (onlyCash) => {
    for (let i = list.length - 1; i >= 0 && change > 0; i--) {
      if (onlyCash && list[i].method !== 'cash') continue;
      const cut = Math.min(list[i].amount, change);
      list[i].amount = round2(list[i].amount - cut);
      change = round2(change - cut);
    }
  };
  if (change > 0) {
    trim(true);
    trim(false);
  }
  return list.filter((p) => p.amount > 0);
}

function paymentMethodOf(breakdown, applied, fallback) {
  const methods = [...new Set(breakdown.map((p) => p.method))];
  if (methods.length > 1) return 'mixed';
  if (methods.length === 1) return methods[0];
  if (applied > 0) return PAY_METHODS.includes(fallback) ? fallback : 'cash';
  return 'credit';
}

function treasurySourceOf(method, direction) {
  if (method === 'cash') return direction === 'in' ? 'sale_cash' : 'return_sale';
  if (method === 'card') return direction === 'in' ? 'sale_card' : 'return_card';
  if (method === 'vodafone_cash') return direction === 'in' ? 'sale_vodafone' : 'return_vodafone';
  return direction === 'in' ? 'sale_wallet' : 'return_wallet';
}

function persistInvoice({ type, posMode, customerId, supplierId, userId, shiftId, items, discount, tax, taxInclusive, paid, paymentMethod, payments, notes, installmentPlan, currencyCode, exchangeRate, totalOriginal, paidOriginal, damage, branch, orderType, deliveryStatus, deliveryNotes }) {
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.unit_price, 0));
  const itemsDiscount = round2(items.reduce((s, i) => s + i.discount, 0));
  const invoiceDiscount = round2(discount || 0);
  const taxAmount = round2(tax || 0);
  const total = round2(subtotal - itemsDiscount - invoiceDiscount + (taxInclusive ? 0 : taxAmount));
  const paidAmount = paid === undefined || paid === null ? (paymentMethod === 'credit' ? 0 : total) : round2(paid);
  const applied = round2(Math.max(0, Math.min(paidAmount, total)));
  const breakdown = normalizePayments(payments, paymentMethod, applied);
  const storedMethod = paymentMethodOf(breakdown, applied, paymentMethod);
  const due = round2(total - applied);

  if (paymentMethod === 'credit' && type === 'sale' && !customerId) {
    throw new HttpError(400, 'البيع بالآجل يتطلب اختيار عميل');
  }
  if (due > 0 && type === 'sale' && !customerId) {
    throw new HttpError(400, 'المبلغ المتبقي يتطلب اختيار عميل (بيع آجل)');
  }

  const invoiceNo = ledger.nextInvoiceNo(type);
  let invoiceId;
  db.tx(() => {
    const res = db.run(
      `INSERT INTO invoices (invoice_no, type, pos_mode, customer_id, supplier_id, user_id, shift_id,
        subtotal, discount, tax, tax_inclusive, total, paid, due, payment_method, status, notes, installment_plan,
        currency, exchange_rate, total_original, paid_original, payments, branch, order_type, delivery_status, delivery_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceNo, type, posMode, customerId || null, supplierId || null, userId || null, shiftId || null,
        subtotal, round2(itemsDiscount + invoiceDiscount), taxAmount, taxInclusive ? 1 : 0, total, applied, due,
        storedMethod, notes || null, installmentPlan ? JSON.stringify(installmentPlan) : null,
        currencyCode || null, exchangeRate || 1, totalOriginal === undefined ? null : totalOriginal,
        paidOriginal === undefined ? null : paidOriginal, JSON.stringify(breakdown),
        branch || 'الفرع الرئيسي', orderType || 'direct', deliveryStatus || (orderType === 'external_delivery' ? 'preparing' : 'completed'), deliveryNotes || null]
    );
    invoiceId = Number(res.lastInsertRowid);

    for (const p of breakdown) {
      db.run(
        `INSERT INTO invoice_payments (invoice_id, method, amount, currency, amount_original)
         VALUES (?, ?, ?, ?, ?)`,
        [invoiceId, p.method, p.amount, currencyCode || null, currencyCode && breakdown.length === 1 && paidOriginal !== undefined ? paidOriginal : null]
      );
    }

    for (const item of items) {
      db.run(
        `INSERT INTO invoice_items (invoice_id, product_id, name, qty, unit, dimensions, unit_price, cost_price, discount, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [invoiceId, item.product_id, item.name, item.qty, item.unit, item.dimensions || null, item.unit_price, item.cost_price, item.discount, item.total]
      );
      if (item.product) {
        const restock = type !== 'return_sale' || item.restock !== false;
        if (!restock) {
          recordMovement(
            item.product.id, 'damage', item.qty, Number(item.product.quantity),
            `${MOVEMENT_LABELS[type] || type} تالف - ${invoiceNo}`,
            'invoices', invoiceId, userId
          );
          continue;
        }
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
        for (const p of breakdown) {
          ledger.addTreasury({
            direction: 'in', amount: p.amount, source: treasurySourceOf(p.method, 'in'),
            refTable: 'invoices', refId: invoiceId, description: `فاتورة بيع ${invoiceNo} (${PAY_LABELS[p.method]})`,
            userId, shiftId,
          });
        }
        if (applied > 0) {
          ledger.addAccountEntry({ code: '1100', direction: 'debit', amount: applied, refTable: 'invoices', refId: invoiceId, description: `فاتورة ${invoiceNo}` });
        }
        if (due > 0) ledger.addAccountEntry({ code: '1300', direction: 'debit', amount: due, refTable: 'invoices', refId: invoiceId, description: `آجل ${invoiceNo}` });
        ledger.addAccountEntry({ code: '4100', direction: 'credit', amount: round2(total - taxAmount), refTable: 'invoices', refId: invoiceId, description: `إيراد ${invoiceNo}` });
        if (taxAmount > 0) ledger.addAccountEntry({ code: '2300', direction: 'credit', amount: taxAmount, refTable: 'invoices', refId: invoiceId, description: `ضريبة مخرجات ${invoiceNo}` });
        if (costTotal > 0) {
          ledger.addAccountEntry({ code: '5100', direction: 'debit', amount: costTotal, refTable: 'invoices', refId: invoiceId, description: `تكلفة ${invoiceNo}` });
          ledger.addAccountEntry({ code: '1200', direction: 'credit', amount: costTotal, refTable: 'invoices', refId: invoiceId, description: `صرف مخزون ${invoiceNo}` });
        }
      } else {
        if (supplierId && due > 0) db.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [due, supplierId]);
        if (applied > 0) {
          ledger.addTreasury({
            direction: 'out', amount: applied, source: 'purchase', refTable: 'invoices',
            refId: invoiceId, description: `فاتورة شراء ${invoiceNo}`, userId, shiftId,
          });
          ledger.addAccountEntry({ code: '2100', direction: 'debit', amount: applied, refTable: 'invoices', refId: invoiceId, description: `دفعة شراء ${invoiceNo}` });
          ledger.addAccountEntry({ code: '1100', direction: 'credit', amount: applied, refTable: 'invoices', refId: invoiceId, description: `صرف نقدي ${invoiceNo}` });
        }
        if (due > 0) ledger.addAccountEntry({ code: '2100', direction: 'credit', amount: due, refTable: 'invoices', refId: invoiceId, description: `آجل مورد ${invoiceNo}` });
        ledger.addAccountEntry({ code: '1200', direction: 'debit', amount: round2(total - taxAmount), refTable: 'invoices', refId: invoiceId, description: `إضافة مخزون ${invoiceNo}` });
        if (taxAmount > 0) ledger.addAccountEntry({ code: '2300', direction: 'debit', amount: taxAmount, refTable: 'invoices', refId: invoiceId, description: `ضريبة مشتريات ${invoiceNo}` });
      }
    }

    if (isReturnSale) {
      if (customerId && due > 0) db.run('UPDATE customers SET balance = balance - ? WHERE id = ?', [due, customerId]);
      ledger.addAccountEntry({ code: '4100', direction: 'debit', amount: round2(total - taxAmount), refTable: 'invoices', refId: invoiceId, description: `مرتجع ${invoiceNo}` });
      if (taxAmount > 0) ledger.addAccountEntry({ code: '2300', direction: 'debit', amount: taxAmount, refTable: 'invoices', refId: invoiceId, description: `ضريبة مرتجع ${invoiceNo}` });
      if (applied > 0) {
        const refundMethod = breakdown[0] ? breakdown[0].method : 'cash';
        ledger.addTreasury({
          direction: 'out', amount: applied, source: treasurySourceOf(refundMethod, 'out'), refTable: 'invoices',
          refId: invoiceId, description: `مرتجع بيع ${invoiceNo} (${PAY_LABELS[refundMethod]})`, userId, shiftId,
        });
        ledger.addAccountEntry({ code: '1100', direction: 'credit', amount: applied, refTable: 'invoices', refId: invoiceId, description: `رد نقدي ${invoiceNo}` });
      }
      const restockedCost = round2(items.reduce((s, i) => s + (i.restock === false ? 0 : i.cost_price * i.qty), 0));
      if (restockedCost > 0) {
        ledger.addAccountEntry({ code: '1200', direction: 'debit', amount: restockedCost, refTable: 'invoices', refId: invoiceId, description: `إرجاع مخزون ${invoiceNo}` });
        ledger.addAccountEntry({ code: '5100', direction: 'credit', amount: restockedCost, refTable: 'invoices', refId: invoiceId, description: `عكس تكلفة ${invoiceNo}` });
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
      ledger.addAccountEntry({ code: '1200', direction: 'credit', amount: round2(total - taxAmount), refTable: 'invoices', refId: invoiceId, description: `خروج مخزون ${invoiceNo}` });
      if (taxAmount > 0) ledger.addAccountEntry({ code: '2300', direction: 'credit', amount: taxAmount, refTable: 'invoices', refId: invoiceId, description: `ضريبة مرتجع شراء ${invoiceNo}` });
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
      const sign = isReturnSale ? -1 : 1;
      const amountOf = (method) => breakdown.filter((p) => p.method === method).reduce((s, p) => s + p.amount, 0);
      const cash = round2(amountOf('cash'));
      const card = round2(amountOf('card'));
      const wallet = round2(amountOf('wallet'));
      const vodafone = round2(amountOf('vodafone_cash'));
      const rest = round2(applied - cash - card - wallet - vodafone);
      db.run(
        `UPDATE shifts SET total_sales = total_sales + ?,
          total_cash = total_cash + ?,
          total_card = total_card + ?,
          total_wallet = total_wallet + ?,
          total_vodafone_cash = total_vodafone_cash + ?,
          total_credit = total_credit + ?
         WHERE id = ?`,
        [sign * total, sign * cash, sign * card, sign * (wallet + Math.max(rest, 0)), sign * vodafone, sign * due, shiftId]
      );
    }
  });

  cloudSync.enqueue('invoices', invoiceId, type === 'sale' ? 'sale' : type, { invoice_no: invoiceNo, total, branch: branch || 'الفرع الرئيسي' }, branch || 'الفرع الرئيسي');

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
      restock: r.damaged !== true,
    };
  });
}

module.exports = {
  persistInvoice,
  normalizeItems,
  register(router) {
    router.get('/api/sales', (ctx) => {
      const { type, pos_mode, customer_id, user_id, from, to, search, branch, order_type, delivery_status, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];
      if (type) { where.push('i.type = ?'); params.push(type); }
      if (pos_mode) { where.push('i.pos_mode = ?'); params.push(pos_mode); }
      if (customer_id) { where.push('i.customer_id = ?'); params.push(customer_id); }
      if (user_id) { where.push('i.user_id = ?'); params.push(user_id); }
      if (branch) { where.push('i.branch = ?'); params.push(branch); }
      if (order_type) { where.push('i.order_type = ?'); params.push(order_type); }
      if (delivery_status) { where.push('i.delivery_status = ?'); params.push(delivery_status); }
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
      const treasury = db.all('SELECT * FROM treasury WHERE ref_table = \'invoices\' AND ref_id = ? ORDER BY id', [ctx.params.id]);
      const payments = db.all('SELECT method, amount, currency FROM invoice_payments WHERE invoice_id = ? ORDER BY id', [ctx.params.id]);
      sendJson(ctx.res, 200, { invoice, items, treasury, payments });
    });

    router.post('/api/sales/:id/repeat', (ctx) => {
      const inv = db.get('SELECT * FROM invoices WHERE id = ?', [ctx.params.id]);
      if (!inv) throw new HttpError(404, 'الفاتورة غير موجودة');
      if (inv.type !== 'sale' && inv.type !== 'purchase') throw new HttpError(400, 'يمكن تكرار فواتير البيع والشراء فقط');
      const isPurchase = inv.type === 'purchase';
      if (isPurchase) {
        if (!ctx.can('purchases.write') && !ctx.can('inventory.write')) throw new HttpError(403, 'لا تملك صلاحية الشراء');
      } else if (!ctx.can('pos.sell') && !ctx.can('sales.write')) {
        throw new HttpError(403, 'لا تملك صلاحية البيع');
      }
      const rows = db.all(
        'SELECT product_id, name, qty, unit, unit_price, cost_price, discount FROM invoice_items WHERE invoice_id = ?',
        [inv.id]
      );
      if (!rows.length) throw new HttpError(400, 'الفاتورة لا تحتوي على أصناف');
      const items = normalizeItems(rows);
      const itemsDiscount = round2(items.reduce((s, i) => s + i.discount, 0));
      const invoiceDiscount = Math.max(round2(Number(inv.discount) - itemsDiscount), 0);
      const newSubtotal = round2(items.reduce((s, i) => s + i.qty * i.unit_price, 0));
      const newTotal = round2(newSubtotal - itemsDiscount - invoiceDiscount + (Number(inv.tax_inclusive) ? 0 : Number(inv.tax) || 0));
      const ratio = Number(inv.total) ? Math.min(1, (Number(inv.paid) || 0) / Number(inv.total)) : 1;
      const repeatPaid = round2(newTotal * ratio);
      let repeatPayments = null;
      if (inv.payment_method === 'mixed') {
        const src = db.all('SELECT method, amount FROM invoice_payments WHERE invoice_id = ?', [inv.id]);
        const srcSum = round2(src.reduce((s, p) => s + Number(p.amount), 0));
        if (src.length && srcSum > 0) {
          repeatPayments = src.map((p) => ({ method: p.method, amount: round2(Number(p.amount) * (repeatPaid / srcSum)) }));
          const diff = round2(repeatPaid - repeatPayments.reduce((s, p) => s + p.amount, 0));
          if (diff) repeatPayments[repeatPayments.length - 1].amount = round2(repeatPayments[repeatPayments.length - 1].amount + diff);
        }
      }
      if (!isPurchase && newTotal - repeatPaid > 0 && inv.customer_id) {
        creditLimitCheck({
          customerId: inv.customer_id,
          due: round2(newTotal - repeatPaid),
          force: (ctx.body || {}).force_credit_limit === true,
          canOverride: ctx.can('sales.write'),
        });
      }
      const result = persistInvoice({
        type: inv.type,
        posMode: isPurchase ? 'purchase' : (inv.pos_mode || 'fast'),
        customerId: inv.customer_id,
        supplierId: inv.supplier_id,
        userId: ctx.user.id,
        items,
        discount: invoiceDiscount,
        tax: Number(inv.tax) || 0,
        taxInclusive: !!inv.tax_inclusive,
        paid: repeatPaid,
        paymentMethod: inv.payment_method,
        payments: repeatPayments,
        notes: `تكرار ${inv.invoice_no}`,
      });
      db.logActivity(ctx.user.id, isPurchase ? 'purchase' : 'sale', 'invoices', result.id, {
        total: Number(inv.total) || 0, repeated_from: inv.id, invoice_no: inv.invoice_no,
      });
      sendJson(ctx.res, 201, {
        invoice: db.get('SELECT * FROM invoices WHERE id = ?', [result.id]),
        id: result.id,
        repeated_from: inv.id,
      });
    });

    router.post('/api/sales', (ctx) => {
      if (!ctx.can('pos.sell') && !ctx.can('sales.write')) throw new HttpError(403, 'لا تملك صلاحية البيع');
      const body = ctx.body || {};
      if (db.getSetting('shift_required', '0') === '1' && !body.shift_id) {
        throw new HttpError(400, 'يجب فتح وردية قبل البيع');
      }
      const items = normalizeItems(body.items);
      const type = ['sale', 'return_sale', 'purchase', 'return_purchase'].includes(body.type) ? body.type : 'sale';
      const taxMode = db.getSetting('tax_mode', 'manual');
      const taxManual = body.tax !== undefined && body.tax !== null;
      const taxValue = taxManual
        ? Number(body.tax) || 0
        : (taxMode === 'manual' ? 0 : computeTax(items, taxMode));
      const taxInclusive = !taxManual && taxMode === 'inclusive';
      const total = round2(
        items.reduce((s, i) => s + i.qty * i.unit_price, 0)
        - items.reduce((s, i) => s + i.discount, 0)
        - (Number(body.discount) || 0)
        + (taxInclusive ? 0 : taxValue)
      );
      const split = Array.isArray(body.payments) && body.payments.length
        ? body.payments.map((p) => ({ method: p && p.method, amount: round2(Number(p && p.amount) || 0) }))
        : null;
      if (split) {
        for (const p of split) {
          if (!PAY_METHODS.includes(p.method)) throw new HttpError(400, `طريقة دفع غير صالحة: ${p.method || ''}`);
          if (p.amount < 0) throw new HttpError(400, 'مبلغ الدفع لا يمكن أن يكون سالباً');
        }
      }
      const splitSum = split ? round2(split.reduce((s, p) => s + p.amount, 0)) : null;
      const paidValue = split
        ? splitSum
        : body.paid === undefined || body.paid === null
          ? (body.payment_method === 'credit' ? 0 : total)
          : round2(body.paid);
      const due = round2(total - paidValue);
      const cur = currency.currencyOf(body.currency);
      const rate = Number(cur.rate) || 1;
      const isCredit = !split && body.payment_method === 'credit';
      let paidBase = paidValue;
      let paidOriginal = round2(paidValue);
      let totalOriginal = round2(total);
      if (!cur.is_base) {
        if (split) throw new HttpError(400, 'الدفع المقسّم متاح بالعملة الأساسية فقط');
        totalOriginal = currency.roundTo(total / rate, cur.decimals);
        if (isCredit) {
          paidBase = 0;
          paidOriginal = 0;
        } else {
          const given = body.paid_original === undefined || body.paid_original === null
            ? total / rate
            : Number(body.paid_original);
          paidOriginal = currency.roundTo(given, cur.decimals);
          paidBase = round2(paidOriginal * rate);
        }
      }
      const dueWithCurrency = round2(total - paidBase);
      let creditWarning = null;
      if (type === 'sale') {
        creditWarning = creditLimitCheck({
          customerId: body.customer_id || null,
          due: dueWithCurrency,
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
        tax: taxValue,
        taxInclusive,
        paid: paidBase,
        paymentMethod: split ? (new Set(split.filter((p) => p.amount > 0).map((p) => p.method)).size > 1 ? 'mixed' : (split.find((p) => p.amount > 0) || {}).method || 'cash') : (body.payment_method || 'cash'),
        payments: split,
        notes: body.notes,
        installmentPlan: body.installment_plan,
        currencyCode: cur.code,
        exchangeRate: rate,
        totalOriginal,
        paidOriginal,
        branch: body.branch || ctx.user.branch || db.getSetting('active_branch', 'الفرع الرئيسي'),
        orderType: body.order_type || 'direct',
        deliveryStatus: body.delivery_status || (body.order_type === 'external_delivery' ? 'preparing' : 'completed'),
        deliveryNotes: body.delivery_notes || null,
      });
      db.logActivity(ctx.user.id, 'sale', 'invoices', result.id, { total: body.total, branch: body.branch || ctx.user.branch });
      if (creditWarning) db.logActivity(ctx.user.id, 'credit_limit_override', 'invoices', result.id, creditWarning);
      sendJson(ctx.res, 201, {
        invoice: db.get('SELECT * FROM invoices WHERE id = ?', [result.id]),
        id: result.id,
        credit_warning: creditWarning,
      });
    });

    router.patch('/api/sales/:id/delivery-status', (ctx) => {
      const { status, notes } = ctx.body || {};
      const valid = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'];
      if (!valid.includes(status)) throw new HttpError(400, 'حالة غير صالحة');
      const inv = db.get('SELECT * FROM invoices WHERE id = ?', [ctx.params.id]);
      if (!inv) throw new HttpError(404, 'الطلب غير موجود');
      db.run(
        'UPDATE invoices SET delivery_status = ?, delivery_notes = COALESCE(?, delivery_notes) WHERE id = ?',
        [status, notes || null, inv.id]
      );
      db.logActivity(ctx.user.id, 'delivery_status', 'invoices', inv.id, { status });
      sendJson(ctx.res, 200, { ok: true, id: inv.id, delivery_status: status });
    });

    router.get('/api/reports/owner-summary', (ctx) => {
      const pin = ctx.query.pin || '';
      const ownerPin = db.getSetting('owner_pin', '1234');
      const isOwner = ctx.can('*') || ctx.user.role === 'admin' || (pin && pin === ownerPin);
      if (!isOwner) throw new HttpError(403, 'غير مصرح بالاطلاع على تقارير المالك السرية');
      const { branch, from, to } = ctx.query;
      const where = ["i.type = 'sale'"];
      const params = [];
      if (branch) { where.push('i.branch = ?'); params.push(branch); }
      if (from) { where.push('date(i.created_at) >= date(?)'); params.push(from); }
      if (to) { where.push('date(i.created_at) <= date(?)'); params.push(to); }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const summary = db.get(
        `SELECT COUNT(*) AS sales_count,
           COALESCE(SUM(i.total), 0) AS total_revenue,
           COALESCE(SUM(i.paid), 0) AS total_collected,
           COALESCE(SUM(i.due), 0) AS total_receivable
         FROM invoices i ${whereSql}`,
        params
      );
      const totalRev = Number(summary.total_revenue) || 0;
      const costRow = db.get(
        `SELECT COALESCE(SUM(it.cost_price * it.qty), 0) AS total_cost
         FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id ${whereSql}`,
        params
      );
      const totalCost = Number(costRow.total_cost) || 0;
      const netProfit = round2(totalRev - totalCost);
      const margin = totalRev > 0 ? round2((netProfit / totalRev) * 100) : 0;
      const byMethod = db.all(
        `SELECT p.method, COALESCE(SUM(p.amount), 0) AS amount
         FROM invoice_payments p
         JOIN invoices i ON i.id = p.invoice_id
         ${whereSql} GROUP BY p.method`,
        params
      );
      const byBranch = db.all(
        `SELECT COALESCE(i.branch, 'الفرع الرئيسي') AS branch,
           COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS total
         FROM invoices i WHERE i.type = 'sale' GROUP BY i.branch`
      );
      sendJson(ctx.res, 200, {
        summary: { ...summary, total_cost: totalCost, net_profit: netProfit, margin_pct: margin },
        payments: byMethod,
        branches: byBranch,
      });
    });

    router.post('/api/purchases', (ctx) => {
      if (!ctx.can('purchases.write') && !ctx.can('inventory.write')) throw new HttpError(403, 'لا تملك صلاحية الشراء');
      const body = ctx.body || {};
      const items = normalizeItems(body.items);
      const purchaseTaxMode = db.getSetting('tax_mode', 'manual');
      const purchaseTaxManual = body.tax !== undefined && body.tax !== null;
      const taxValue = purchaseTaxManual
        ? Number(body.tax) || 0
        : (purchaseTaxMode === 'manual' ? 0 : computeTax(items, purchaseTaxMode));
      const taxInclusive = !purchaseTaxManual && purchaseTaxMode === 'inclusive';
      const result = persistInvoice({
        type: 'purchase',
        posMode: 'purchase',
        supplierId: body.supplier_id || null,
        userId: ctx.user.id,
        shiftId: body.shift_id || null,
        items,
        discount: body.discount,
        tax: taxValue,
        taxInclusive,
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
      const itemsTotal = round2(items.reduce((s, i) => s + i.total, 0));
      const originalSubtotal = Number(original.subtotal) || 0;
      const discountShare = originalSubtotal > 0
        ? round2((Number(original.discount) || 0) * (itemsTotal / originalSubtotal))
        : 0;
      const taxShare = originalSubtotal > 0
        ? round2((Number(original.tax) || 0) * (itemsTotal / originalSubtotal))
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
        tax: taxShare,
        taxInclusive: Number(original.tax_inclusive) === 1,
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
      const maxDays = Number(db.getSetting('return_policy_max_days', '0')) || 0;
      if (maxDays > 0 && original.created_at) {
        const diffDays = (Date.now() - new Date(original.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > maxDays) {
          throw new HttpError(400, `تجاوزت الفاتورة الحد المسموح للإرجاع (${maxDays} يوم)`);
        }
      }
      const originalItems = db.all('SELECT * FROM invoice_items WHERE invoice_id = ?', [original.id]);
      const requested = Array.isArray(ctx.body.items) ? ctx.body.items : null;
      const items = normalizeItems(mapReturnItems(originalItems, requested, 'الفاتورة الأصلية'));
      if ((ctx.body || {}).damaged === true) items.forEach((i) => { i.restock = false; });
      const itemsTotal = round2(items.reduce((s, i) => s + i.total, 0));
      const originalSubtotal = Number(original.subtotal) || 0;
      const taxShare = originalSubtotal > 0
        ? round2((Number(original.tax) || 0) * (itemsTotal / originalSubtotal))
        : 0;
      const refundMethod = PAY_METHODS.includes(original.payment_method) ? original.payment_method : 'cash';
      const result = persistInvoice({
        type: 'return_sale',
        posMode: original.pos_mode,
        customerId: original.customer_id,
        userId: ctx.user.id,
        shiftId: ctx.body.shift_id || null,
        items,
        discount: 0,
        tax: taxShare,
        taxInclusive: Number(original.tax_inclusive) === 1,
        paid: ctx.body.refund === false ? 0 : itemsTotal + (Number(original.tax_inclusive) === 1 ? 0 : taxShare),
        paymentMethod: refundMethod,
        notes: `${items.some((i) => i.restock === false) ? 'مرتجع تالف ' : 'مرتجع '}من الفاتورة ${original.invoice_no}`,
      });
      db.logActivity(ctx.user.id, 'sale_return', 'invoices', result.id, {
        source: original.invoice_no,
        damaged: items.filter((i) => i.restock === false).length,
      });
      sendJson(ctx.res, 201, { invoice: db.get('SELECT * FROM invoices WHERE id = ?', [result.id]), id: result.id });
    });
  },
};
