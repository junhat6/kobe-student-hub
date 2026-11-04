-- Private intake preparation only. Notification delivery, restoration and retention remain unconfigured.
CREATE TABLE article_reports (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 content_id TEXT NOT NULL REFERENCES content(id),
 reporter_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 200),
 detail TEXT NOT NULL DEFAULT '' CHECK(length(detail)<=2000 AND length(CAST(detail AS BLOB))<=8000),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
 UNIQUE(content_id,reporter_account_id)
);
CREATE INDEX article_reports_case ON article_reports(content_id,created_at_ms DESC,id);
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
CREATE TRIGGER article_reports_guard BEFORE INSERT ON article_reports BEGIN SELECT CASE WHEN NEW.reporter_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.reporter_account_id AND status='active') THEN RAISE(ABORT,'report unavailable') END; SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM content WHERE id=NEW.content_id AND kind='article' AND status='published') OR (SELECT COUNT(*) FROM article_reports WHERE content_id=NEW.content_id)>=3 THEN RAISE(ABORT,'report unavailable') END; END;
CREATE TRIGGER article_reports_notify AFTER INSERT ON article_reports BEGIN INSERT INTO article_report_outbox(id,report_id,content_id,report_count,event,created_at_ms) SELECT NEW.id,NEW.id,NEW.content_id,COUNT(*),CASE WHEN COUNT(*)=3 THEN 'temporarily_hidden' ELSE 'report_received' END,NEW.created_at_ms FROM article_reports WHERE content_id=NEW.content_id; UPDATE content SET status='hidden' WHERE id=NEW.content_id AND kind='article' AND status='published' AND (SELECT COUNT(*) FROM article_reports WHERE content_id=NEW.content_id)=3; END;
