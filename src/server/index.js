const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const db = require('./db');
const { Router, HttpError, sendJson, sendText, readBody, serveStatic, notFound } = require('./core/http');
const auth = require('./core/auth');
const jobs = require('./core/jobs');

const WEB_DIR = path.join(__dirname, '..', 'web');

const MODULES = [
  require('./modules/settings.routes'),
  require('./modules/auth.routes'),
  require('./modules/currency.routes'),
  require('./modules/products.routes'),
  require('./modules/partners.routes'),
  require('./modules/customers.routes'),
  require('./modules/suppliers.routes'),
  require('./modules/sales.routes'),
  require('./modules/statements.routes'),
  require('./modules/vouchers.routes'),
  require('./modules/accounting.routes'),
  require('./modules/shifts.routes'),
  require('./modules/users.routes'),
  require('./modules/ai.routes'),
  require('./modules/dashboard.routes'),
  require('./modules/print.routes'),
  require('./modules/export.routes'),
  require('./modules/backup.routes'),
  require('./modules/reminders.routes'),
  require('./modules/activity.routes'),
  require('./modules/search.routes'),
  require('./modules/scheduled.routes'),
  require('./modules/sync.routes'),
  require('./modules/license.routes'),
  require('./modules/branches.routes'),
  require('./modules/work_orders.routes'),
];

function buildRouter() {
  const router = new Router();
  for (const mod of MODULES) {
    mod.register(router);
  }
  return router;
}

function createServer() {
  db.init();
  const router = buildRouter();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      });
      res.end();
      return;
    }

    if (!pathname.startsWith('/api/') && !pathname.startsWith('/print/')) {
      if (pathname.startsWith('/images/')) {
        if (serveStatic(res, db.IMAGES_DIR, pathname.slice('/images'.length))) return;
        notFound(res);
        return;
      }
      if (serveStatic(res, WEB_DIR, pathname === '/' ? '/index.html' : pathname)) return;
      if (!path.extname(pathname)) {
        if (serveStatic(res, WEB_DIR, '/index.html')) return;
      }
      notFound(res);
      return;
    }

    let body = {};
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      try {
        body = await readBody(req);
      } catch (err) {
        sendJson(res, err.status || 400, { error: err.message });
        return;
      }
    }

    const matched = router.match(req.method, pathname);
    if (!matched) {
      notFound(res);
      return;
    }

    const { route, params } = matched;
    let sessionInfo = null;
    if (route.auth) {
      sessionInfo = auth.getSession(req, typeof body === 'object' ? body : {});
      if (!sessionInfo) {
        sendJson(res, 401, { error: 'يجب تسجيل الدخول', code: 'UNAUTHORIZED' });
        return;
      }
      if (route.roles && !route.roles.includes(sessionInfo.user.role)) {
        sendJson(res, 403, { error: 'لا تملك صلاحية الوصول' });
        return;
      }
    }

    const query = Object.fromEntries(url.searchParams.entries());
    const ctx = {
      params,
      query,
      body,
      req,
      res,
      session: sessionInfo ? sessionInfo.session : null,
      token: sessionInfo ? sessionInfo.token : null,
      user: sessionInfo ? sessionInfo.user : null,
      can: (perm) => auth.hasPermission(sessionInfo ? sessionInfo.user : null, perm),
    };

    try {
      await route.handler(ctx);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[zain]', err);
      sendJson(res, status, { error: err.message || 'خطأ في الخادم', code: err.code || null, details: err.details });
    }
  });

  const sweeper = setInterval(() => auth.sweep(), 1000 * 60 * 30);
  sweeper.unref();

  const jobTimer = jobs.start();

  server.on('close', () => { clearInterval(jobTimer); db.close(); });
  return { server, router };
}

function start(port = process.env.ZAIN_PORT || 4782, host = process.env.ZAIN_HOST || '0.0.0.0') {
  const { server } = createServer();
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port, host }));
  });
}

if (require.main === module) {
  const port = Number(process.env.ZAIN_PORT || 4782);
  const host = process.env.ZAIN_HOST || '0.0.0.0';
  start(port, host).then(({ port: p, host: h }) => {
    console.log(`Zain ERP server running: http://127.0.0.1:${p}  (db: ${db.DB_PATH})`);
    setTimeout(() => {
      console.log('Ready. Open the URL in Edge/Chrome (app mode recommended).');
    }, 100);
  });
}

module.exports = { createServer, start, buildRouter };
