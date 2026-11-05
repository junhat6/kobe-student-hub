-- Local preparation only; never apply remotely without a separate verified operation.
-- Legacy sessions must reauthenticate; nullable added columns never authorize a fallback.
-- @statement
CREATE TABLE auth_browser_contexts (
 context_hash TEXT PRIMARY KEY CHECK(length(context_hash)=64),
 generation INTEGER NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 9007199254740991),
 created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms)
);
-- @statement
CREATE TABLE auth_revocation_fence (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL CHECK(generation BETWEEN 0 AND 9007199254740991),minimum_generation INTEGER NOT NULL DEFAULT 0 CHECK(minimum_generation BETWEEN 0 AND generation));
-- @statement
INSERT INTO auth_revocation_fence(id,generation) VALUES(1,0);
-- @statement
CREATE TABLE auth_subject_fences(google_subject TEXT PRIMARY KEY,generation INTEGER NOT NULL CHECK(generation>0));
-- @statement
ALTER TABLE oauth_attempts ADD COLUMN context_hash TEXT REFERENCES auth_browser_contexts(context_hash);
-- @statement
ALTER TABLE oauth_attempts ADD COLUMN context_generation INTEGER;
-- @statement
ALTER TABLE oauth_attempts ADD COLUMN revocation_fence INTEGER;
-- @statement
ALTER TABLE oauth_attempts ADD COLUMN intent TEXT;
-- @statement
ALTER TABLE oauth_attempts ADD COLUMN claim_owner TEXT;
-- @statement
ALTER TABLE oauth_attempts ADD COLUMN completed_at_ms INTEGER;
-- @statement
ALTER TABLE auth_sessions ADD COLUMN context_hash TEXT REFERENCES auth_browser_contexts(context_hash);
-- @statement
ALTER TABLE auth_sessions ADD COLUMN context_generation INTEGER;
-- @statement
ALTER TABLE auth_sessions ADD COLUMN attempt_hash TEXT REFERENCES oauth_attempts(state_hash) ON DELETE SET NULL;
-- @statement
UPDATE auth_sessions SET revoked_at_ms=created_at_ms WHERE revoked_at_ms IS NULL;
-- @statement
CREATE UNIQUE INDEX session_one_attempt ON auth_sessions(attempt_hash) WHERE attempt_hash IS NOT NULL;
-- @statement
CREATE TABLE auth_browser_commands (
 command_hash TEXT PRIMARY KEY CHECK(length(command_hash)=64),
 context_hash TEXT NOT NULL REFERENCES auth_browser_contexts(context_hash),
 action TEXT NOT NULL CHECK(action IN('login','pending-registration','logout')),
 expected_generation INTEGER NOT NULL,
 revocation_fence INTEGER NOT NULL,
 created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 executed_at_ms INTEGER,
 state_hash TEXT,browser_hash TEXT,nonce TEXT,attempt_expires_at_ms INTEGER,
 logout_token_hash TEXT
);
-- @statement
CREATE TRIGGER browser_command_execute AFTER UPDATE OF executed_at_ms ON auth_browser_commands WHEN OLD.executed_at_ms IS NULL AND NEW.executed_at_ms IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM auth_browser_contexts c,auth_revocation_fence f WHERE c.context_hash=NEW.context_hash AND c.generation=NEW.expected_generation AND c.generation<9007199254740991 AND c.created_at_ms<=NEW.executed_at_ms AND c.expires_at_ms>NEW.executed_at_ms AND f.id=1 AND NEW.revocation_fence>=f.minimum_generation) THEN RAISE(ABORT,'stale auth command') END;
 UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash=NEW.context_hash AND generation=NEW.expected_generation;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM auth_browser_contexts WHERE context_hash=NEW.context_hash AND generation=NEW.expected_generation+1) THEN RAISE(ABORT,'unconfirmed auth command') END;
 INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms,context_hash,context_generation,revocation_fence,intent) SELECT NEW.state_hash,NEW.browser_hash,NEW.nonce,NEW.executed_at_ms,NEW.attempt_expires_at_ms,NEW.context_hash,NEW.expected_generation+1,NEW.revocation_fence,NEW.action WHERE NEW.action<>'logout';
 UPDATE auth_sessions SET revoked_at_ms=NEW.executed_at_ms WHERE NEW.action='logout' AND token_hash=NEW.logout_token_hash AND context_hash=NEW.context_hash AND context_generation=NEW.expected_generation AND revoked_at_ms IS NULL;
END;
-- @statement
CREATE TRIGGER session_attempt_complete AFTER INSERT ON auth_sessions WHEN NEW.attempt_hash IS NOT NULL BEGIN
 UPDATE oauth_attempts SET completed_at_ms=NEW.created_at_ms WHERE state_hash=NEW.attempt_hash;
END;
-- @statement
CREATE TRIGGER account_epoch_auth_fence AFTER UPDATE OF session_epoch ON private_accounts WHEN OLD.session_epoch<>NEW.session_epoch BEGIN UPDATE auth_revocation_fence SET generation=generation+1 WHERE id=1; INSERT INTO auth_subject_fences(google_subject,generation) SELECT NEW.google_subject,generation FROM auth_revocation_fence WHERE id=1 ON CONFLICT(google_subject) DO UPDATE SET generation=excluded.generation; END;
-- @statement
CREATE TRIGGER account_delete_auth_fence AFTER DELETE ON private_accounts BEGIN UPDATE auth_revocation_fence SET generation=generation+1 WHERE id=1; INSERT INTO auth_subject_fences(google_subject,generation) SELECT OLD.google_subject,generation FROM auth_revocation_fence WHERE id=1 ON CONFLICT(google_subject) DO UPDATE SET generation=excluded.generation; END;
