-- Runtime sentinel and durable idempotency boundary for entitlement writes.
-- Keep migration 0005 immutable for any environment where it was already
-- applied; the generic grant key is added here as a forward-compatible field.
ALTER TABLE stripe_orders ADD COLUMN entitlement_key TEXT;
CREATE INDEX IF NOT EXISTS stripe_orders_entitlement_key_idx
  ON stripe_orders(entitlement_key);

CREATE TABLE IF NOT EXISTS fulfillment_readiness (
  singleton TEXT PRIMARY KEY CHECK (singleton = 'runtime'),
  schema_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO fulfillment_readiness (singleton, schema_version, updated_at)
VALUES ('runtime', 1, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS entitlement_outbox (
  operation_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES stripe_orders(session_id)
);
CREATE INDEX IF NOT EXISTS entitlement_outbox_status_idx
  ON entitlement_outbox(status, lease_expires_at);
