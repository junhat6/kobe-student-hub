-- Local preparation only. No remote scheduler or deletion policy is installed.
CREATE TABLE auth_maintenance_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 last_started_at_ms INTEGER CHECK(last_started_at_ms>=0)
);
INSERT INTO auth_maintenance_state(id,last_started_at_ms) VALUES(1,NULL);
CREATE INDEX auth_command_expiry ON auth_browser_commands(expires_at_ms,command_hash);
CREATE INDEX auth_command_context ON auth_browser_commands(context_hash,created_at_ms);
CREATE INDEX auth_attempt_context ON oauth_attempts(context_hash);
CREATE INDEX auth_session_context ON auth_sessions(context_hash);
CREATE INDEX auth_context_expiry ON auth_browser_contexts(expires_at_ms,context_hash);
CREATE INDEX auth_subject_floor_generation ON auth_subject_fences(generation);
CREATE INDEX auth_attempt_fence_expiry ON oauth_attempts(revocation_fence,expires_at_ms);
CREATE INDEX auth_command_live_fence_expiry ON auth_browser_commands(revocation_fence,expires_at_ms) WHERE executed_at_ms IS NULL;
