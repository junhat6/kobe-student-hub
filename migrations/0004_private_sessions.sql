-- Local preparation only until separately authorized for remote application.
CREATE TABLE private_accounts (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
 google_subject TEXT NOT NULL UNIQUE CHECK(length(google_subject) BETWEEN 1 AND 255),
 email TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended','deleted')),
 session_epoch INTEGER NOT NULL DEFAULT 0 CHECK(session_epoch >= 0),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0)
);
CREATE TABLE auth_sessions (
 token_hash TEXT NOT NULL PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 account_epoch INTEGER NOT NULL CHECK(account_epoch >= 0),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
 last_seen_ms INTEGER NOT NULL CHECK(last_seen_ms >= created_at_ms),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > created_at_ms AND expires_at_ms <= created_at_ms+28800000 AND last_seen_ms < expires_at_ms),
 revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms)
);
CREATE INDEX session_expiry ON auth_sessions(expires_at_ms);
CREATE INDEX session_account ON auth_sessions(account_id);
CREATE TRIGGER account_status_session_epoch AFTER UPDATE OF status ON private_accounts
 WHEN OLD.status <> NEW.status
 BEGIN UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id=NEW.id; END;
