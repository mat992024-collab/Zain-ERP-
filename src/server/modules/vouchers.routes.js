const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const ledger = require('../core/ledger');
const currency = require('./currency.routes');

const PREFIX = { receipt: 'RCV', payout: 'PAY', transfer: 'TRF' };
const TYPE_LABEL = { receipt: 'سند قبض', payout: 'سند صرف', transfer: 'سند نقل' };

function nextVoucherNo(type) {
  const prefix = PREFIX[type] || 'VCH';
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = db.get(`SELECT voucher_no FROM vouchers WHERE voucher_no LIKE ? ORDER BY id DESC LIMIT 1`, [like]);
  let seq = 1;
  if (row) {
    const parts = row.voucher_no.split('-');
    seq = (Number(parts[parts.length - 1]) || 0) + 1;
  }
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

function partnerRow(partnerType, partnerId) {
  if (!partnerType || !partnerId) return null;
  const table = partnerType === 'supplier' ? 'suppliers' : 'customers';
  return db.get(`SELECT id, name FROM ${table} WHERE id = ?`, [partnerId]);
}

function insertVoucher(data) {
  const sql = `INSERT INTO vouchers (voucher_no, type, amount, partner_type, partner_id, partner_name, from_account, to_account, method, currency, exchange_rate, amount_original, description, user_id, shift_id, date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const res = db.run(sql, [
    data.voucher_no, data.type, data.amount, data.partner_type, data.partner_id, data.partner_name,
    data.from_account, data.to_account, data.method, data.currency, data.exchange_rate, data.amount_original,
    data.description, data.user_id, data.shift_id, data.date,
  ]);
  return Number(res.lastInsertRowid);
}

function postReceipt({ amount, partner, method, description, userId, shiftId, date, currencyCode, exchangeRate, amountOriginal }) {
  let voucherId;
  db.tx(() => {
    voucherId = insertVoucher({
      voucher_no: nextVoucherNo('receipt'), type: 'receipt', amount,
      partner_type: partner ? partner.type : null, partner_id: partner ? partner.id : null,
      partner_name: partner ? partner.name : null, from_account: null, to_account: '1100',
      method, currency: currencyCode, exchange_rate: exchangeRate, amount_original: amountOriginal,
      description, user_id: userId, shift_id: shiftId, date,
    });
    if (partner) {
      if (partner.type === 'supplier') db.run('UPDATE suppliers SET balance = balance - ? WHERE id = ?', [amount, partner.id]);
      else db.run('UPDATE customers SET balance = balance - ? WHERE id = ?', [amount, partner.id]);
    }
    ledger.addTreasury({
      direction: 'in', amount, source: 'voucher_receipt', refTable: 'vouchers', refId: voucherId,
      description: description || 'سند قبض', userId, shiftId,
    });
    ledger.addAccountEntry({ code: '1100', direction: 'debit', amount, refTable: 'vouchers', refId: voucherId, description: description || 'سند قبض' });
    ledger.addAccountEntry({ code: partner && partner.type === 'supplier' ? '2100' : '1300', direction: 'credit', amount, refTable: 'vouchers', refId: voucherId, description: description || 'سند قبض' });
  });
  return voucherId;
}

function postPayout({ amount, partner, method, description, userId, shiftId, date, currencyCode, exchangeRate, amountOriginal }) {
  let voucherId;
  db.tx(() => {
    voucherId = insertVoucher({
      voucher_no: nextVoucherNo('payout'), type: 'payout', amount,
      partner_type: partner ? partner.type : null, partner_id: partner ? partner.id : null,
      partner_name: partner ? partner.name : null, from_account: '1100', to_account: null,
      method, currency: currencyCode, exchange_rate: exchangeRate, amount_original: amountOriginal,
      description, user_id: userId, shift_id: shiftId, date,
    });
    if (partner) {
      if (partner.type === 'supplier') db.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [amount, partner.id]);
      else db.run('UPDATE customers SET balance = balance + ? WHERE id = ?', [amount, partner.id]);
    }
    ledger.addTreasury({
      direction: 'out', amount, source: 'voucher_payout', refTable: 'vouchers', refId: voucherId,
      description: description || 'سند صرف', userId, shiftId,
    });
    ledger.addAccountEntry({ code: partner && partner.type === 'supplier' ? '2100' : '1300', direction: 'debit', amount, refTable: 'vouchers', refId: voucherId, description: description || 'سند صرف' });
    ledger.addAccountEntry({ code: '1100', direction: 'credit', amount, refTable: 'vouchers', refId: voucherId, description: description || 'سند صرف' });
  });
  return voucherId;
}

function postTransfer({ amount, fromAccount, toAccount, description, userId, shiftId, date, currencyCode, exchangeRate, amountOriginal }) {
  let voucherId;
  db.tx(() => {
    voucherId = insertVoucher({
      voucher_no: nextVoucherNo('transfer'), type: 'transfer', amount,
      partner_type: null, partner_id: null, partner_name: null,
      from_account: fromAccount, to_account: toAccount, method: 'transfer',
      currency: currencyCode, exchange_rate: exchangeRate, amount_original: amountOriginal,
      description, user_id: userId, shift_id: shiftId, date,
    });
    if (fromAccount === '1100') {
      ledger.addTreasury({ direction: 'out', amount, source: 'voucher_transfer', refTable: 'vouchers', refId: voucherId, description: description || 'سند نقل', userId, shiftId });
    }
    if (toAccount === '1100') {
      ledger.addTreasury({ direction: 'in', amount, source: 'voucher_transfer', refTable: 'vouchers', refId: voucherId, description: description || 'سند نقل', userId, shiftId });
    }
    ledger.addAccountEntry({ code: fromAccount, direction: 'credit', amount, refTable: 'vouchers', refId: voucherId, description: description || 'سند نقل' });
    ledger.addAccountEntry({ code: toAccount, direction: 'debit', amount, refTable: 'vouchers', refId: voucherId, description: description || 'سند نقل' });
  });
  return voucherId;
}

function rebalanceTreasury() {
  const rows = db.all('SELECT id, direction, amount FROM treasury ORDER BY id');
  let bal = 0;
  for (const r of rows) {
    bal += r.direction === 'in' ? Number(r.amount) : -Number(r.amount);
    db.run('UPDATE treasury SET balance_after = ? WHERE id = ?', [bal, r.id]);
  }
}

function rebalanceAccounts() {
  const rows = db.all('SELECT id FROM accounts');
  for (const r of rows) {
    db.run('UPDATE accounts SET balance = ? WHERE id = ?', [ledger.accountBalance(r.id), r.id]);
  }
}

function reverseVoucher(voucher) {
  const amount = Number(voucher.amount) || 0;
  const partner = voucher.partner_id && voucher.partner_type
    ? { type: voucher.partner_type, id: voucher.partner_id }
    : null;
  db.tx(() => {
    if (voucher.type === 'receipt' && partner) {
      if (partner.type === 'supplier') db.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [amount, partner.id]);
      else db.run('UPDATE customers SET balance = balance + ? WHERE id = ?', [amount, partner.id]);
    }
    if (voucher.type === 'payout' && partner) {
      if (partner.type === 'supplier') db.run('UPDATE suppliers SET balance = balance - ? WHERE id = ?', [amount, partner.id]);
      else db.run('UPDATE customers SET balance = balance + ? WHERE id = ?', [amount, partner.id]);
    }
    db.run('DELETE FROM treasury WHERE ref_table = ? AND ref_id = ?', ['vouchers', voucher.id]);
    db.run('DELETE FROM account_entries WHERE ref_table = ? AND ref_id = ?', ['vouchers', voucher.id]);
    db.run('DELETE FROM vouchers WHERE id = ?', [voucher.id]);
    rebalanceTreasury();
    rebalanceAccounts();
  });
}

function buildZReport(date) {
  const day = date || db.get("SELECT date('now','localtime') AS d").d;
  const range = 'date(created_at) = date(?)';
  const sales = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total,
            COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0) AS cash,
            COALESCE(SUM(CASE WHEN payment_method='card' THEN total ELSE 0 END),0) AS card,
            COALESCE(SUM(CASE WHEN payment_method='credit' THEN total ELSE 0 END),0) AS credit
     FROM invoices WHERE type='sale' AND ${range}`, [day]
  );
  const returns = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM invoices WHERE type='return_sale' AND ${range}`, [day]
  );
  const expenses = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM expenses WHERE ${range}`, [day]
  );
  const vouchers = db.all(
    `SELECT type, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM vouchers WHERE date(date) = date(?) GROUP BY type`, [day]
  );
  const cashMove = db.get(
    `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS total_in,
            COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS total_out
     FROM treasury WHERE ${range}`, [day]
  );
  const topProducts = db.all(
    `SELECT it.name, COALESCE(SUM(it.qty),0) AS qty, COALESCE(SUM(it.total),0) AS total
     FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
     WHERE i.type='sale' AND ${range.replace(/created_at/g, 'i.created_at')}
     GROUP BY it.name ORDER BY total DESC LIMIT 10`, [day]
  );
  const hourly = db.all(
    `SELECT strftime('%H', created_at) AS hour, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
     FROM invoices WHERE type='sale' AND ${range} GROUP BY hour ORDER BY hour`, [day]
  );
  const shift = db.get(
    `SELECT * FROM shifts WHERE date(opened_at) = date(?) ORDER BY id DESC LIMIT 1`, [day]
  );
  const endBalance = db.get(
    `SELECT balance_after FROM treasury WHERE date(created_at) <= date(?) ORDER BY id DESC LIMIT 1`, [day]
  );
  const byType = { receipt: { count: 0, total: 0 }, payout: { count: 0, total: 0 }, transfer: { count: 0, total: 0 } };
  for (const v of vouchers) {
    if (byType[v.type]) byType[v.type] = { count: v.count, total: Number(v.total) };
  }
  const netSales = Number(sales.total) - Number(returns.total);
  return {
    date: day,
    generated_at: new Date().toISOString(),
    sales: {
      count: sales.count, total: Number(sales.total), cash: Number(sales.cash),
      card: Number(sales.card), credit: Number(sales.credit),
    },
    returns: { count: returns.count, total: Number(returns.total) },
    net_sales: netSales,
    expenses: { count: expenses.count, total: Number(expenses.total) },
    vouchers: byType,
    cash_movement: { in: Number(cashMove.total_in), out: Number(cashMove.total_out) },
    expected_cash: endBalance ? Number(endBalance.balance_after) : 0,
    hourly,
    top_products: topProducts,
    shift: shift || null,
  };
}

function buildExpiryReport(days = 30, includeAll = false) {
  const span = Math.min(Number(days) || 30, 365);
  const rows = db.all(
    `SELECT id, name, barcode, category, unit, quantity, cost_price, sale_price, expiry_date, reorder_level
     FROM products
     WHERE is_active = 1 AND track_expiry = 1 AND expiry_date IS NOT NULL AND expiry_date <> ''
     ORDER BY expiry_date ASC`
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const items = rows.map((p) => {
    const exp = new Date(`${p.expiry_date}T00:00:00`);
    const daysLeft = Number.isNaN(exp.getTime()) ? null : Math.round((exp - today) / 86400000);
    const criticalLimit = Math.min(7, span);
    let status = 'ok';
    if (daysLeft === null) status = 'unknown';
    else if (daysLeft < 0) status = 'expired';
    else if (daysLeft <= criticalLimit) status = 'critical';
    else if (daysLeft <= span) status = 'warning';
    return { ...p, days_left: daysLeft, status, value: Number(p.quantity) * Number(p.cost_price) };
  });
  const filtered = includeAll ? items : items.filter((i) => i.status === 'expired' || i.status === 'critical' || i.status === 'warning');
  return {
    days: span,
    rows: filtered,
    summary: {
      expired: items.filter((i) => i.status === 'expired').length,
      critical: items.filter((i) => i.status === 'critical').length,
      warning: items.filter((i) => i.status === 'warning').length,
      total: items.length,
      value_at_risk: filtered.reduce((s, i) => s + i.value, 0),
    },
  };
}

module.exports = {
  buildZReport,
  buildExpiryReport,
  register(router) {
    router.get('/api/vouchers', (ctx) => {
      const { type, from, to, partner_id, page = 1, page_size = 50 } = ctx.query;
      const where = [];
      const params = [];
      if (type) { where.push('type = ?'); params.push(type); }
      if (from) { where.push('date(created_at) >= date(?)'); params.push(from); }
      if (to) { where.push('date(created_at) <= date(?)'); params.push(to); }
      if (partner_id) { where.push('partner_id = ?'); params.push(partner_id); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Number(page_size) || 50, 500);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const rows = db.all(
        `SELECT v.*, u.full_name AS user_name FROM vouchers v LEFT JOIN users u ON u.id = v.user_id
         ${whereSql} ORDER BY v.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const totals = db.get(
        `SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS sum_amount FROM vouchers ${whereSql}`, params
      );
      sendJson(ctx.res, 200, { rows, total: totals.c, sum_amount: totals.sum_amount });
    });

    router.get('/api/vouchers/:id', (ctx) => {
      const voucher = db.get(
        `SELECT v.*, u.full_name AS user_name FROM vouchers v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = ?`,
        [ctx.params.id]
      );
      if (!voucher) throw new HttpError(404, 'السند غير موجود');
      sendJson(ctx.res, 200, { voucher });
    });

    router.post('/api/vouchers', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الإضافة');
      const body = ctx.body || {};
      const type = ['receipt', 'payout', 'transfer'].includes(body.type) ? body.type : 'receipt';
      const amount = Number(body.amount);
      if (!amount || amount <= 0) throw new HttpError(400, 'المبلغ غير صحيح');
      const date = body.date || db.get("SELECT date('now','localtime') AS d").d;
      const cur = currency.currencyOf(body.currency);
      const rate = Number(cur.rate) || 1;
      const amountOriginal = cur.is_base ? amount : currency.roundTo(amount / rate, cur.decimals);
      const shift = db.get(`SELECT id FROM shifts WHERE status='open' AND user_id = ? ORDER BY id DESC LIMIT 1`, [ctx.user.id]);
      const shiftId = shift ? shift.id : null;
      let voucherId;
      if (type === 'transfer') {
        const fromAccount = String(body.from_account || '1100');
        const toAccount = String(body.to_account || '');
        if (!toAccount) throw new HttpError(400, 'الحساب المحوّل إليه مطلوب');
        if (fromAccount === toAccount) throw new HttpError(400, 'لا يمكن النقل إلى نفس الحساب');
        const from = db.get('SELECT code FROM accounts WHERE code = ?', [fromAccount]);
        const to = db.get('SELECT code FROM accounts WHERE code = ?', [toAccount]);
        if (!from) throw new HttpError(400, 'حساب المصدر غير موجود');
        if (!to) throw new HttpError(400, 'حساب الوجهة غير موجود');
        voucherId = postTransfer({ amount, fromAccount, toAccount, description: body.description, userId: ctx.user.id, shiftId, date, currencyCode: cur.code, exchangeRate: rate, amountOriginal });
      } else {
        const partnerType = body.partner_type === 'supplier' ? 'supplier' : (body.partner_type === 'customer' ? 'customer' : null);
        let partner = null;
        if (partnerType && body.partner_id) {
          const found = partnerRow(partnerType, body.partner_id);
          if (!found) throw new HttpError(400, 'الطرف غير موجود');
          partner = { ...found, type: partnerType };
        }
        if (type === 'receipt') {
          voucherId = postReceipt({ amount, partner, method: body.method || 'cash', description: body.description, userId: ctx.user.id, shiftId, date, currencyCode: cur.code, exchangeRate: rate, amountOriginal });
        } else {
          voucherId = postPayout({ amount, partner, method: body.method || 'cash', description: body.description, userId: ctx.user.id, shiftId, date, currencyCode: cur.code, exchangeRate: rate, amountOriginal });
        }
      }
      db.logActivity(ctx.user.id, 'create', 'vouchers', voucherId, { type, amount });
      const voucher = db.get('SELECT * FROM vouchers WHERE id = ?', [voucherId]);
      sendJson(ctx.res, 201, { voucher, type_label: TYPE_LABEL[type] });
    });

    router.delete('/api/vouchers/:id', (ctx) => {
      if (!ctx.can('accounting.write')) throw new HttpError(403, 'لا تملك صلاحية الحذف');
      const voucher = db.get('SELECT * FROM vouchers WHERE id = ?', [ctx.params.id]);
      if (!voucher) throw new HttpError(404, 'السند غير موجود');
      reverseVoucher(voucher);
      db.logActivity(ctx.user.id, 'delete', 'vouchers', voucher.id, { type: voucher.type, amount: voucher.amount });
      sendJson(ctx.res, 200, { ok: true, balance: ledger.currentTreasuryBalance() });
    });

    router.get('/api/reports/z-report', (ctx) => {
      sendJson(ctx.res, 200, buildZReport(ctx.query.date));
    });

    router.get('/api/reports/expiring', (ctx) => {
      sendJson(ctx.res, 200, buildExpiryReport(ctx.query.days, ctx.query.include_all === '1'));
    });
  },
};
