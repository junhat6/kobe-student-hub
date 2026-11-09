-- References and the most recent visit only. No content snapshots or automatic expiry.
CREATE TABLE private_reading_history (
 owner_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('article','project')),
 content_id TEXT NOT NULL CHECK(length(content_id) BETWEEN 1 AND 128),
 last_viewed_at_ms INTEGER NOT NULL CHECK(last_viewed_at_ms BETWEEN 0 AND 253402300799999),
 PRIMARY KEY(owner_account_id,kind,content_id)
);
CREATE INDEX private_reading_history_recent ON private_reading_history(owner_account_id,last_viewed_at_ms DESC,kind,content_id);
CREATE TABLE private_reading_history_settings (
 owner_account_id TEXT PRIMARY KEY REFERENCES private_accounts(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
