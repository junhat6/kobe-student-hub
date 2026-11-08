-- Local preparation only. Login-purpose attempts have a separate sealed registration audience.
-- @statement
CREATE TABLE auth_self_registration_attempts (
 state_hash TEXT NOT NULL PRIMARY KEY REFERENCES oauth_attempts(state_hash) ON DELETE CASCADE,
 admission_year INTEGER NOT NULL CHECK(typeof(admission_year)='integer' AND admission_year BETWEEN 1900 AND 2199),
 graduation_year INTEGER NOT NULL CHECK(typeof(graduation_year)='integer' AND graduation_year BETWEEN admission_year AND 2199),
 policy_version INTEGER NOT NULL CHECK(policy_version=1)
);
-- @statement
CREATE TRIGGER self_registration_attempt_immutable BEFORE UPDATE ON auth_self_registration_attempts BEGIN
 SELECT RAISE(ABORT,'immutable registration attempt');
END;
-- @statement
CREATE TABLE auth_self_registration_commits (
 state_hash TEXT NOT NULL PRIMARY KEY REFERENCES oauth_attempts(state_hash) ON DELETE CASCADE,
 commit_id TEXT NOT NULL UNIQUE,
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 expected_epoch INTEGER NOT NULL CHECK(expected_epoch BETWEEN 0 AND 9007199254740991),
 prior_status TEXT NOT NULL CHECK(prior_status IN ('pending','active')),
 resulting_epoch INTEGER NOT NULL CHECK(resulting_epoch BETWEEN 0 AND 9007199254740991 AND resulting_epoch=expected_epoch+CASE prior_status WHEN 'pending' THEN 1 ELSE 0 END),
 resulting_fence INTEGER NOT NULL CHECK(resulting_fence BETWEEN 0 AND 9007199254740991),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 9007199254740991)
);
-- @statement
CREATE TRIGGER self_registration_commit_immutable BEFORE UPDATE ON auth_self_registration_commits BEGIN
 SELECT RAISE(ABORT,'immutable registration commit');
END;
