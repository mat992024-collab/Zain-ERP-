const db = require('../db');
const { sendJson, HttpError } = require('../core/http');

function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastDays(count = 30) {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = count - 1; i >= 0; i--) {
    const cur = new Date(d);
    cur.setDate(d.getDate() - i);
    out.push(localDate(cur));
  }
  return out;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function getSalesHistory(productId, days = 30) {
  const rows = db.all(
    `SELECT date(i.created_at) AS day, SUM(it.qty) AS qty
     FROM invoice_items it
     JOIN invoices i ON i.id = it.invoice_id
     WHERE it.product_id = ? AND i.type = 'sale' AND date(i.created_at) >= date('now','localtime', ?) AND date(i.created_at) <= date('now','localtime')
     GROUP BY day ORDER BY day`,
    [productId, `-${days} days`]
  );
  const map = new Map(rows.map((r) => [r.day, Number(r.qty)]));
  const daysArr = lastDays(days);
  return daysArr.map((d) => ({ day: d, qty: map.get(d) || 0 }));
}

function aiSalesAnalysis() {
  const top = db.all(
    `SELECT p.id, p.name, p.barcode, p.quantity, p.reorder_level, p.cost_price, p.sale_price,
       SUM(it.qty) AS sold, SUM(it.qty * it.unit_price) AS revenue
     FROM invoice_items it
     JOIN invoices i ON i.id = it.invoice_id
     JOIN products p ON p.id = it.product_id
     WHERE i.type='sale' AND date(i.created_at) >= date('now','localtime','-30 days')
     GROUP BY p.id ORDER BY sold DESC LIMIT 20`
  );
  const slow = db.all(
    `SELECT p.id, p.name, p.quantity, p.reorder_level,
       COALESCE(SUM(it.qty), 0) AS sold
     FROM products p
     LEFT JOIN invoice_items it ON it.product_id = p.id
     LEFT JOIN invoices i ON i.id = it.invoice_id AND i.type='sale' AND date(i.created_at) >= date('now','localtime','-30 days')
     GROUP BY p.id HAVING sold < 3 ORDER BY sold ASC, p.quantity DESC LIMIT 20`
  );
  const low = db.all(
    `SELECT p.id, p.name, p.barcode, p.quantity, p.reorder_level FROM products p
     WHERE p.quantity <= p.reorder_level AND p.is_active = 1 ORDER BY p.quantity ASC LIMIT 30`
  );
  return { top, slow, low };
}

function forecastStockouts(minConfidence = 0.4) {
  const products = db.all('SELECT id, name, quantity, reorder_level FROM products WHERE is_active = 1');
  const results = [];
  for (const p of products) {
    const hist = getSalesHistory(p.id, 30);
    const qtys = hist.map((h) => h.qty);
    const salesSum = qtys.reduce((a, b) => a + b, 0);
    if (salesSum === 0) continue;
    const avg = salesSum / (qtys.filter((q) => q > 0).length || 1);
    const med = median(qtys.filter((q) => q > 0).length ? qtys.filter((q) => q > 0) : qtys);
    const pred = (avg + med) / 2;
    if (pred < 0.0001) continue;
    const suggested = Math.ceil(pred * 14) || 1;
    const daysUntil = pred > 0 ? Number(p.quantity) / pred : null;
    const diffFromReorder = Number(p.quantity) - Number(p.reorder_level);
    const confidence = Math.min(0.95, salesSum / 15 + 0.2);
    if (confidence >= Number(minConfidence) && (Number(p.quantity) <= Number(p.reorder_level) || daysUntil < 14)) {
      results.push({
        product_id: p.id, product_name: p.name, predicted_daily: pred, suggested_qty: suggested,
        days_until_stockout: daysUntil ? Number(daysUntil.toFixed(1)) : null,
        confidence: Number(confidence.toFixed(2)),
        quantity: p.quantity, reorder_level: p.reorder_level,
        is_below_reorder: Number(p.quantity) <= Number(p.reorder_level),
      });
    }
    db.run('DELETE FROM ai_predictions WHERE product_id = ?', [p.id]);
    db.run(
      `INSERT INTO ai_predictions (product_id, predicted_daily, suggested_qty, days_until_stockout, confidence)
       VALUES (?, ?, ?, ?, ?)`,
      [p.id, pred, suggested, daysUntil ? daysUntil.toFixed(1) : null, confidence.toFixed(2)]
    );
  }
  return results.slice(0, 40);
}

function smartSuggestions(industry) {
  const base = aiSalesAnalysis();
  const low = base.low.map((item) => ({
    type: 'restock', title: `مستلزمات إعادة الطلب: ${item.name}`,
    body: `الكمية المتبقية ${item.quantity} أقل من حد الطلب ${item.reorder_level}`,
    priority: 'high', product_id: item.id,
  }));
  const slow = base.slow.map((item) => ({
    type: 'slow', title: `صنف بطيء الحركة: ${item.name}`,
    body: `مباع أقل من 3 وحدات خلال آخر 30 يوم`,
    priority: 'medium', product_id: item.id,
  }));
  const top = base.top.slice(0, 3).map((item) => ({
    type: 'opportunity', title: `فرصة بيع: ${item.name}`,
    body: `الأكثر مبيعاً، أرباح ${Number(item.revenue).toFixed(0)}`,
    priority: 'low', product_id: item.id,
  }));
  return [...low, ...slow, ...top].slice(0, 20);
}

module.exports = {
  aiSalesAnalysis, forecastStockouts, smartSuggestions, getSalesHistory, register(router) {
    router.get('/api/ai/analysis', (ctx) => {
      const data = aiSalesAnalysis();
      sendJson(ctx.res, 200, data);
    });
    router.get('/api/ai/forecast', (ctx) => {
      const min = Number(ctx.query.min_confidence || db.getSetting('ai_min_confidence', '0.4'));
      const list = forecastStockouts(min);
      sendJson(ctx.res, 200, { list, generated_at: new Date().toISOString() });
    });
    router.get('/api/ai/suggestions', (ctx) => {
      const settings = db.getSettings();
      const suggestions = smartSuggestions(settings.industry);
      sendJson(ctx.res, 200, { suggestions });
    });
    router.post('/api/ai/insight', (ctx) => {
      if (!ctx.can('ai.use')) throw new HttpError(403, 'لا تملك صلاحية الذكاء الاصطناعي');
      const { kind, title, body, severity, data } = ctx.body || {};
      if (!title || !kind) throw new HttpError(400, 'عنوان التنبؤ مطلوب');
      db.run(
        `INSERT INTO ai_insights (kind, severity, title, body, data) VALUES (?, ?, ?, ?, ?)`,
        [kind, severity || 'info', title, body || null, data ? JSON.stringify(data) : null]
      );
      sendJson(ctx.res, 201, { ok: true });
    });
    router.get('/api/ai/insights', (ctx) => {
      const rows = db.all('SELECT * FROM ai_insights ORDER BY id DESC LIMIT 30');
      sendJson(ctx.res, 200, { rows });
    });
  },
};
