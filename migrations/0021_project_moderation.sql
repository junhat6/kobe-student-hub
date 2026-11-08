-- Manual project judgments preserve all reports and immutable publication snapshots.
-- @statement
CREATE TABLE project_moderation_state (
 project_id TEXT NOT NULL PRIMARY KEY REFERENCES project_publications(id),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740990)
);
-- @statement
INSERT INTO project_moderation_state SELECT project_id,COUNT(*) FROM project_reports GROUP BY project_id;
-- @statement
CREATE TRIGGER project_reports_moderation_version AFTER INSERT ON project_reports BEGIN
 INSERT INTO project_moderation_state(project_id,version) VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET version=version+1;
END;
-- @statement
CREATE TRIGGER project_moderation_owner_stop_version AFTER INSERT ON project_publication_stops BEGIN
 UPDATE project_moderation_state SET version=version+1 WHERE project_id=NEW.project_id;
END;
-- @statement
CREATE TABLE project_moderation_decisions (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 project_id TEXT NOT NULL REFERENCES project_publications(id),
 operator_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 expected_version INTEGER NOT NULL CHECK(typeof(expected_version)='integer' AND expected_version BETWEEN 1 AND 9007199254740989),
 action TEXT NOT NULL CHECK(action IN ('hide','restore','delete')),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000 AND instr(reason,char(0))=0 AND length(CAST(reason AS BLOB))<=4000),
 decided_at_ms INTEGER NOT NULL CHECK(typeof(decided_at_ms)='integer' AND decided_at_ms BETWEEN 0 AND 253402300799999),
 result_status TEXT NOT NULL CHECK(result_status=CASE action WHEN 'hide' THEN 'hidden' WHEN 'restore' THEN 'published' ELSE 'deleted' END),
 result_version INTEGER NOT NULL CHECK(result_version=expected_version+1),
 UNIQUE(project_id,expected_version)
);
-- @statement
CREATE TABLE project_moderation_outbox (
 decision_id TEXT NOT NULL PRIMARY KEY REFERENCES project_moderation_decisions(id),
 project_id TEXT NOT NULL REFERENCES project_publications(id),
 event TEXT NOT NULL CHECK(event IN ('temporarily_hidden','restored','deleted')),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 253402300799999),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state='pending')
);
-- @statement
CREATE TRIGGER project_moderation_decisions_guard BEFORE INSERT ON project_moderation_decisions BEGIN
 SELECT CASE WHEN NEW.operator_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.operator_account_id AND status='active') OR NOT EXISTS(SELECT 1 FROM project_moderation_state s JOIN project_publications p ON p.id=s.project_id WHERE p.id=NEW.project_id AND s.version=NEW.expected_version AND ((NEW.action='hide' AND p.status='published') OR (NEW.action='restore' AND p.status='hidden' AND NOT EXISTS(SELECT 1 FROM project_publication_stops WHERE project_id=p.id)) OR (NEW.action='delete' AND p.status IN ('published','hidden')))) OR NOT EXISTS(SELECT 1 FROM project_reports WHERE project_id=NEW.project_id) OR EXISTS(SELECT 1 FROM project_reports WHERE project_id=NEW.project_id AND created_at_ms>NEW.decided_at_ms) THEN RAISE(ABORT,'project moderation unavailable') END;
END;
-- @statement
CREATE TRIGGER project_moderation_decisions_apply AFTER INSERT ON project_moderation_decisions BEGIN
 UPDATE project_moderation_state SET version=NEW.result_version WHERE project_id=NEW.project_id AND version=NEW.expected_version;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'project moderation unavailable') END;
 UPDATE project_publications SET status=NEW.result_status WHERE id=NEW.project_id AND status IN ('published','hidden');
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'project moderation unavailable') END;
 INSERT INTO project_moderation_outbox(decision_id,project_id,event,created_at_ms) VALUES(NEW.id,NEW.project_id,CASE NEW.action WHEN 'hide' THEN 'temporarily_hidden' WHEN 'restore' THEN 'restored' ELSE 'deleted' END,NEW.decided_at_ms);
END;
