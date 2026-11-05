-- Local preparation only. No operator is provisioned by this migration.
-- @statement
CREATE TABLE private_admission_operators (
 account_id TEXT PRIMARY KEY REFERENCES private_accounts(id) ON DELETE CASCADE,
 granted_at_ms INTEGER NOT NULL CHECK(granted_at_ms>=0),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>granted_at_ms),
 revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms>=granted_at_ms)
);
-- @statement
CREATE TABLE private_admission_audit (
 id TEXT PRIMARY KEY,
 actor_account_id TEXT NOT NULL,
 target_account_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('approve','withdraw')),
 expected_epoch INTEGER NOT NULL CHECK(expected_epoch>=0),
 review_reference TEXT NOT NULL CHECK(length(review_reference)=36),
 occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms>=0),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>occurred_at_ms),
 CHECK(actor_account_id<>target_account_id)
);
-- @statement
CREATE INDEX admission_audit_expiry ON private_admission_audit(expires_at_ms,id);
-- @statement
CREATE INDEX pending_account_expiry ON private_accounts(status,session_epoch,created_at_ms,id);
-- @statement
CREATE TRIGGER admission_audit_immutable BEFORE UPDATE ON private_admission_audit BEGIN
 SELECT RAISE(ABORT,'immutable admission audit');
END;
-- @statement
CREATE TRIGGER admission_apply AFTER INSERT ON private_admission_audit BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.target_account_id AND session_epoch=NEW.expected_epoch AND created_at_ms<=NEW.occurred_at_ms AND status=CASE NEW.action WHEN 'approve' THEN 'pending' ELSE 'active' END) THEN RAISE(ABORT,'stale admission decision') END;
 UPDATE private_accounts SET status=CASE NEW.action WHEN 'approve' THEN 'active' ELSE 'suspended' END WHERE id=NEW.target_account_id AND session_epoch=NEW.expected_epoch;
END;
-- @statement
CREATE TABLE private_admission_maintenance (
 id INTEGER PRIMARY KEY CHECK(id=1),
 last_run_ms INTEGER NOT NULL DEFAULT 0,
 run_id TEXT
);
-- @statement
INSERT INTO private_admission_maintenance(id) VALUES(1);
