-- Local fixture only. No production migration or grant is created.
CREATE TABLE limited_draft_grants (
 singleton INTEGER PRIMARY KEY DEFAULT 1 CHECK(singleton=1),
 account_id TEXT NOT NULL UNIQUE REFERENCES private_accounts(id),
 account_epoch INTEGER NOT NULL CHECK(account_epoch>=0),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>0),
 revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms>=0)
);
