-- Project reports follow the article rule: the 3rd distinct active account temporarily hides a
-- published project (never deletes it) and every report queues one operator email event.
-- Existing reports are not replayed: no retroactive hide or email for rows inserted before this.
-- @statement
CREATE TABLE project_report_outbox (
 id TEXT NOT NULL PRIMARY KEY,
 report_id TEXT NOT NULL UNIQUE REFERENCES project_reports(id),
 project_id TEXT NOT NULL REFERENCES project_publications(id),
 report_count INTEGER NOT NULL CHECK(typeof(report_count)='integer' AND report_count>=1),
 event TEXT NOT NULL CHECK(event IN ('report_received','temporarily_hidden')),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 253402300799999),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state='pending'),
 CHECK((report_count<>3 AND event='report_received') OR (report_count=3 AND event='temporarily_hidden'))
);
-- @statement
CREATE TABLE project_moderation_email_deliveries (
 outbox_id TEXT NOT NULL PRIMARY KEY REFERENCES project_report_outbox(id),
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
CREATE INDEX project_moderation_email_state ON project_moderation_email_deliveries(state,updated_at_ms,outbox_id);
-- @statement
CREATE TRIGGER project_reports_threshold AFTER INSERT ON project_reports BEGIN
 INSERT INTO project_report_outbox(id,report_id,project_id,report_count,event,created_at_ms)
  SELECT NEW.id,NEW.id,NEW.project_id,COUNT(*),CASE WHEN COUNT(*)=3 THEN 'temporarily_hidden' ELSE 'report_received' END,NEW.created_at_ms
  FROM project_reports WHERE project_id=NEW.project_id;
 UPDATE project_publications SET status='hidden'
  WHERE id=NEW.project_id AND status='published' AND (SELECT COUNT(*) FROM project_reports WHERE project_id=NEW.project_id)=3;
END;
