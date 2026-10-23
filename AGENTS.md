# AGENTS.md — Zain ERP

## المشروع
نظام محاسبي/ERP متعدد الصناعة + محرك ذكاء اصطناعي. عربي RTL، سطح مكتب.
Node.js built-in http + `node:sqlite`، صفر اعتماديات وقت التشغيل، Tailwind v4 يُبنى محلياً.

## أوامر مهمة
```bash
npm install            # مرة واحدة (devDependencies فقط: tailwindcss)
npm run build:css      # إلزامي بعد أي تعديل على src/web/styles.css
npm start              # تشغيل + فتح Edge/Chrome في وضع --app
npm run serve          # الخادم فقط (المنفذ 4180 أو ZAIN_PORT)
npm test               # 3 مجموعات: API + رسم شاشات + متصفح حقيقي
npm run test:api       # tests/e2e.js            (345 فحصاً)
npm run test:render    # tests/render.test.mjs   (14 فحصاً)
npm run test:ui        # tests/browser.test.mjs  (148 فحصاً)
npm run seed           # بيانات تجريبية
npm run reset          # تصفير القاعدة
npm run doctor         # فحص البيئة والقاعدة والأجهزة (0 أخطاء = جاهز)
```

## قواعد المشروع
- **بدون تعليقات في الكود** إطلاقاً.
- بدون `@apply` في Tailwind v4 — استخدم أصناف CSS مخصّصة في `src/web/styles.css`
  (`.card .btn .btn-primary .btn-ghost .btn-success .btn-danger .btn-warning .btn-sm
  .field .label .badge .badge-ok .badge-warn .badge-danger .badge-info .badge-mute
  .nav-item .kpi .kpi-row .kpi-icon .kpi-value .kpi-label .th .td .modal-backdrop .modal-panel`).
- التواريخ في SQLite: `datetime('now','localtime')`.
- المبالغ: `Number(v || 0).toLocaleString('ar-IQ')` (دالة `money` في `core.js`).
- RTL: `dir="rtl"` على `<html>`؛ التصميم من اليمين لليسار.
- المظهر: `data-theme="light|dark"` على `<html>`؛ الألوان عبر متغيرات CSS في `:root` و`[data-theme="dark"]` (لا Tailwind `dark:`).
- الواجهة الأمامية ESM: `src/web/js/**` (يوجد `src/web/js/package.json` بـ `{"type":"module"}`).
- أيقونات: Bootstrap Icons محلي في `src/web/assets/vendor/` — لا CDN إطلاقاً.
- الخط: Cairo محلي (`src/web/assets/vendor/cairo.css` + `fonts/`).
- لا موارد خارجية وقت التشغيل (مُتحقَّق منه في `tests/browser.test.mjs`).

## البنية
```
src/launcher.js              مشغّل التطبيق (يفتح المتصفح بوضع --app)
src/server/index.js          الراوتر + تقديم الملفات الثابتة
src/server/schema.js         الجداول + DEFAULT_SETTINGS + INDUSTRY_PRESETS + SYSTEM_ACCOUNTS
src/server/db.js             الاتصال + bootstrap (admin/admin)
src/server/doctor.js         فحص الجاهزية (بيئة/قاعدة/نسخ/مساحة/منفذ) — npm run doctor
src/server/core/             http, auth, crud, ledger, code128, csv, zip, jobs (نسخ تلقائي/تذكير/جدولة/أقساط متأخرة)
src/server/modules/          20 وحدة مسارات (statements للكشوف, activity لسجل النشاط, search للبحث السريع, scheduled للفواتير المجدولة)
src/web/index.html           الصدفة (login + shell + nav + content)
src/web/js/core.js           state, api, toast, modal, money, esc, field, openPrint, hasPerm, applyTheme, toggleTheme, downloadFile, copyText
src/web/js/main.js           bootstrap, hash-router, NAV, dashboard, وردية, دخول/خروج
src/web/js/views/            pos, inventory, contacts, sales, accounting, ai, admin, activity, search
src/web/styles.css           مصدر Tailwind (يبني assets/app.css)
tests/                       e2e.js, render.test.mjs, browser.test.mjs
docs/UAT.md                  دليل القبول اليدوي (أجهزة/طباعة/باركود/بدون إنترنت)
```

## قبل أي commit
1. `npm run build:css` إذا لزم.
2. `npm test` يجب أن يمرّ بالكامل (345 + 14 + 148) بدون console errors.
3. لا تدفع `data/` أو `node_modules/` (مستثناة في `.gitignore`).
4. صور الأصناف تُحفظ على القرص في `data/images/` وتُقدَّم من `/images/*`؛ لا تُخزَّن base64 في قاعدة البيانات.
5. النسخ الاحتياطي = أرشيف zip (بلا ضغط) يضم `zain.db` و`images/*` عبر `src/server/core/zip.js`؛ لا تُضاف اعتماديات خارجية.
6. قواعد الاختبار داخل `data/test/` (معزولة عن `data/zain.db` و`data/images/`).
