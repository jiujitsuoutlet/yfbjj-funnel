-- 0003: A/B test attribution.
--
-- The variant has to survive into Stripe metadata and come back on the
-- webhook, otherwise the test measures clicks rather than money. It is stored
-- in three places for that reason: on the lead at capture time, on the order
-- when the webhook is wired, and as a visit counter so the denominator of the
-- conversion rate is real rather than inferred.

ALTER TABLE leads ADD COLUMN variant TEXT;
CREATE INDEX IF NOT EXISTS leads_variant_idx ON leads (variant);

ALTER TABLE orders ADD COLUMN variant TEXT;
CREATE INDEX IF NOT EXISTS orders_variant_idx ON orders (variant);

-- One row per variant per day. Written only when a human is newly assigned:
-- returning visitors, forced overrides and bots are never counted, so the
-- visitor number is the assignment count and nothing else.
CREATE TABLE IF NOT EXISTS variant_visits (
  variant TEXT NOT NULL,
  day     TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (variant, day)
);
