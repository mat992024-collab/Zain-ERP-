const SCHEMA = `

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  permissions TEXT NOT NULL DEFAULT '[]',
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT,
  barcode TEXT UNIQUE,
  part_number TEXT,
  name TEXT NOT NULL,
  author TEXT,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  brand TEXT,
  unit TEXT NOT NULL DEFAULT 'قطعة',
  units TEXT NOT NULL DEFAULT '[]',
  cost_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  wholesale_price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 5,
  track_expiry INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  tax_rate REAL NOT NULL DEFAULT 0,
  image TEXT,
  supplier_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS product_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  currency TEXT NOT NULL,
  sale_price REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  wholesale_price REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(product_id, currency),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  type TEXT NOT NULL DEFAULT 'retail',
  balance REAL NOT NULL DEFAULT 0,
  credit_limit REAL NOT NULL DEFAULT 0,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  company TEXT,
  balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  branch TEXT DEFAULT 'main',
  opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  closing_balance REAL,
  expected_cash REAL,
  total_sales REAL NOT NULL DEFAULT 0,
  total_cash REAL NOT NULL DEFAULT 0,
  total_card REAL NOT NULL DEFAULT 0,
  total_wallet REAL NOT NULL DEFAULT 0,
  total_credit REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'sale',
  pos_mode TEXT NOT NULL DEFAULT 'retail',
  customer_id INTEGER,
  supplier_id INTEGER,
  user_id INTEGER,
  shift_id INTEGER,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  tax_inclusive INTEGER NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  due REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'completed',
  currency TEXT,
  exchange_rate REAL NOT NULL DEFAULT 1,
  total_original REAL,
  paid_original REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'قطعة',
  unit_price REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT,
  amount_original REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_method ON invoice_payments(method);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'عام',
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  currency TEXT,
  exchange_rate REAL NOT NULL DEFAULT 1,
  amount_original REAL,
  user_id INTEGER,
  shift_id INTEGER,
  date TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS treasury (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL DEFAULT 'in',
  amount REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'other',
  ref_table TEXT,
  ref_id INTEGER,
  description TEXT,
  user_id INTEGER,
  shift_id INTEGER,
  balance_after REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER,
  customer_id INTEGER NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  remaining REAL NOT NULL DEFAULT 0,
  installments_count INTEGER NOT NULL DEFAULT 1,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS installment_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installment_id INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  user_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (installment_id) REFERENCES installments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'asset',
  parent_id INTEGER,
  is_system INTEGER NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (parent_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS account_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  direction TEXT NOT NULL DEFAULT 'debit',
  amount REAL NOT NULL DEFAULT 0,
  ref_table TEXT,
  ref_id INTEGER,
  description TEXT,
  date TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  share_percent REAL NOT NULL DEFAULT 0,
  capital REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  direction TEXT NOT NULL DEFAULT 'in',
  qty REAL NOT NULL DEFAULT 0,
  balance_after REAL NOT NULL DEFAULT 0,
  reason TEXT,
  ref_table TEXT,
  ref_id INTEGER,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  predicted_daily REAL NOT NULL DEFAULT 0,
  suggested_qty REAL NOT NULL DEFAULT 0,
  days_until_stockout REAL,
  confidence REAL NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  rate REAL NOT NULL DEFAULT 1,
  decimals INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_base INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'receipt',
  amount REAL NOT NULL DEFAULT 0,
  partner_type TEXT,
  partner_id INTEGER,
  partner_name TEXT,
  from_account TEXT,
  to_account TEXT,
  method TEXT NOT NULL DEFAULT 'cash',
  currency TEXT,
  exchange_rate REAL NOT NULL DEFAULT 1,
  amount_original REAL,
  description TEXT,
  user_id INTEGER,
  shift_id INTEGER,
  date TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'custom',
  repeat_type TEXT NOT NULL DEFAULT 'daily',
  repeat_interval INTEGER NOT NULL DEFAULT 1,
  time_of_day TEXT NOT NULL DEFAULT '09:00',
  day_of_week INTEGER NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  next_run TEXT,
  last_run TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scheduled_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'sale',
  customer_id INTEGER,
  supplier_id INTEGER,
  items TEXT NOT NULL DEFAULT '[]',
  discount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'credit',
  notes TEXT,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  next_run TEXT NOT NULL,
  last_run TEXT,
  runs_count INTEGER NOT NULL DEFAULT 0,
  last_invoice_id INTEGER,
  user_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_treasury_created ON treasury(created_at);
CREATE INDEX IF NOT EXISTS idx_account_entries_account ON account_entries(account_id);
`;

const DEFAULT_SETTINGS = [
  ["company_name", "شركة زين التجارية", "general"],
  ["company_phone", "07700000000", "general"],
  ["company_address", "بغداد - العراق", "general"],
  ["company_tax_id", "", "general"],
  ["currency", "IQD", "general"],
  ["currency_symbol", "د.ع", "general"],
  ["base_currency", "IQD", "financial"],
  ["industry", "supermarket", "general"],
  ["language", "ar", "general"],
  ["theme", "zain", "appearance"],
  ["default_tax_rate", "0", "financial"],
  ["tax_mode", "manual", "financial"],
  ["receipt_footer", "شكراً لتسوقكم معنا", "printing"],
  ["printer_type", "thermal80", "printing"],
  ["printer_name", "", "printing"],
  ["print_copies", "1", "printing"],
  ["print_header_text", "", "printing"],
  ["print_header_sub", "", "printing"],
  ["print_footer_note", "", "printing"],
  ["print_invoice_note", "", "printing"],
  ["print_label_note", "", "printing"],
  ["print_show_logo", "0", "printing"],
  ["print_logo_data", "", "printing"],
  ["print_show_tax_id", "1", "printing"],
  ["print_show_cashier", "1", "printing"],
  ["print_font_size", "normal", "printing"],
  ["print_density", "normal", "printing"],
  ["label_width_mm", "40", "printing"],
  ["label_height_mm", "30", "printing"],
  ["barcode_prefix", "", "printing"],
  ["ai_enabled", "0", "ai"],
  ["ai_forecast_days", "30", "ai"],
  ["ai_safety_days", "7", "ai"],
  ["ai_min_confidence", "0.4", "ai"],
  ["low_stock_alert", "1", "inventory"],
  ["negative_stock", "0", "inventory"],
  ["auto_barcode", "1", "inventory"],
  ["default_pos_mode", "fast", "pos"],
  ["scale_enabled", "0", "pos"],
  ["scale_mode", "weight", "pos"],
  ["scale_prefix", "2", "pos"],
  ["scale_plu_len", "5", "pos"],
  ["scale_value_len", "5", "pos"],
  ["scale_value_decimals", "3", "pos"],
  ["invoice_prefix_sale", "INV", "financial"],
  ["invoice_prefix_purchase", "PUR", "financial"],
  ["shift_required", "0", "pos"],
  ["credit_limit_mode", "warn", "financial"],
  ["statement_period_days", "90", "financial"],
  ["auto_backup", "0", "backup"],
  ["auto_backup_time", "02:00", "backup"],
  ["auto_backup_keep", "7", "backup"],
  ["auto_backup_last", "", "backup"],
  ["backup_external_enabled", "0", "backup"],
  ["backup_external_dir", "", "backup"],
  ["backup_external_keep", "5", "backup"],
  ["backup_external_last", "", "backup"],
  ["backup_external_error", "", "backup"],
  ["reminder_daily_time", "08:00", "reminders"],
  ["reminder_expiry_days", "30", "reminders"],
  ["reminder_expiry", "1", "reminders"],
  ["reminder_low_stock", "1", "reminders"],
  ["reminder_debts", "1", "reminders"],
  ["reminder_sales_summary", "1", "reminders"],
  ["reminder_signature", "", "reminders"],
  ["reminder_last_digest", "", "reminders"],
  ["reminder_last_digest_at", "", "reminders"],
  ["zakat_rate", "2.5", "financial"],
  ["zakat_nisab_grams", "85", "financial"],
  ["zakat_gold_price", "0", "financial"],
  ["zakat_include_receivables", "1", "financial"],
  ["zakat_include_liabilities", "1", "financial"],
];

const INDUSTRY_PRESETS = {
  supermarket: {
    label: "سوبرماركت",
    product_fields: ["barcode", "unit", "expiry_date", "category"],
    pos_mode: "fast",
    modules: ["pos", "inventory", "accounting", "customers", "ai"],
  },
  bookstore: {
    label: "مكتبة",
    product_fields: ["barcode", "author", "part_number", "category"],
    pos_mode: "retail",
    modules: ["pos", "inventory", "accounting", "customers", "ai"],
  },
  spare_parts: {
    label: "قطع غيار",
    product_fields: ["part_number", "brand", "barcode", "category"],
    pos_mode: "retail",
    modules: ["pos", "inventory", "accounting", "customers", "ai"],
  },
  warehouse: {
    label: "مخازن",
    product_fields: ["barcode", "unit", "category"],
    pos_mode: "wholesale",
    modules: ["inventory", "accounting", "suppliers", "ai"],
  },
  general: {
    label: "عام",
    product_fields: ["barcode", "unit", "category"],
    pos_mode: "retail",
    modules: ["pos", "inventory", "accounting", "customers", "ai"],
  },
};

const SYSTEM_ACCOUNTS = [
  ["1000", "الأصول", "asset", null, 1],
  ["1100", "الخزنة النقدية", "asset", "1000", 1],
  ["1200", "المخزون", "asset", "1000", 1],
  ["1300", "حسابات العملاء (مدينون)", "asset", "1000", 1],
  ["2000", "الالتزامات", "liability", null, 1],
  ["2100", "حسابات الموردون (دائنون)", "liability", "2000", 1],
  ["2300", "ضريبة القيمة المضافة المستحقة", "liability", "2000", 1],
  ["3000", "رأس المال", "equity", null, 1],
  ["3100", "حسابات الشركاء", "equity", "3000", 1],
  ["4000", "الإيرادات", "revenue", null, 1],
  ["4100", "إيرادات المبيعات", "revenue", "4000", 1],
  ["5000", "المصروفات", "expense", null, 1],
  ["5100", "تكلفة البضاعة المباعة", "expense", "5000", 1],
  ["5200", "مصروفات تشغيلية", "expense", "5000", 1],
];

module.exports = { SCHEMA, DEFAULT_SETTINGS, INDUSTRY_PRESETS, SYSTEM_ACCOUNTS };
