-- Records the exact AutoCreator entitlement selected when Checkout was created.
-- Fulfillment remains pending until the AutoCreator write contract is implemented.
ALTER TABLE stripe_orders ADD COLUMN entitlement_id TEXT;
ALTER TABLE stripe_orders ADD COLUMN amount_cents INTEGER;
ALTER TABLE stripe_orders ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (fulfillment_status IN ('pending', 'granted', 'failed', 'revoked'));
CREATE INDEX IF NOT EXISTS stripe_orders_entitlement_idx ON stripe_orders(entitlement_id);
