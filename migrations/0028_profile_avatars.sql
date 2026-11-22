-- Profile icon images (#198). Expand only: new tables and triggers, no change to existing rows.
-- One small square image per public profile, stored in D1 like media_assets (no external storage).
-- The worker decodes every image before it is written; the table bounds keep a bypassed worker small.
-- Google photos are never copied here: only the student's own upload creates a row.
-- @statement
CREATE TABLE profile_avatars (
 public_profile_id TEXT NOT NULL PRIMARY KEY REFERENCES public_profiles(id),
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 width INTEGER NOT NULL CHECK(typeof(width)='integer' AND width BETWEEN 32 AND 256),
 height INTEGER NOT NULL CHECK(typeof(height)='integer' AND height=width),
 payload BLOB NOT NULL CHECK(typeof(payload)='blob' AND length(payload) BETWEEN 1 AND 65536),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE TRIGGER profile_avatars_insert BEFORE INSERT ON profile_avatars BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public_profiles p JOIN account_public_profiles m ON m.public_profile_id=p.id JOIN private_accounts a ON a.id=m.owner_account_id AND a.status='active' WHERE p.id=NEW.public_profile_id AND p.is_sample=0)
  OR (SELECT COUNT(*) FROM profile_avatars)>=4096
 THEN RAISE(ABORT,'avatar unavailable') END;
END;
-- @statement
CREATE TRIGGER profile_avatars_update BEFORE UPDATE ON profile_avatars BEGIN
 SELECT CASE WHEN NEW.public_profile_id!=OLD.public_profile_id OR NEW.updated_at_ms<OLD.updated_at_ms
  OR NOT EXISTS(SELECT 1 FROM public_profiles p JOIN account_public_profiles m ON m.public_profile_id=p.id JOIN private_accounts a ON a.id=m.owner_account_id AND a.status='active' WHERE p.id=NEW.public_profile_id AND p.is_sample=0)
 THEN RAISE(ABORT,'avatar unavailable') END;
END;
-- @statement
-- Operator removals. The row is the evidence and the owner's notice; the removed bytes are not kept.
CREATE TABLE profile_avatar_removals (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 public_profile_id TEXT NOT NULL REFERENCES public_profiles(id),
 owner_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 operator_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000 AND instr(reason,char(0))=0 AND length(CAST(reason AS BLOB))<=4000),
 decided_at_ms INTEGER NOT NULL CHECK(typeof(decided_at_ms)='integer' AND decided_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE INDEX profile_avatar_removals_owner ON profile_avatar_removals(owner_account_id,decided_at_ms DESC,id);
-- @statement
-- A removal needs an active operator, a report on that profile, and the exact image the operator saw.
CREATE TRIGGER profile_avatar_removals_guard BEFORE INSERT ON profile_avatar_removals BEGIN
 SELECT CASE WHEN NEW.operator_account_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.operator_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM profile_reports WHERE public_profile_id=NEW.public_profile_id)
  OR NOT EXISTS(SELECT 1 FROM profile_avatars WHERE public_profile_id=NEW.public_profile_id AND sha256=NEW.sha256)
  OR NEW.owner_account_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM account_public_profiles WHERE owner_account_id=NEW.owner_account_id AND public_profile_id=NEW.public_profile_id)
 THEN RAISE(ABORT,'avatar removal unavailable') END;
END;
-- @statement
CREATE TRIGGER profile_avatar_removals_apply AFTER INSERT ON profile_avatar_removals BEGIN
 DELETE FROM profile_avatars WHERE public_profile_id=NEW.public_profile_id AND sha256=NEW.sha256;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'avatar removal unavailable') END;
END;
-- @statement
CREATE TRIGGER profile_avatar_removals_immutable BEFORE UPDATE OF id,public_profile_id,operator_account_id,sha256,reason,decided_at_ms ON profile_avatar_removals BEGIN
 SELECT RAISE(ABORT,'avatar removal immutable');
END;
-- @statement
CREATE TRIGGER profile_avatar_removals_owner_only_null BEFORE UPDATE OF owner_account_id ON profile_avatar_removals WHEN NEW.owner_account_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'avatar removal immutable');
END;
-- @statement
-- Verifier note from #202: the reporter column may only be cleared by account deletion.
CREATE TRIGGER profile_reports_reporter_only_null BEFORE UPDATE OF reporter_account_id ON profile_reports WHEN NEW.reporter_account_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'profile report immutable');
END;
