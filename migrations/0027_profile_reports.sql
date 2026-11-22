-- Profile reports: a signed-in student reports a publicly visible author profile. Intake only.
-- No automatic hide (a profile is the author's whole public identity); operators review manually.
-- The report keeps a snapshot of the public text at report time, so later edits cannot erase evidence.
-- Every report queues one operator email event, reusing the article/project email spool design.
-- @statement
CREATE TABLE profile_reports (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 public_profile_id TEXT NOT NULL REFERENCES public_profiles(id),
 reporter_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason))>0 AND instr(reason,char(0))=0 AND length(CAST(reason AS BLOB))<=800),
 detail TEXT NOT NULL CHECK(instr(detail,char(0))=0 AND length(CAST(detail AS BLOB))<=8000),
 display_name TEXT NOT NULL CHECK(length(CAST(display_name AS BLOB))<=320),
 department TEXT NOT NULL CHECK(length(CAST(department AS BLOB))<=320),
 year_label TEXT NOT NULL CHECK(length(CAST(year_label AS BLOB))<=128),
 bio TEXT NOT NULL CHECK(length(CAST(bio AS BLOB))<=3200),
 created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 253402300799999),
 UNIQUE(public_profile_id,reporter_account_id)
);
-- @statement
CREATE INDEX profile_reports_recent ON profile_reports(public_profile_id,created_at_ms DESC,id ASC);
-- @statement
CREATE TRIGGER profile_reports_valid_insert BEFORE INSERT ON profile_reports BEGIN
 SELECT CASE WHEN NEW.reporter_account_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.reporter_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM public_profiles p WHERE p.id=NEW.public_profile_id AND p.is_sample=0 AND p.display_name=NEW.display_name AND p.department=NEW.department AND p.year_label=NEW.year_label AND p.bio=NEW.bio)
  OR EXISTS(SELECT 1 FROM account_public_profiles own WHERE own.owner_account_id=NEW.reporter_account_id AND own.public_profile_id=NEW.public_profile_id)
  OR NOT (EXISTS(SELECT 1 FROM content c WHERE c.author_id=NEW.public_profile_id AND c.kind='article' AND c.status='published' AND c.is_sample=0)
   OR EXISTS(SELECT 1 FROM project_publications r WHERE r.public_profile_id=NEW.public_profile_id AND r.status='published'))
 THEN RAISE(ABORT,'profile report unavailable') END;
END;
-- @statement
CREATE TRIGGER profile_reports_immutable BEFORE UPDATE OF public_profile_id,reason,detail,display_name,department,year_label,bio,created_at_ms ON profile_reports BEGIN
 SELECT RAISE(ABORT,'profile report immutable');
END;
-- @statement
CREATE TABLE profile_report_outbox (
 id TEXT NOT NULL PRIMARY KEY,
 report_id TEXT NOT NULL UNIQUE REFERENCES profile_reports(id),
 public_profile_id TEXT NOT NULL REFERENCES public_profiles(id),
 report_count INTEGER NOT NULL CHECK(typeof(report_count)='integer' AND report_count>=1),
 event TEXT NOT NULL CHECK(event='report_received'),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 253402300799999),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state='pending')
);
-- @statement
CREATE TABLE profile_moderation_email_deliveries (
 outbox_id TEXT NOT NULL PRIMARY KEY REFERENCES profile_report_outbox(id),
 state TEXT NOT NULL CHECK(state IN ('ready','leased','accepted','failed','unknown')),
 attempts INTEGER NOT NULL CHECK(typeof(attempts)='integer' AND attempts BETWEEN 1 AND 3),
 lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token)=36),
 lease_until_ms INTEGER CHECK(lease_until_ms IS NULL OR (typeof(lease_until_ms)='integer' AND lease_until_ms BETWEEN 0 AND 253402300799999)),
 provider_message_id TEXT CHECK(provider_message_id IS NULL OR (length(provider_message_id) BETWEEN 1 AND 256 AND instr(provider_message_id,char(0))=0)),
 updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 0 AND 253402300799999),
 CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until_ms IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until_ms IS NULL)),
 CHECK((state='accepted' AND provider_message_id IS NOT NULL) OR (state<>'accepted' AND provider_message_id IS NULL))
);
-- @statement
CREATE INDEX profile_moderation_email_state ON profile_moderation_email_deliveries(state,updated_at_ms,outbox_id);
-- @statement
CREATE TRIGGER profile_reports_outbox AFTER INSERT ON profile_reports BEGIN
 INSERT INTO profile_report_outbox(id,report_id,public_profile_id,report_count,event,created_at_ms)
  SELECT NEW.id,NEW.id,NEW.public_profile_id,COUNT(*),'report_received',NEW.created_at_ms
  FROM profile_reports WHERE public_profile_id=NEW.public_profile_id;
END;
