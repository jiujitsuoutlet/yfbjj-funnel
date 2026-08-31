-- Cookie-bound, paid-session-authenticated post-purchase offer sequence.
ALTER TABLE stripe_orders ADD COLUMN root_session_id TEXT;
ALTER TABLE stripe_orders ADD COLUMN parent_session_id TEXT;
ALTER TABLE stripe_orders ADD COLUMN flow_hash TEXT;
ALTER TABLE stripe_orders ADD COLUMN access_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (access_state IN ('pending', 'active', 'activation_needed', 'failed'));

CREATE TABLE IF NOT EXISTS checkout_flows (
  flow_hash TEXT PRIMARY KEY,
  root_session_id TEXT UNIQUE,
  customer_id TEXT,
  email TEXT,
  current_offer TEXT CHECK (current_offer IN ('head_to_toes', 'lifetime', 'two_month')),
  status TEXT NOT NULL CHECK (status IN ('front_checkout', 'offer_ready', 'checkout_pending', 'complete', 'failed')),
  authorized_session_id TEXT,
  pending_session_id TEXT,
  pending_checkout_url TEXT,
  attribution TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  two_month_trial_end TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (root_session_id) REFERENCES stripe_orders(session_id)
);

CREATE TABLE IF NOT EXISTS offer_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_hash TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  offer TEXT NOT NULL CHECK (offer IN ('head_to_toes', 'lifetime', 'two_month')),
  action TEXT NOT NULL CHECK (action IN ('accept', 'skip')),
  checkout_session_id TEXT,
  attribution TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (flow_hash) REFERENCES checkout_flows(flow_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS offer_transition_checkout_idx
  ON offer_transitions(checkout_session_id) WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_transition_root_idx
  ON offer_transitions(flow_hash, created_at);
