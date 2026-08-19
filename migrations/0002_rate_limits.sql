-- 0002: sustained-window rate limiting for unauthenticated POST /api/lead.
-- Burst (5/min) is handled by the Workers Rate Limiting binding in memory at
-- the edge; this table only carries the 30/hour sustained window, so writes
-- here are already capped at 5/min/IP by the layer in front of it.
--
-- bucket_key is SHA-256(client IP). Raw IPs are never stored.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key   TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);
