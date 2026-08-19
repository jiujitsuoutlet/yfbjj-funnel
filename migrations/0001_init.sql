-- 0001_init: funnel data layer for the $14 bundle + $360 lifetime upsell.

CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  stripe_session_id  TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  product            TEXT NOT NULL CHECK (product IN ('bundle', 'lifetime')),
  amount_cents       INTEGER NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'usd',
  status             TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS orders_email_idx      ON orders (email);
CREATE INDEX IF NOT EXISTS orders_customer_idx   ON orders (stripe_customer_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at);

-- Idempotency ledger. Every webhook writes here (INSERT OR IGNORE) BEFORE any
-- handler side effect; a zero-row result means the event was already processed.
CREATE TABLE IF NOT EXISTS webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  processed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  source     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS leads_email_idx      ON leads (email);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at);
