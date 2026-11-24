-- ログインの絶対期限を 8 時間から 365 日へ広げる（#269、DECISIONS 2026-11-24 の1・replan#24 の案A）。expand のみ。
-- 0004 の auth_sessions は CHECK で expires_at_ms<=created_at_ms+28800000 を固定しており、SQLite は CHECK を ALTER できないので表を作り直す。
-- 列・NULL 可否・外部キー・索引・trigger は 0004／0012／0014 と同じにし、変えるのは上限の数だけ（31536000000＝365日）。
-- 上限を広げるだけなので、旧版の Worker（8 時間で書く）もこの表にそのまま書ける。既存行はそのまま写し、期限は延ばさない。
-- auth_sessions を参照する外部キーは無い。browser_command_execute（auth_browser_commands の trigger、ログアウトの失効）は本文で auth_sessions を読むので、
-- D1 は旧表を消した後の RENAME をその trigger の検査で止める。いったん DROP し、0012 と1文字も変えずに作り直す（同じ batch の中なので、間にログアウトは入らない）。
-- 通常の D1 migrations と同じく1つの batch（transaction）で当てる。
-- @statement
DROP TRIGGER browser_command_execute;
-- @statement
CREATE TABLE auth_sessions_next (
 token_hash TEXT NOT NULL PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 account_epoch INTEGER NOT NULL CHECK(account_epoch >= 0),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
 last_seen_ms INTEGER NOT NULL CHECK(last_seen_ms >= created_at_ms),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > created_at_ms AND expires_at_ms <= created_at_ms+31536000000 AND last_seen_ms < expires_at_ms),
 revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms),
 context_hash TEXT REFERENCES auth_browser_contexts(context_hash),
 context_generation INTEGER,
 attempt_hash TEXT REFERENCES oauth_attempts(state_hash) ON DELETE SET NULL
);
-- @statement
INSERT INTO auth_sessions_next(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,revoked_at_ms,context_hash,context_generation,attempt_hash) SELECT token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,revoked_at_ms,context_hash,context_generation,attempt_hash FROM auth_sessions;
-- @statement
DROP TABLE auth_sessions;
-- @statement
ALTER TABLE auth_sessions_next RENAME TO auth_sessions;
-- @statement
CREATE TRIGGER browser_command_execute AFTER UPDATE OF executed_at_ms ON auth_browser_commands WHEN OLD.executed_at_ms IS NULL AND NEW.executed_at_ms IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM auth_browser_contexts c,auth_revocation_fence f WHERE c.context_hash=NEW.context_hash AND c.generation=NEW.expected_generation AND c.generation<9007199254740991 AND c.created_at_ms<=NEW.executed_at_ms AND c.expires_at_ms>NEW.executed_at_ms AND f.id=1 AND NEW.revocation_fence>=f.minimum_generation) THEN RAISE(ABORT,'stale auth command') END;
 UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash=NEW.context_hash AND generation=NEW.expected_generation;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM auth_browser_contexts WHERE context_hash=NEW.context_hash AND generation=NEW.expected_generation+1) THEN RAISE(ABORT,'unconfirmed auth command') END;
 INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms,context_hash,context_generation,revocation_fence,intent) SELECT NEW.state_hash,NEW.browser_hash,NEW.nonce,NEW.executed_at_ms,NEW.attempt_expires_at_ms,NEW.context_hash,NEW.expected_generation+1,NEW.revocation_fence,NEW.action WHERE NEW.action<>'logout';
 UPDATE auth_sessions SET revoked_at_ms=NEW.executed_at_ms WHERE NEW.action='logout' AND token_hash=NEW.logout_token_hash AND context_hash=NEW.context_hash AND context_generation=NEW.expected_generation AND revoked_at_ms IS NULL;
END;
-- @statement
CREATE INDEX session_expiry ON auth_sessions(expires_at_ms);
-- @statement
CREATE INDEX session_account ON auth_sessions(account_id);
-- @statement
CREATE UNIQUE INDEX session_one_attempt ON auth_sessions(attempt_hash) WHERE attempt_hash IS NOT NULL;
-- @statement
CREATE INDEX auth_session_context ON auth_sessions(context_hash);
-- @statement
CREATE TRIGGER session_attempt_complete AFTER INSERT ON auth_sessions WHEN NEW.attempt_hash IS NOT NULL BEGIN
 UPDATE oauth_attempts SET completed_at_ms=NEW.created_at_ms WHERE state_hash=NEW.attempt_hash;
END;
-- @statement
-- 未ログインの context 行は 8 時間のまま（匿名の bootstrap が live context の上限を1年占有しないため）。
-- セッションが成立したときだけ、その context 行の期限をセッションの期限まで延ばす（縮めることはしない）。
-- 旧版の Worker が書く 8 時間のセッションでも、context の期限より長くはならないので何も変わらない。
CREATE TRIGGER session_context_lifetime AFTER INSERT ON auth_sessions WHEN NEW.context_hash IS NOT NULL BEGIN
 UPDATE auth_browser_contexts SET expires_at_ms=NEW.expires_at_ms WHERE context_hash=NEW.context_hash AND generation=NEW.context_generation AND expires_at_ms<NEW.expires_at_ms;
END;
