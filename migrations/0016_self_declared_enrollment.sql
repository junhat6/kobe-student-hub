-- Local preparation only. Two private self-declared academic years do not prove enrollment.
CREATE TABLE private_enrollment_periods (
 owner_account_id TEXT NOT NULL PRIMARY KEY REFERENCES private_accounts(id) ON DELETE CASCADE,
 admission_year INTEGER NOT NULL CHECK(typeof(admission_year)='integer' AND admission_year BETWEEN 1900 AND 2199),
 graduation_year INTEGER NOT NULL CHECK(typeof(graduation_year)='integer' AND graduation_year BETWEEN admission_year AND 2199),
 starts_at_ms INTEGER NOT NULL CHECK(typeof(starts_at_ms)='integer' AND starts_at_ms=CAST(strftime('%s',printf('%04d-04-01',admission_year)) AS INTEGER)*1000-32400000),
 ends_at_ms INTEGER NOT NULL CHECK(typeof(ends_at_ms)='integer' AND ends_at_ms=CAST(strftime('%s',printf('%04d-04-01',graduation_year+1)) AS INTEGER)*1000-32400000 AND ends_at_ms>starts_at_ms),
 policy_version INTEGER NOT NULL CHECK(typeof(policy_version)='integer' AND policy_version=1),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
 updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 0 AND 9007199254740991)
);
