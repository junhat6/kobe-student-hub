-- ログイン直後のログアウトが isolate の時計差で落ちないよう、browser_command_execute の context 作成時刻の比較に 5 秒の許容を入れる（#277、#268 と同じ SESSION_CLOCK_SKEW_MS）。
-- context 行の created_at_ms は別の要求（時計の進んだ isolate のこともある）が書いた時刻なので、Worker 側の context()・command()・execute() と同じく <= に 5000 を足す。
-- 期限（expires_at_ms）・世代・失効 fence の比較は厳格なまま。
-- もう1か所：ログアウトで付ける revoked_at_ms を max(executed_at_ms, created_at_ms) にする。auth_sessions の CHECK（revoked_at_ms >= created_at_ms）は
-- 遅れた時計の失効時刻を拒み、ログアウト全体が ABORT になるため。失効の判定は revoked_at_ms IS NULL だけなので、時刻を作成時刻へ寄せても効き目は変わらない。
-- 0041 の trigger と変えるのはこの2か所だけ（表の CHECK は作り直さない）。
-- 条件を緩めるだけなので expand として扱え、旧版の Worker（自分の SQL で厳格に比べる）もそのまま動く。
-- DROP と CREATE は同じ batch（transaction）で当てるので、間にログイン・ログアウトの命令は入らない。
-- @statement
DROP TRIGGER browser_command_execute;
-- @statement
CREATE TRIGGER browser_command_execute AFTER UPDATE OF executed_at_ms ON auth_browser_commands WHEN OLD.executed_at_ms IS NULL AND NEW.executed_at_ms IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM auth_browser_contexts c,auth_revocation_fence f WHERE c.context_hash=NEW.context_hash AND c.generation=NEW.expected_generation AND c.generation<9007199254740991 AND c.created_at_ms<=NEW.executed_at_ms+5000 AND c.expires_at_ms>NEW.executed_at_ms AND f.id=1 AND NEW.revocation_fence>=f.minimum_generation) THEN RAISE(ABORT,'stale auth command') END;
 UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash=NEW.context_hash AND generation=NEW.expected_generation;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM auth_browser_contexts WHERE context_hash=NEW.context_hash AND generation=NEW.expected_generation+1) THEN RAISE(ABORT,'unconfirmed auth command') END;
 INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms,context_hash,context_generation,revocation_fence,intent) SELECT NEW.state_hash,NEW.browser_hash,NEW.nonce,NEW.executed_at_ms,NEW.attempt_expires_at_ms,NEW.context_hash,NEW.expected_generation+1,NEW.revocation_fence,NEW.action WHERE NEW.action<>'logout';
 UPDATE auth_sessions SET revoked_at_ms=max(NEW.executed_at_ms,created_at_ms) WHERE NEW.action='logout' AND token_hash=NEW.logout_token_hash AND context_hash=NEW.context_hash AND context_generation=NEW.expected_generation AND revoked_at_ms IS NULL;
END;
