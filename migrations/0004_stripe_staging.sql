-- Stripe staging ledger. This migration is intended for the separate staging
-- D1 database before production is considered.
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_orders (
  session_id TEXT PRIMARY KEY,
  customer_id TEXT,
  payment_intent_id TEXT,
  subscription_id TEXT,
  offer TEXT NOT NULL,
  price_id TEXT,
  email TEXT,
  status TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stripe_orders_customer_idx ON stripe_orders(customer_id);
CREATE INDEX IF NOT EXISTS stripe_orders_payment_idx ON stripe_orders(payment_intent_id);
