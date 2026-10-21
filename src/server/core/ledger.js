const db = require('../db');

function currentTreasuryBalance() {
  const row = db.get('SELECT balance_after FROM treasury ORDER BY id DESC LIMIT 1');
  return row ? Number(row.balance_after) : 0;
}

function addTreasury({
  direction = 'in', amount = 0, source = 'other', refTable = null, refId = null,
  description = null, userId = null, shiftId = null,
} = {}) {
  const amt = Number(amount) || 0;
  const prev = currentTreasuryBalance();
  const balance = direction === 'out' ? prev - amt : prev + amt;
  db.run(
    `INSERT INTO treasury (direction, amount, source, ref_table, ref_id, description, user_id, shift_id, balance_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [direction, amt, source, refTable, refId, description, userId, shiftId, balance]
  );
  return balance;
}

function accountIdByCode(code) {
  const row = db.get('SELECT id FROM accounts WHERE code = ?', [String(code)]);
  return row ? row.id : null;
}

function addAccountEntry({ code, accountId, direction = 'debit', amount = 0, refTable = null, refId = null, description = null, date = null }) {
  const id = accountId || accountIdByCode(code);
  if (!id) return null;
  const amt = Number(amount) || 0;
  db.run(
    `INSERT INTO account_entries (account_id, direction, amount, ref_table, ref_id, description, date)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now','localtime')))`,
    [id, direction, amt, refTable, refId, description, date]
  );
  const delta = direction === 'debit' ? amt : -amt;
  db.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', [delta, id]);
  return id;
}

function accountBalance(id) {
  const row = db.get(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0) AS bal
     FROM account_entries WHERE account_id = ?`,
    [id]
  );
  return row ? Number(row.bal) : 0;
}

function nextInvoiceNo(type = 'sale') {
  const prefixMap = {
    sale: db.getSetting('invoice_prefix_sale', 'INV'),
    return_sale: 'RET',
    purchase: db.getSetting('invoice_prefix_purchase', 'PUR'),
    return_purchase: 'PRT',
  };
  const prefix = prefixMap[type] || 'INV';
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = db.get(`SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1`, [like]);
  let seq = 1;
  if (row) {
    const parts = row.invoice_no.split('-');
    seq = (Number(parts[parts.length - 1]) || 0) + 1;
  }
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

module.exports = { addTreasury, addAccountEntry, accountBalance, nextInvoiceNo, currentTreasuryBalance, accountIdByCode };
