-- Preserve every accepted report and pending event while making uniqueness round-local.
-- Apply this migration transactionally, as with the normal D1 migrations command.
-- @statement
DROP TRIGGER article_reports_guard;
-- @statement
DROP TRIGGER article_reports_notify;
-- @statement
CREATE TABLE article_report_outbox_transfer AS SELECT * FROM article_report_outbox;
-- @statement
DROP TABLE article_report_outbox;
-- @statement
CREATE TABLE article_reports_next (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 content_id TEXT NOT NULL REFERENCES content(id),
 reporter_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 round INTEGER NOT NULL DEFAULT 1 CHECK(typeof(round)='integer' AND round BETWEEN 1 AND 9007199254740990),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 200),
 detail TEXT NOT NULL DEFAULT '' CHECK(length(detail)<=2000 AND length(CAST(detail AS BLOB))<=8000),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
 UNIQUE(content_id,round,reporter_account_id)
);
-- @statement
INSERT INTO article_reports_next(id,content_id,reporter_account_id,reason,detail,created_at_ms) SELECT id,content_id,reporter_account_id,reason,detail,created_at_ms FROM article_reports;
-- @statement
DROP TABLE article_reports;
-- @statement
ALTER TABLE article_reports_next RENAME TO article_reports;
-- @statement
CREATE INDEX article_reports_case ON article_reports(content_id,round,created_at_ms DESC,id);
-- @statement
CREATE TABLE article_report_outbox (
 id TEXT NOT NULL PRIMARY KEY,
 report_id TEXT NOT NULL UNIQUE REFERENCES article_reports(id),
 content_id TEXT NOT NULL REFERENCES content(id),
 report_count INTEGER NOT NULL CHECK(report_count BETWEEN 1 AND 3),
 event TEXT NOT NULL CHECK(event IN ('report_received','temporarily_hidden')),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state='pending'),
 CHECK((report_count<3 AND event='report_received') OR (report_count=3 AND event='temporarily_hidden'))
);
-- @statement
INSERT INTO article_report_outbox SELECT * FROM article_report_outbox_transfer;
-- @statement
DROP TABLE article_report_outbox_transfer;
-- @statement
CREATE TABLE article_moderation_state (
 content_id TEXT NOT NULL PRIMARY KEY REFERENCES content(id),
 round INTEGER NOT NULL CHECK(typeof(round)='integer' AND round BETWEEN 1 AND 9007199254740990),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740990)
);
-- @statement
INSERT INTO article_moderation_state SELECT content_id,1,COUNT(*) FROM article_reports GROUP BY content_id;
-- @statement
CREATE TRIGGER article_moderation_owner_stop_version AFTER INSERT ON article_publication_stops BEGIN
 UPDATE article_moderation_state SET version=version+1 WHERE content_id=NEW.content_id;
END;
-- @statement
CREATE TRIGGER article_reports_guard BEFORE INSERT ON article_reports BEGIN
 SELECT CASE WHEN NEW.reporter_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.reporter_account_id AND status='active') THEN RAISE(ABORT,'report unavailable') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM content WHERE id=NEW.content_id AND kind='article' AND status='published') OR NEW.round!=COALESCE((SELECT round FROM article_moderation_state WHERE content_id=NEW.content_id),1) OR (SELECT COUNT(*) FROM article_reports WHERE content_id=NEW.content_id AND round=NEW.round)>=3 THEN RAISE(ABORT,'report unavailable') END;
END;
-- @statement
CREATE TRIGGER article_reports_notify AFTER INSERT ON article_reports BEGIN
 INSERT INTO article_moderation_state(content_id,round,version) VALUES(NEW.content_id,NEW.round,1) ON CONFLICT(content_id) DO UPDATE SET version=version+1;
 INSERT INTO article_report_outbox(id,report_id,content_id,report_count,event,created_at_ms) SELECT NEW.id,NEW.id,NEW.content_id,COUNT(*),CASE WHEN COUNT(*)=3 THEN 'temporarily_hidden' ELSE 'report_received' END,NEW.created_at_ms FROM article_reports WHERE content_id=NEW.content_id AND round=NEW.round;
 UPDATE content SET status='hidden' WHERE id=NEW.content_id AND kind='article' AND status='published' AND (SELECT COUNT(*) FROM article_reports WHERE content_id=NEW.content_id AND round=NEW.round)=3;
END;
-- @statement
CREATE TABLE article_moderation_decisions (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 content_id TEXT NOT NULL REFERENCES content(id),
 operator_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 expected_round INTEGER NOT NULL CHECK(typeof(expected_round)='integer' AND expected_round BETWEEN 1 AND 9007199254740989),
 expected_version INTEGER NOT NULL CHECK(typeof(expected_version)='integer' AND expected_version BETWEEN 1 AND 9007199254740989),
 action TEXT NOT NULL CHECK(action IN ('restore','delete')),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000 AND instr(reason,char(0))=0 AND length(CAST(reason AS BLOB))<=4000),
 decided_at_ms INTEGER NOT NULL CHECK(typeof(decided_at_ms)='integer' AND decided_at_ms BETWEEN 0 AND 253402300799999),
 result_status TEXT NOT NULL CHECK(result_status=CASE action WHEN 'restore' THEN 'published' ELSE 'deleted' END),
 result_round INTEGER NOT NULL CHECK(result_round=expected_round+CASE action WHEN 'restore' THEN 1 ELSE 0 END),
 result_version INTEGER NOT NULL CHECK(result_version=expected_version+1),
 UNIQUE(content_id,expected_round,expected_version)
);
-- @statement
CREATE TABLE article_moderation_outbox (
 decision_id TEXT NOT NULL PRIMARY KEY REFERENCES article_moderation_decisions(id),
 content_id TEXT NOT NULL REFERENCES content(id),
 event TEXT NOT NULL CHECK(event IN ('restored','deleted')),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 253402300799999),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state='pending')
);
-- @statement
CREATE TRIGGER article_moderation_decisions_guard BEFORE INSERT ON article_moderation_decisions BEGIN
 SELECT CASE WHEN NEW.operator_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.operator_account_id AND status='active') OR NOT EXISTS(SELECT 1 FROM article_moderation_state s JOIN content c ON c.id=s.content_id WHERE s.content_id=NEW.content_id AND s.round=NEW.expected_round AND s.version=NEW.expected_version AND c.kind='article' AND c.status IN ('published','hidden') AND (NEW.action='delete' OR (c.status='hidden' AND NOT EXISTS(SELECT 1 FROM article_publication_stops WHERE content_id=c.id)))) OR (SELECT COUNT(*) FROM article_reports WHERE content_id=NEW.content_id AND round=NEW.expected_round) NOT BETWEEN 1 AND 3 OR EXISTS(SELECT 1 FROM article_reports WHERE content_id=NEW.content_id AND round=NEW.expected_round AND created_at_ms>NEW.decided_at_ms) THEN RAISE(ABORT,'moderation unavailable') END;
END;
-- @statement
CREATE TRIGGER article_moderation_decisions_apply AFTER INSERT ON article_moderation_decisions BEGIN
 UPDATE article_moderation_state SET round=NEW.result_round,version=NEW.result_version WHERE content_id=NEW.content_id AND round=NEW.expected_round AND version=NEW.expected_version;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'moderation unavailable') END;
 UPDATE content SET status=NEW.result_status WHERE id=NEW.content_id AND kind='article' AND status IN ('published','hidden');
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'moderation unavailable') END;
 INSERT INTO article_moderation_outbox(decision_id,content_id,event,created_at_ms) VALUES(NEW.id,NEW.content_id,CASE NEW.action WHEN 'restore' THEN 'restored' ELSE 'deleted' END,NEW.decided_at_ms);
END;
