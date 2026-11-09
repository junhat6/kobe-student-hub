-- Immutable article revisions; canonical content remains the current public projection.
-- @statement
CREATE TABLE article_publication_revisions (
 content_id TEXT NOT NULL REFERENCES article_publications(content_id),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 1000),
 source_version INTEGER NOT NULL CHECK(source_version BETWEEN 1 AND 9007199254740991),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200 AND length(CAST(title AS BLOB))<=800),
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) BETWEEN 1 AND 262144),
 summary TEXT NOT NULL CHECK(length(summary)<=300 AND length(CAST(summary AS BLOB))<=1200),
 tags_json TEXT NOT NULL CHECK(json_valid(tags_json) AND json_type(tags_json)='array' AND json_array_length(tags_json)<=5),
 audience TEXT NOT NULL CHECK(length(audience)<=200),
 prerequisite TEXT NOT NULL CHECK(length(prerequisite)<=200),
 outcome TEXT NOT NULL CHECK(length(outcome)<=200),
 minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 240),
 media_ids_json TEXT NOT NULL CHECK(json_valid(media_ids_json) AND json_type(media_ids_json)='array' AND json_array_length(media_ids_json)<=8),
 published_at_ms INTEGER NOT NULL CHECK(published_at_ms BETWEEN 0 AND 253402300799999),
 PRIMARY KEY(content_id,revision), UNIQUE(content_id,source_version)
);
-- @statement
INSERT INTO article_publication_revisions SELECT r.content_id,1,r.source_version,c.title,c.body,c.summary,c.tags_json,c.audience,c.prerequisite,c.outcome,c.minutes,r.media_ids_json,r.published_at_ms FROM article_publications r JOIN content c ON c.id=r.content_id;
-- @statement
CREATE TRIGGER article_revision_initial AFTER INSERT ON content WHEN EXISTS(SELECT 1 FROM article_publications WHERE content_id=NEW.id) BEGIN
 INSERT INTO article_publication_revisions SELECT NEW.id,1,r.source_version,NEW.title,NEW.body,NEW.summary,NEW.tags_json,NEW.audience,NEW.prerequisite,NEW.outcome,NEW.minutes,r.media_ids_json,r.published_at_ms FROM article_publications r WHERE r.content_id=NEW.id;
END;
-- @statement
CREATE TRIGGER article_revision_immutable_update BEFORE UPDATE ON article_publication_revisions BEGIN SELECT RAISE(ABORT,'immutable article revision'); END;
-- @statement
CREATE TRIGGER article_revision_immutable_delete BEFORE DELETE ON article_publication_revisions BEGIN SELECT RAISE(ABORT,'immutable article revision'); END;
-- @statement
CREATE TRIGGER article_revision_guard BEFORE INSERT ON article_publication_revisions WHEN NEW.revision>1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM article_publications r JOIN private_article_drafts d ON d.id=r.draft_id JOIN private_accounts a ON a.id=r.owner_account_id AND a.status='active' JOIN account_public_profiles map ON map.owner_account_id=a.id AND map.public_profile_id=r.public_profile_id JOIN public_profiles profile ON profile.id=r.public_profile_id AND profile.is_sample=0 JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id AND c.kind='article' AND c.is_sample=0 AND c.status='published' JOIN article_publication_revisions previous ON previous.content_id=r.content_id AND previous.revision=NEW.revision-1 WHERE length(trim(NEW.title,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND length(trim(NEW.body,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND instr(NEW.title,char(0))=0 AND instr(NEW.body,char(0))=0 AND r.content_id=NEW.content_id AND d.owner_account_id=r.owner_account_id AND d.version=NEW.source_version AND d.title=NEW.title AND d.body=NEW.body AND d.updated_at_ms<=NEW.published_at_ms AND previous.source_version<NEW.source_version AND previous.published_at_ms<=NEW.published_at_ms AND NOT EXISTS(SELECT 1 FROM article_publication_revisions later WHERE later.content_id=r.content_id AND later.revision>=NEW.revision) AND NOT EXISTS(SELECT 1 FROM article_publication_stops WHERE content_id=r.content_id) AND NOT EXISTS(SELECT 1 FROM article_reports report WHERE report.content_id=r.content_id AND report.round=COALESCE((SELECT round FROM article_moderation_state WHERE content_id=r.content_id),1))) THEN RAISE(ABORT,'revision unavailable') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM media_assets m JOIN json_each(NEW.media_ids_json) ref ON ref.value=m.id JOIN article_publications r ON r.content_id=NEW.content_id WHERE ref.type='text' AND m.owner_account_id=r.owner_account_id AND m.article_draft_id=r.draft_id AND m.created_at_ms<=NEW.published_at_ms AND instr(NEW.body,'/api/media/'||m.id)>0)!=json_array_length(NEW.media_ids_json) OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.media_ids_json))!=json_array_length(NEW.media_ids_json) THEN RAISE(ABORT,'media unavailable') END;
END;
-- @statement
CREATE TRIGGER article_revision_project AFTER INSERT ON article_publication_revisions WHEN NEW.revision>1 BEGIN
 UPDATE content SET title=NEW.title,body=NEW.body,summary=NEW.summary,tags_json=NEW.tags_json,audience=NEW.audience,prerequisite=NEW.prerequisite,outcome=NEW.outcome,minutes=NEW.minutes,updated_at=strftime('%Y-%m-%d',NEW.published_at_ms/1000,'unixepoch') WHERE id=NEW.content_id AND status='published';
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'revision unavailable') END;
END;
-- @statement
CREATE TABLE article_report_revisions (
 report_id TEXT NOT NULL PRIMARY KEY REFERENCES article_reports(id),
 content_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 FOREIGN KEY(content_id,revision) REFERENCES article_publication_revisions(content_id,revision)
);
-- @statement
INSERT INTO article_report_revisions SELECT report.id,report.content_id,1 FROM article_reports report JOIN article_publication_revisions revision ON revision.content_id=report.content_id AND revision.revision=1;
-- @statement
CREATE TRIGGER article_report_revision_capture AFTER INSERT ON article_reports WHEN EXISTS(SELECT 1 FROM article_publication_revisions WHERE content_id=NEW.content_id) BEGIN
 INSERT INTO article_report_revisions SELECT NEW.id,NEW.content_id,MAX(revision) FROM article_publication_revisions WHERE content_id=NEW.content_id;
END;
-- @statement
CREATE TRIGGER article_report_revision_immutable_update BEFORE UPDATE ON article_report_revisions BEGIN SELECT RAISE(ABORT,'immutable reported revision'); END;
-- @statement
CREATE TRIGGER article_report_revision_immutable_delete BEFORE DELETE ON article_report_revisions BEGIN SELECT RAISE(ABORT,'immutable reported revision'); END;
-- @statement
DROP TRIGGER article_publication_stops_valid;
-- @statement
CREATE TRIGGER article_publication_stops_valid BEFORE INSERT ON article_publication_stops BEGIN
 SELECT CASE WHEN NEW.owner_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM article_publications r JOIN content c ON c.id=r.content_id JOIN private_accounts a ON a.id=r.owner_account_id AND a.status='active' JOIN article_publication_revisions current ON current.content_id=r.content_id AND current.revision=(SELECT MAX(revision) FROM article_publication_revisions WHERE content_id=r.content_id) WHERE r.content_id=NEW.content_id AND r.owner_account_id=NEW.owner_account_id AND current.source_version=NEW.source_version AND current.published_at_ms<=NEW.stopped_at_ms AND c.status='published' AND c.kind='article' AND c.is_sample=0 AND c.author_id=r.public_profile_id) THEN RAISE(ABORT,'publication stop unavailable') END;
END;
