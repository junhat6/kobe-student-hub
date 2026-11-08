-- Private normalized image bytes and immutable publication attachments. No external storage binding.
-- @statement
CREATE TABLE media_assets (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 owner_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 article_draft_id TEXT REFERENCES private_article_drafts(id) ON DELETE SET NULL,
 project_draft_id TEXT REFERENCES project_drafts(id) ON DELETE SET NULL,
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 width INTEGER NOT NULL CHECK(typeof(width)='integer' AND width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(typeof(height)='integer' AND height BETWEEN 1 AND 1600),
 payload BLOB NOT NULL CHECK(typeof(payload)='blob' AND length(payload) BETWEEN 1 AND 524288),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 253402300799999),
 CHECK(width*height<=CASE mime WHEN 'image/jpeg' THEN 524288 ELSE 1000000 END),
 CHECK(mime!='image/png' OR width*height<=524288 OR length(payload)<=65536),
 CHECK(article_draft_id IS NULL OR project_draft_id IS NULL)
);
-- @statement
CREATE INDEX media_owner ON media_assets(owner_account_id,created_at_ms,id);
-- @statement
CREATE INDEX media_article_draft ON media_assets(article_draft_id);
-- @statement
CREATE INDEX media_project_draft ON media_assets(project_draft_id);
-- @statement
CREATE TRIGGER media_assets_insert BEFORE INSERT ON media_assets BEGIN
 SELECT CASE WHEN NEW.owner_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active') OR (NEW.article_draft_id IS NULL AND NEW.project_draft_id IS NULL) OR (NEW.article_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private_article_drafts WHERE id=NEW.article_draft_id AND owner_account_id=NEW.owner_account_id)) OR (NEW.project_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_drafts WHERE id=NEW.project_draft_id AND owner_account_id=NEW.owner_account_id)) THEN RAISE(ABORT,'media unavailable') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM media_assets)>=4096 OR (SELECT COALESCE(SUM(length(payload)),0) FROM media_assets)+length(NEW.payload)>67108864 OR (SELECT COUNT(*) FROM media_assets WHERE owner_account_id=NEW.owner_account_id)>=128 OR (SELECT COALESCE(SUM(length(payload)),0) FROM media_assets WHERE owner_account_id=NEW.owner_account_id)+length(NEW.payload)>8388608 OR (SELECT COUNT(*) FROM media_assets WHERE (NEW.article_draft_id IS NOT NULL AND article_draft_id=NEW.article_draft_id) OR (NEW.project_draft_id IS NOT NULL AND project_draft_id=NEW.project_draft_id))>=8 THEN RAISE(ABORT,'media unavailable') END;
END;
-- @statement
CREATE TRIGGER media_assets_content_immutable BEFORE UPDATE OF id,mime,width,height,payload,sha256,created_at_ms ON media_assets BEGIN SELECT RAISE(ABORT,'immutable media'); END;
-- @statement
CREATE TRIGGER media_assets_no_retarget BEFORE UPDATE OF owner_account_id,article_draft_id,project_draft_id ON media_assets WHEN (NEW.owner_account_id IS NOT OLD.owner_account_id AND NEW.owner_account_id IS NOT NULL) OR (NEW.article_draft_id IS NOT OLD.article_draft_id AND NEW.article_draft_id IS NOT NULL) OR (NEW.project_draft_id IS NOT OLD.project_draft_id AND NEW.project_draft_id IS NOT NULL) BEGIN SELECT RAISE(ABORT,'immutable media owner'); END;
-- @statement
ALTER TABLE article_publications ADD COLUMN media_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_ids_json) AND json_type(media_ids_json)='array' AND json_array_length(media_ids_json)<=8);
-- @statement
ALTER TABLE project_publications ADD COLUMN media_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_ids_json) AND json_type(media_ids_json)='array' AND json_array_length(media_ids_json)<=8);
-- @statement
CREATE TRIGGER article_media_manifest_immutable BEFORE UPDATE OF media_ids_json ON article_publications WHEN NEW.media_ids_json!=OLD.media_ids_json BEGIN SELECT RAISE(ABORT,'immutable media manifest'); END;
-- @statement
CREATE TRIGGER project_media_manifest_immutable BEFORE UPDATE OF media_ids_json ON project_publications WHEN NEW.media_ids_json!=OLD.media_ids_json BEGIN SELECT RAISE(ABORT,'immutable media manifest'); END;
-- @statement
CREATE TABLE article_publication_media (
 content_id TEXT NOT NULL REFERENCES article_publications(content_id),
 media_id TEXT NOT NULL REFERENCES media_assets(id),
 PRIMARY KEY(content_id,media_id)
);
-- @statement
CREATE INDEX article_publication_media_asset ON article_publication_media(media_id);
-- @statement
CREATE TABLE project_publication_media (
 project_id TEXT NOT NULL REFERENCES project_publications(id),
 media_id TEXT NOT NULL REFERENCES media_assets(id),
 PRIMARY KEY(project_id,media_id)
);
-- @statement
CREATE INDEX project_publication_media_asset ON project_publication_media(media_id);
-- @statement
CREATE TRIGGER article_media_map_immutable_update BEFORE UPDATE ON article_publication_media BEGIN SELECT RAISE(ABORT,'immutable media grant'); END;
-- @statement
CREATE TRIGGER article_media_map_immutable_delete BEFORE DELETE ON article_publication_media BEGIN SELECT RAISE(ABORT,'immutable media grant'); END;
-- @statement
CREATE TRIGGER project_media_map_immutable_update BEFORE UPDATE ON project_publication_media BEGIN SELECT RAISE(ABORT,'immutable media grant'); END;
-- @statement
CREATE TRIGGER project_media_map_immutable_delete BEFORE DELETE ON project_publication_media BEGIN SELECT RAISE(ABORT,'immutable media grant'); END;
-- @statement
CREATE TRIGGER article_media_snapshot AFTER INSERT ON article_publications BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM media_assets m JOIN json_each(NEW.media_ids_json) ref ON ref.value=m.id JOIN private_article_drafts d ON d.id=NEW.draft_id WHERE ref.type='text' AND m.owner_account_id=NEW.owner_account_id AND m.article_draft_id=NEW.draft_id AND m.created_at_ms<=NEW.published_at_ms AND d.version=NEW.source_version AND instr(d.body,'/api/media/'||m.id)>0)!=json_array_length(NEW.media_ids_json) OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.media_ids_json))!=json_array_length(NEW.media_ids_json) THEN RAISE(ABORT,'media unavailable') END;
 INSERT INTO article_publication_media(content_id,media_id) SELECT NEW.content_id,value FROM json_each(NEW.media_ids_json);
END;
-- @statement
CREATE TRIGGER project_media_snapshot AFTER INSERT ON project_publications BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM media_assets m JOIN json_each(NEW.media_ids_json) ref ON ref.value=m.id WHERE ref.type='text' AND m.owner_account_id=NEW.owner_account_id AND m.project_draft_id=NEW.draft_id AND m.created_at_ms<=NEW.published_at_ms AND instr(NEW.description,'/api/media/'||m.id)>0)!=json_array_length(NEW.media_ids_json) OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.media_ids_json))!=json_array_length(NEW.media_ids_json) THEN RAISE(ABORT,'media unavailable') END;
 INSERT INTO project_publication_media(project_id,media_id) SELECT NEW.id,value FROM json_each(NEW.media_ids_json);
END;
