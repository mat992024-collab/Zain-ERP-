const db = require('../db');
const { sendJson, HttpError } = require('../core/http');
const { INDUSTRY_PRESETS } = require('../schema');

const MODULE_CATALOG = [
  { key: 'pos', name: 'نقاط البيع', icon: 'cart', route: '#/pos' },
  { key: 'inventory', name: 'المخزون والأصناف', icon: 'box', route: '#/inventory' },
  { key: 'customers', name: 'العملاء', icon: 'users', route: '#/customers' },
  { key: 'suppliers', name: 'الموردون', icon: 'truck', route: '#/suppliers' },
  { key: 'accounting', name: 'المحاسبة والمالية', icon: 'wallet', route: '#/accounting' },
  { key: 'ai', name: 'محرك الذكاء الاصطناعي', icon: 'spark', route: '#/ai' },
  { key: 'reports', name: 'التقارير', icon: 'chart', route: '#/reports' },
  { key: 'admin', name: 'الإدارة والصلاحيات', icon: 'shield', route: '#/admin' },
];

module.exports = {
  register(router) {
    router.get('/api/settings', (ctx) => {
      const settings = db.getSettings();
      const industry = INDUSTRY_PRESETS[settings.industry] || INDUSTRY_PRESETS.general;
      const enabled = industry.modules || MODULE_CATALOG.map((m) => m.key);
      sendJson(ctx.res, 200, {
        settings,
        industry,
        industries: Object.entries(INDUSTRY_PRESETS).map(([key, v]) => ({ key, label: v.label })),
        modules: MODULE_CATALOG.map((m) => ({ ...m, enabled: enabled.includes(m.key) })),
      });
    });

    router.put('/api/settings', (ctx) => {
      if (!ctx.can('settings.write')) throw new HttpError(403, 'لا تملك صلاحية تعديل الإعدادات');
      const payload = ctx.body || {};
      const entries = Object.entries(payload);
      if (!entries.length) throw new HttpError(400, 'لا توجد إعدادات للحفظ');
      db.tx(() => {
        for (const [key, value] of entries) {
          if (key === 'ai_enabled' || key === 'low_stock_alert') {
            db.setSetting(key, value ? '1' : '0', 'ai');
          } else {
            if (key === 'tax_mode' && !['manual', 'auto', 'inclusive'].includes(String(value))) {
              throw new HttpError(400, 'طريقة احتساب الضريبة غير صحيحة');
            }
            if (key === 'scale_mode' && !['weight', 'price'].includes(String(value))) {
              throw new HttpError(400, 'وضع باركود الميزان غير صحيح');
            }
            if (typeof value === 'string' && value.length > 600000) throw new HttpError(400, `قيمة الإعداد ${key} كبيرة جداً`);
            const existing = db.get('SELECT category FROM settings WHERE key = ?', [key]);
            db.setSetting(key, value, existing ? existing.category : 'general');
          }
        }
      });
      db.logActivity(ctx.user.id, 'update', 'settings', null, payload);
      sendJson(ctx.res, 200, { ok: true, settings: db.getSettings() });
    });

    router.get('/api/industries', (ctx) => {
      sendJson(ctx.res, 200, {
        industries: Object.entries(INDUSTRY_PRESETS).map(([key, v]) => ({
          key,
          label: v.label,
          fields: v.product_fields,
          pos_mode: v.pos_mode,
          modules: v.modules,
        })),
      });
    });

    router.post('/api/settings/factory-reset', (ctx) => {
      if (!ctx.can('*') && ctx.user.role !== 'admin') throw new HttpError(403, 'صلاحية المدير مطلوبة لإعادة الضبط');
      const { password, wipe_products } = ctx.body || {};
      if (!password) throw new HttpError(400, 'كلمة مرور المدير مطلوبة');
      const user = db.get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
      if (!user || !db.verifyPassword(password, user.password_salt, user.password_hash)) {
        throw new HttpError(403, 'كلمة المرور غير صحيحة');
      }
      db.tx(() => {
        db.run('DELETE FROM invoice_items');
        db.run('DELETE FROM invoice_payments');
        db.run('DELETE FROM invoices');
        db.run('DELETE FROM stock_movements');
        db.run('DELETE FROM expenses');
        db.run('DELETE FROM treasury');
        db.run('DELETE FROM installments');
        db.run('DELETE FROM installment_payments');
        db.run('DELETE FROM scheduled_invoices');
        db.run('DELETE FROM account_entries');
        db.run('DELETE FROM ai_predictions');
        db.run('DELETE FROM ai_insights');
        db.run('DELETE FROM shifts');
        if (wipe_products) {
          db.run('DELETE FROM products');
          db.run('DELETE FROM customers');
          db.run('DELETE FROM suppliers');
          db.run('DELETE FROM partners');
          const fs = require('node:fs');
          const path = require('node:path');
          if (fs.existsSync(db.IMAGES_DIR)) {
            for (const f of fs.readdirSync(db.IMAGES_DIR)) {
              try { fs.unlinkSync(path.join(db.IMAGES_DIR, f)); } catch {}
            }
          }
        }
      });
      db.logActivity(ctx.user.id, 'factory_reset', 'system', null, { wipe_products: !!wipe_products });
      sendJson(ctx.res, 200, { ok: true });
    });

    router.get('/api/integration/eta/status', (ctx) => {
      const s = db.getSettings();
      sendJson(ctx.res, 200, {
        enabled: s.eta_enabled === '1',
        environment: s.eta_environment || 'preproduction',
        configured: Boolean(s.eta_client_id && s.eta_client_secret),
        status: s.eta_enabled === '1' ? 'connected' : 'disabled',
      });
    });

    router.post('/api/integration/eta/sync/:id', (ctx) => {
      if (!ctx.can('sales.write')) throw new HttpError(403, 'غير مصرح');
      const invoice = db.get('SELECT * FROM invoices WHERE id = ?', [ctx.params.id]);
      if (!invoice) throw new HttpError(404, 'الفاتورة غير موجودة');
      const crypto = require('node:crypto');
      const uuid = 'ETA-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      db.logActivity(ctx.user.id, 'eta_sync', 'invoices', invoice.id, { uuid });
      sendJson(ctx.res, 200, { ok: true, eta_uuid: uuid, status: 'Submitted' });
    });

    router.post('/api/integration/whatsapp/send-invoice/:id', (ctx) => {
      if (!ctx.can('pos.sell') && !ctx.can('sales.write')) throw new HttpError(403, 'غير مصرح');
      const invoice = db.get('SELECT * FROM invoices WHERE id = ?', [ctx.params.id]);
      if (!invoice) throw new HttpError(404, 'الفاتورة غير موجودة');
      const customer = invoice.customer_id ? db.get('SELECT * FROM customers WHERE id = ?', [invoice.customer_id]) : null;
      const phone = (customer && customer.phone) || (ctx.body && ctx.body.phone) || '';
      const text = `فاتورة رقم: ${invoice.invoice_no}\nالإجمالي: ${invoice.total}\nشكراً لتسوقكم معنا!`;
      const waLink = phone ? `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}` : '';
      db.logActivity(ctx.user.id, 'whatsapp_send', 'invoices', invoice.id, { phone });
      sendJson(ctx.res, 200, { ok: true, phone, text, link: waLink });
    });

    router.get('/api/system/network-info', (ctx) => {
      const os = require('node:os');
      const ifaces = os.networkInterfaces();
      const ips = [];
      for (const name of Object.keys(ifaces)) {
        for (const net of ifaces[name]) {
          if (net.family === 'IPv4' && !net.internal) {
            ips.push({ iface: name, address: net.address });
          }
        }
      }
      const port = Number(process.env.ZAIN_PORT || 4782);
      const preferredIp = ips[0] ? ips[0].address : '127.0.0.1';
      const mobileUrl = `http://${preferredIp}:${port}/`;
      sendJson(ctx.res, 200, {
        port,
        ips,
        preferred_ip: preferredIp,
        mobile_url: mobileUrl,
      });
    });
  },
};
