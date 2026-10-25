-- 1. Create payment methods table
CREATE TABLE IF NOT EXISTS payment_methods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'INR',
  min_amount    INTEGER NOT NULL DEFAULT 1,
  max_amount    INTEGER NOT NULL DEFAULT 100000,
  description   TEXT NOT NULL DEFAULT '',
  qr_key        TEXT,
  auto_approve  INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 2. Create manual payments table
CREATE TABLE IF NOT EXISTS manual_payments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL,
  method_id          INTEGER NOT NULL,
  amount             INTEGER NOT NULL,
  currency           TEXT NOT NULL,
  utr                TEXT NOT NULL,
  screenshot_key     TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',
  credited_micro_usd INTEGER NOT NULL DEFAULT 0,
  admin_id           INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  decided_at         INTEGER
);

CREATE INDEX IF NOT EXISTS idx_manual_payments_status ON manual_payments(status, created_at DESC);

-- 3. Add INR exchange rate setting (1 INR = 12000 micro-USD)
INSERT OR IGNORE INTO settings (key, value) VALUES ('stars_per_inr', '6400');
