const db = require('../db');
const { sendJson, HttpError } = require('../core/http');

function baseCurrency() {
  const code = db.getSetting('base_currency', 'IQD');
  const row = db.get('SELECT * FROM currencies WHERE code = ?', [code]);
  if (row) return row;
  const fallback = db.get('SELECT * FROM currencies WHERE is_base = 1 LIMIT 1');
  if (fallback) return fallback;
  return { code, name: 'العملة الأساسية', symbol: db.getSetting('currency_symbol', 'د.ع'), rate: 1, decimals: 0, is_base: 1 };
}

function findCurrency(code) {
  if (!code) return null;
  return db.get('SELECT * FROM currencies WHERE code = ?', [String(code).toUpperCase()]) || null;
}

function currencyOf(code) {
  if (!code) return baseCurrency();
  const row = db.get('SELECT * FROM currencies WHERE code = ?', [String(code).toUpperCase()]);
  if (!row) throw new HttpError(400, 'العملة غير موجودة');
  if (!row.is_active && !row.is_base) throw new HttpError(400, 'العملة غير مفعلة');
  return row;
}

function toBase(amount, currency) {
  const value = Number(amount) || 0;
  if (!currency || currency.is_base || currency.rate === 1) return value;
  return value * Number(currency.rate);
}

function toForeign(amount, currency) {
  const value = Number(amount) || 0;
  if (!currency || currency.is_base || !Number(currency.rate)) return value;
  return value / Number(currency.rate);
}

function roundTo(value, decimals) {
  const d = Math.min(Math.max(Number(decimals) || 0, 0), 6);
  const factor = 10 ** d;
  return Math.round(Number(value) * factor) / factor;
}

function listCurrencies() {
  return db.all('SELECT * FROM currencies ORDER BY is_base DESC, code ASC');
}

function currencyReport() {
  const base = baseCurrency();
  const rows = db.all(
    `SELECT COALESCE(currency, ?) AS code,
            COUNT(*) AS invoices_count,
            COALESCE(SUM(total), 0) AS total_base,
            COALESCE(SUM(total_original), 0) AS total_original,
            COALESCE(SUM(due), 0) AS due_base,
            COALESCE(SUM(CASE WHEN due > 0 THEN (total_original - (paid_original * ?)) ELSE 0 END), 0) AS due_original
     FROM invoices
     WHERE type IN ('sale','return_sale')
     GROUP BY COALESCE(currency, ?)`,
    [base.code, base.rate, base.code]
  );
  const expenses = db.all(
    `SELECT COALESCE(currency, ?) AS code, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_base,
            COALESCE(SUM(amount_original), 0) AS total_original
     FROM expenses GROUP BY COALESCE(currency, ?)`,
    [base.code, base.code]
  );
  const vouchers = db.all(
    `SELECT COALESCE(currency, ?) AS code, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_base,
            COALESCE(SUM(amount_original), 0) AS total_original
     FROM vouchers GROUP BY COALESCE(currency, ?)`,
    [base.code, base.code]
  );
  const meta = new Map(listCurrencies().map((c) => [c.code, c]));
  const merge = (list) => list.map((r) => {
    const c = meta.get(r.code) || { code: r.code, name: r.code, symbol: '', decimals: 0 };
    return { ...r, name: c.name, symbol: c.symbol, decimals: c.decimals, rate: Number(c.rate) || 1 };
  });
  return {
    base,
    sales: merge(rows),
    expenses: merge(expenses),
    vouchers: merge(vouchers),
  };
}

module.exports = {
  baseCurrency,
  findCurrency,
  currencyOf,
  toBase,
  toForeign,
  roundTo,
  listCurrencies,
  currencyReport,
  register(router) {
    router.get('/api/currencies', (ctx) => {
      sendJson(ctx.res, 200, { rows: listCurrencies(), base: baseCurrency() });
    });

    router.get('/api/currencies/convert', (ctx) => {
      const base = baseCurrency();
      const target = currencyOf(ctx.query.to);
      const amount = Number(ctx.query.amount) || 0;
      const rate = Number(target.rate) || 1;
      sendJson(ctx.res, 200, {
        amount,
        from: base.code,
        to: target.code,
        rate,
        base_amount: roundTo(amount * rate, 6),
        foreign_amount: roundTo(amount / rate, target.decimals),
        symbol: target.symbol,
      });
    });

    router.post('/api/currencies', (ctx) => {
      if (!ctx.can('settings.write')) throw new HttpError(403, 'لا تملك صلاحية تعديل العملات');
      const body = ctx.body || {};
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z]{2,5}$/.test(code)) throw new HttpError(400, 'رمز العملة يجب أن يكون من 2 إلى 5 أحرف');
      if (db.get('SELECT code FROM currencies WHERE code = ?', [code])) throw new HttpError(400, 'العملة موجودة مسبقاً');
      const rate = Number(body.rate);
      if (!rate || rate <= 0) throw new HttpError(400, 'سعر الصرف غير صحيح');
      const name = String(body.name || code).trim();
      const symbol = String(body.symbol || code).trim();
      const decimals = Math.min(Math.max(Number(body.decimals) || 0, 0), 4);
      db.run(
        'INSERT INTO currencies (code, name, symbol, rate, decimals, is_active, is_base) VALUES (?, ?, ?, ?, ?, 1, 0)',
        [code, name, symbol, rate, decimals]
      );
      db.logActivity(ctx.user.id, 'create', 'currencies', null, { code, rate });
      sendJson(ctx.res, 201, { rows: listCurrencies(), base: baseCurrency() });
    });

    router.put('/api/currencies/:code', (ctx) => {
      if (!ctx.can('settings.write')) throw new HttpError(403, 'لا تملك صلاحية تعديل العملات');
      const code = String(ctx.params.code || '').toUpperCase();
      const row = db.get('SELECT * FROM currencies WHERE code = ?', [code]);
      if (!row) throw new HttpError(404, 'العملة غير موجودة');
      const body = ctx.body || {};
      const rate = body.rate === undefined ? Number(row.rate) : Number(body.rate);
      if (!rate || rate <= 0) throw new HttpError(400, 'سعر الصرف غير صحيح');
      const name = body.name === undefined ? row.name : String(body.name).trim();
      const symbol = body.symbol === undefined ? row.symbol : String(body.symbol).trim();
      const decimals = body.decimals === undefined ? row.decimals : Math.min(Math.max(Number(body.decimals) || 0, 0), 4);
      const isActive = body.is_active === undefined ? row.is_active : (body.is_active ? 1 : 0);
      db.run(
        'UPDATE currencies SET name = ?, symbol = ?, rate = ?, decimals = ?, is_active = ? WHERE code = ?',
        [name, symbol, rate, decimals, isActive, code]
      );
      db.logActivity(ctx.user.id, 'update', 'currencies', null, { code, rate });
      sendJson(ctx.res, 200, { rows: listCurrencies(), base: baseCurrency() });
    });

    router.delete('/api/currencies/:code', (ctx) => {
      if (!ctx.can('settings.write')) throw new HttpError(403, 'لا تملك صلاحية حذف العملات');
      const code = String(ctx.params.code || '').toUpperCase();
      const row = db.get('SELECT * FROM currencies WHERE code = ?', [code]);
      if (!row) throw new HttpError(404, 'العملة غير موجودة');
      if (row.is_base) throw new HttpError(400, 'لا يمكن حذف العملة الأساسية');
      const used = db.get('SELECT COUNT(*) AS c FROM invoices WHERE currency = ?', [code]);
      const usedExp = db.get('SELECT COUNT(*) AS c FROM expenses WHERE currency = ?', [code]);
      const usedVou = db.get('SELECT COUNT(*) AS c FROM vouchers WHERE currency = ?', [code]);
      if (used.c + usedExp.c + usedVou.c > 0) throw new HttpError(400, 'لا يمكن حذف عملة مستخدمة في فواتير أو مصروفات أو سندات');
      db.run('DELETE FROM currencies WHERE code = ?', [code]);
      db.logActivity(ctx.user.id, 'delete', 'currencies', null, { code });
      sendJson(ctx.res, 200, { rows: listCurrencies(), base: baseCurrency() });
    });

    router.get('/api/reports/currency', (ctx) => {
      sendJson(ctx.res, 200, currencyReport());
    });
  },
};
