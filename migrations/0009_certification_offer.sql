-- Add the final Certification OTO to the server-owned offer state machine and
-- the fixed editor page registry. SQLite cannot alter CHECK constraints in
-- place, so rename the old linked tables and rebuild their final forms.

ALTER TABLE offer_transitions RENAME TO offer_transitions_old;
ALTER TABLE checkout_flows RENAME TO checkout_flows_old;

CREATE TABLE checkout_flows (
  flow_hash TEXT PRIMARY KEY,
  root_session_id TEXT UNIQUE,
  customer_id TEXT,
  email TEXT,
  current_offer TEXT CHECK (current_offer IN ('head_to_toes', 'lifetime', 'two_month', 'certification')),
  status TEXT NOT NULL CHECK (status IN ('front_checkout', 'offer_ready', 'checkout_pending', 'complete', 'failed')),
  authorized_session_id TEXT,
  pending_session_id TEXT,
  pending_checkout_url TEXT,
  attribution TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  two_month_trial_end TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO checkout_flows (
  flow_hash, root_session_id, customer_id, email, current_offer, status,
  authorized_session_id, pending_session_id, pending_checkout_url, attribution,
  expires_at, two_month_trial_end, version, updated_at
)
SELECT
  flow_hash, root_session_id, customer_id, email, current_offer, status,
  authorized_session_id, pending_session_id, pending_checkout_url, attribution,
  expires_at, two_month_trial_end, version, updated_at
FROM checkout_flows_old;

CREATE TABLE offer_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_hash TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  offer TEXT NOT NULL CHECK (offer IN ('head_to_toes', 'lifetime', 'two_month', 'certification')),
  action TEXT NOT NULL CHECK (action IN ('accept', 'skip')),
  checkout_session_id TEXT,
  attribution TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (flow_hash) REFERENCES checkout_flows(flow_hash)
);

INSERT INTO offer_transitions (
  id, flow_hash, source_session_id, offer, action, checkout_session_id,
  attribution, created_at
)
SELECT
  id, flow_hash, source_session_id, offer, action, checkout_session_id,
  attribution, created_at
FROM offer_transitions_old;

DROP TABLE offer_transitions_old;
DROP TABLE checkout_flows_old;

CREATE UNIQUE INDEX offer_transition_checkout_idx
  ON offer_transitions(checkout_session_id) WHERE checkout_session_id IS NOT NULL;
CREATE INDEX offer_transition_root_idx
  ON offer_transitions(flow_hash, created_at);

ALTER TABLE editor_page_versions RENAME TO editor_page_versions_old;
ALTER TABLE editor_pages RENAME TO editor_pages_old;

CREATE TABLE editor_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key IN (
    'landing-a', 'landing-b', 'offer-head-to-toes', 'offer-lifetime',
    'offer-two-month', 'offer-certification', 'thanks-preview', 'thanks-pending',
    'thanks-failed', 'thanks-granted', 'thanks-activation', 'preview-checkout'
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

INSERT INTO editor_pages (
  page_key, title, draft_json, draft_revision, published_json,
  published_revision, published_at, updated_at, updated_by, last_operation_id
)
SELECT
  page_key, title, draft_json, draft_revision, published_json,
  published_revision, published_at, updated_at, updated_by, last_operation_id
FROM editor_pages_old;

CREATE TABLE editor_page_versions (
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

INSERT INTO editor_page_versions (
  id, page_key, revision, document_json, checksum, created_at, created_by
)
SELECT
  id, page_key, revision, document_json, checksum, created_at, created_by
FROM editor_page_versions_old;

DROP TABLE editor_page_versions_old;
DROP TABLE editor_pages_old;

CREATE INDEX editor_versions_page_idx
  ON editor_page_versions(page_key, revision DESC);

INSERT INTO editor_pages (page_key, title)
VALUES ('offer-certification', 'Offer: Certification');
