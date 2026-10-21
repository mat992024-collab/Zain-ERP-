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
  },
};
