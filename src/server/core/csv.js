const { HttpError } = require('./http');

function cell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => {
    const v = typeof c.value === 'function' ? c.value(row) : row[c.key];
    return cell(v);
  }).join(','));
  return `\uFEFF${[head, ...body].join('\r\n')}\r\n`;
}

function sendCsv(res, filename, csv) {
  const body = Buffer.from(csv, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': body.length,
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function dateFilter(query, column) {
  const clauses = [];
  const params = [];
  if (query.from) {
    clauses.push(`${column} >= ?`);
    params.push(String(query.from));
  }
  if (query.to) {
    clauses.push(`${column} <= ?`);
    params.push(`${String(query.to)} 23:59:59`);
  }
  return { clauses, params };
}

function requirePerm(ctx, perm) {
  if (!ctx.can(perm)) throw new HttpError(403, 'لا تملك صلاحية تنفيذ هذه العملية');
}

module.exports = { cell, toCsv, sendCsv, dateFilter, requirePerm };
