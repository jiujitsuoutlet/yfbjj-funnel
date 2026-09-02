-- Conversion events are directional product analytics only. Revenue and paid
-- conversion remain sourced from signed Stripe webhook records.
CREATE TABLE IF NOT EXISTS conversion_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'landing_view', 'checkout_start', 'checkout_error', 'offer_view',
    'offer_accept', 'offer_decline', 'access_click'
  )),
  variant TEXT,
  offer TEXT,
  source TEXT,
  device_class TEXT CHECK (device_class IS NULL OR device_class IN ('mobile', 'tablet', 'desktop')),
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversion_events_type_idx ON conversion_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS conversion_events_variant_idx ON conversion_events(variant, event_type, created_at);

CREATE TABLE IF NOT EXISTS conversion_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Small editor-managed images are stored in D1 so the editor remains a single
-- deployable Worker. Commerce configuration never enters this table.
CREATE TABLE IF NOT EXISTS editor_media (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 768000),
  data_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS editor_media_created_idx ON editor_media(created_at DESC);
