-- Private, transient attempts only. No production route creates these yet.
CREATE TABLE oauth_attempts (
 state_hash TEXT PRIMARY KEY CHECK(length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
 browser_hash TEXT NOT NULL CHECK(length(browser_hash) = 64 AND browser_hash NOT GLOB '*[^0-9a-f]*'),
 nonce TEXT NOT NULL CHECK(length(nonce) = 43),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > created_at_ms AND expires_at_ms <= created_at_ms + 600000),
 consumed_at_ms INTEGER CHECK(consumed_at_ms IS NULL OR (consumed_at_ms >= created_at_ms AND consumed_at_ms < expires_at_ms))
);
CREATE INDEX oauth_attempt_expiry ON oauth_attempts(expires_at_ms);
