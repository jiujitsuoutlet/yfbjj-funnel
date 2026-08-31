-- Safe, versioned funnel content editor. Commerce configuration never enters these tables.
CREATE TABLE IF NOT EXISTS editor_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key IN (
    'landing-a', 'landing-b', 'offer-head-to-toes', 'offer-lifetime', 'offer-two-month',
    'thanks-preview', 'thanks-pending', 'thanks-failed', 'thanks-granted',
    'thanks-activation', 'preview-checkout'
  )),
  title TEXT NOT NULL,
  draft_json TEXT,
  draft_revision INTEGER NOT NULL DEFAULT 0,
  published_json TEXT,
  published_revision INTEGER,
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT,
  last_operation_id TEXT
);

CREATE TABLE IF NOT EXISTS editor_page_versions (
  id TEXT PRIMARY KEY,
  page_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  document_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (page_key, revision),
  FOREIGN KEY (page_key) REFERENCES editor_pages(page_key)
);
CREATE INDEX IF NOT EXISTS editor_versions_page_idx ON editor_page_versions(page_key, revision DESC);

CREATE TABLE IF NOT EXISTS editor_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS editor_login_attempts (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS editor_audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('login', 'logout', 'draft_save', 'publish', 'restore')),
  page_key TEXT,
  revision INTEGER,
  created_at TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS editor_audit_page_idx ON editor_audit_log(page_key, created_at DESC);

INSERT OR IGNORE INTO editor_pages (page_key, title) VALUES
  ('landing-a', 'Landing A'),
  ('landing-b', 'Landing B'),
  ('offer-head-to-toes', 'Offer: Head to Toes'),
  ('offer-lifetime', 'Offer: Lifetime'),
  ('offer-two-month', 'Offer: Two Month'),
  ('thanks-preview', 'Thanks: Preview'),
  ('thanks-pending', 'Thanks: Pending'),
  ('thanks-failed', 'Thanks: Failed'),
  ('thanks-granted', 'Thanks: Granted'),
  ('thanks-activation', 'Thanks: Activation'),
  ('preview-checkout', 'Preview Checkout');
