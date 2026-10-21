const db = require('../db');
const { sendJson, HttpError } = require('../core/http');

const KINDS = {
  customer: { table: 'customers', title: 'كشف حساب عميل', label: 'العميل' },
  supplier: { table: 'suppliers', title: 'كشف حساب مورد', label: 'المورد' },
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function daysBetween(from, to) {
  const a = new Date(`${String(from).slice(0, 10)}T00:00:00`);
  const b = new Date(`${String(to).slice(0, 10)}T00:00:00`);
  return Math.floor((b - a) / 86400000);
}

function partyOf(kind, id) {
  const conf = KINDS[kind];
  if (!conf) throw new HttpError(404, 'نوع الحساب غير معروف');
  const party = db.get(`SELECT * FROM ${conf.table} WHERE id = ?`, [id]);
  if (!party) throw new HttpError(404, `${conf.label} غير موجود`);
  return party;
}

function invoiceRows(kind, id) {
  if (kind === 'customer') {
    return db.all(
      `SELECT id, invoice_no, type, created_at, total, due, notes FROM invoices
       WHERE customer_id = ? AND type IN ('sale','return_sale') ORDER BY created_at, id`,
      [id]
    ).map((inv) => ({
      date: inv.created_at,
      kind: inv.type === 'sale' ? 'invoice' : 'return',
      ref: inv.invoice_no,
      description: inv.type === 'sale' ? 'فاتورة بيع آجل' : 'مرتجع بيع',
      debit: inv.type === 'sale' ? round2(inv.due) : 0,
      credit: inv.type === 'return_sale' ? round2(inv.total) : 0,
      due: inv.type === 'sale' ? round2(inv.due) : 0,
    }));
  }
  return db.all(
    `SELECT id, invoice_no, type, created_at, total, due, notes FROM invoices
     WHERE supplier_id = ? AND type IN ('purchase','return_purchase') ORDER BY created_at, id`,
    [id]
  ).map((inv) => ({
    date: inv.created_at,
    kind: inv.type === 'purchase' ? 'invoice' : 'return',
    ref: inv.invoice_no,
    description: inv.type === 'purchase' ? 'فاتورة شراء آجل' : 'مرتجع شراء',
    debit: inv.type === 'purchase' ? round2(inv.due) : 0,
    credit: inv.type === 'return_purchase' ? round2(inv.total) : 0,
    due: inv.type === 'purchase' ? round2(inv.due) : 0,
  }));
}

function paymentRows(kind, id) {
  const rows = [];
  if (kind === 'customer') {
    for (const t of db.all(
      `SELECT * FROM treasury WHERE source = 'customer_payment' AND ref_table = 'customers' AND ref_id = ? ORDER BY created_at, id`,
      [id]
    )) {
      rows.push({
        date: t.created_at,
        kind: 'payment',
        ref: `سداد #${t.id}`,
        description: t.description || 'سداد من العميل',
        debit: 0,
        credit: round2(t.amount),
        due: 0,
      });
    }
    for (const t of db.all(
      `SELECT t.*, s.invoice_id FROM treasury t JOIN installments s ON s.id = t.ref_id
       WHERE t.source = 'installment_payment' AND t.ref_table = 'installments' AND s.customer_id = ?
       ORDER BY t.created_at, t.id`,
      [id]
    )) {
      rows.push({
        date: t.created_at,
        kind: 'payment',
        ref: `قسط فاتورة #${t.invoice_id || '-'}`,
        description: t.description || 'تحصيل قسط',
        debit: 0,
        credit: round2(t.amount),
        due: 0,
      });
    }
  } else {
    for (const t of db.all(
      `SELECT * FROM treasury WHERE source = 'supplier_payment' AND ref_table = 'suppliers' AND ref_id = ? ORDER BY created_at, id`,
      [id]
    )) {
      rows.push({
        date: t.created_at,
        kind: 'payment',
        ref: `دفعة #${t.id}`,
        description: t.description || 'دفعة للمورد',
        debit: 0,
        credit: round2(t.amount),
        due: 0,
      });
    }
  }
  return rows;
}

function agingBuckets(kind, id, today) {
  const buckets = [
    { key: '0-30', label: 'حتى 30 يوم', amount: 0, count: 0 },
    { key: '31-60', label: '31 - 60 يوم', amount: 0, count: 0 },
    { key: '61-90', label: '61 - 90 يوم', amount: 0, count: 0 },
    { key: '90+', label: 'أكثر من 90 يوم', amount: 0, count: 0 },
  ];
  const type = kind === 'customer' ? 'sale' : 'purchase';
  const column = kind === 'customer' ? 'customer_id' : 'supplier_id';
  const invoices = db.all(
    `SELECT invoice_no, created_at, due FROM invoices WHERE ${column} = ? AND type = ? AND due > 0`,
    [id, type]
  );
  let oldest = 0;
  for (const inv of invoices) {
    const age = Math.max(0, daysBetween(inv.created_at, today));
    if (age > oldest) oldest = age;
    const idx = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
    buckets[idx].amount = round2(buckets[idx].amount + Number(inv.due));
    buckets[idx].count += 1;
  }
  return { buckets, oldest_days: oldest };
}

function buildStatement(kind, id, options = {}) {
  const party = partyOf(kind, id);
  const from = options.from || null;
  const to = options.to || null;
  const all = [...invoiceRows(kind, id), ...paymentRows(kind, id)]
    .filter((r) => (!from || r.date.slice(0, 10) >= from) && (!to || r.date.slice(0, 10) <= to))
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  const net = round2(all.reduce((s, r) => s + r.debit - r.credit, 0));
  const closing = round2(Number(party.balance) || 0);
  const opening = round2(closing - net);
  let running = opening;
  const rows = all.map((r) => {
    running = round2(running + r.debit - r.credit);
    return { ...r, balance: running };
  });
  const totals = {
    debit: round2(rows.reduce((s, r) => s + r.debit, 0)),
    credit: round2(rows.reduce((s, r) => s + r.credit, 0)),
    closing,
  };
  const today = db.get("SELECT date('now','localtime') AS d").d;
  const aging = agingBuckets(kind, id, today);
  const conf = KINDS[kind];
  return {
    kind,
    title: conf.title,
    party: {
      id: party.id,
      name: party.name,
      phone: party.phone || null,
      address: party.address || null,
      company: party.company || null,
      credit_limit: round2(party.credit_limit || 0),
      balance: closing,
    },
    period: { from, to },
    opening,
    rows,
    totals,
    aging: aging.buckets,
    oldest_days: aging.oldest_days,
    generated_at: db.get("SELECT datetime('now','localtime') AS t").t,
  };
}

module.exports = {
  buildStatement,
  register(router) {
    router.get('/api/statements/:kind/:id', (ctx) => {
      const statement = buildStatement(ctx.params.kind, ctx.params.id, {
        from: ctx.query.from || null,
        to: ctx.query.to || null,
      });
      sendJson(ctx.res, 200, statement);
    });
  },
};
