-- Raise the image limits for image-rich articles (#195, owner policy 2026-11-22).
-- Per draft/publication/revision 8 -> 24 images; per owner 128 images / 8 MiB -> 512 / 64 MiB;
-- site 4096 images / 64 MiB -> 16384 / 2 GiB. Values match src/shared/media.ts.
--
-- Only raises limits, so the previous Worker keeps working: it still refuses a 9th image itself.
-- A column CHECK cannot be altered, and rebuilding these tables would have to move the foreign
-- keys that point at them. Instead each media_ids_json column is swapped in place: copy, drop,
-- re-add with the new CHECK, copy back. Every trigger that names the column (or would block the
-- copy) is dropped first and recreated with the same body. article_revision_initial gains an
-- explicit column list because media_ids_json moves to the end of article_publication_revisions.
-- Apply transactionally, as with the normal D1 migrations command.
-- @statement
DROP TRIGGER article_media_manifest_immutable;
-- @statement
DROP TRIGGER project_media_manifest_immutable;
-- @statement
DROP TRIGGER article_media_snapshot;
-- @statement
DROP TRIGGER project_media_snapshot;
-- @statement
DROP TRIGGER article_revision_initial;
-- @statement
DROP TRIGGER article_revision_guard;
-- @statement
DROP TRIGGER article_revision_immutable_update;
-- @statement
DROP TRIGGER media_assets_insert;
-- @statement
ALTER TABLE article_publications ADD COLUMN media_ids_carry TEXT;
-- @statement
UPDATE article_publications SET media_ids_carry=media_ids_json;
-- @statement
ALTER TABLE article_publications DROP COLUMN media_ids_json;
-- @statement
ALTER TABLE article_publications ADD COLUMN media_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_ids_json) AND json_type(media_ids_json)='array' AND json_array_length(media_ids_json)<=24);
-- @statement
UPDATE article_publications SET media_ids_json=media_ids_carry;
-- @statement
ALTER TABLE article_publications DROP COLUMN media_ids_carry;
-- @statement
ALTER TABLE project_publications ADD COLUMN media_ids_carry TEXT;
-- @statement
UPDATE project_publications SET media_ids_carry=media_ids_json;
-- @statement
ALTER TABLE project_publications DROP COLUMN media_ids_json;
-- @statement
ALTER TABLE project_publications ADD COLUMN media_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_ids_json) AND json_type(media_ids_json)='array' AND json_array_length(media_ids_json)<=24);
-- @statement
UPDATE project_publications SET media_ids_json=media_ids_carry;
-- @statement
ALTER TABLE project_publications DROP COLUMN media_ids_carry;
-- @statement
ALTER TABLE article_publication_revisions ADD COLUMN media_ids_carry TEXT;
-- @statement
UPDATE article_publication_revisions SET media_ids_carry=media_ids_json;
-- @statement
ALTER TABLE article_publication_revisions DROP COLUMN media_ids_json;
-- @statement
ALTER TABLE article_publication_revisions ADD COLUMN media_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_ids_json) AND json_type(media_ids_json)='array' AND json_array_length(media_ids_json)<=24);
-- @statement
UPDATE article_publication_revisions SET media_ids_json=media_ids_carry;
-- @statement
ALTER TABLE article_publication_revisions DROP COLUMN media_ids_carry;
-- @statement
CREATE TRIGGER media_assets_insert BEFORE INSERT ON media_assets BEGIN
 SELECT CASE WHEN NEW.owner_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active') OR (NEW.article_draft_id IS NULL AND NEW.project_draft_id IS NULL) OR (NEW.article_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private_article_drafts WHERE id=NEW.article_draft_id AND owner_account_id=NEW.owner_account_id)) OR (NEW.project_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_drafts WHERE id=NEW.project_draft_id AND owner_account_id=NEW.owner_account_id)) THEN RAISE(ABORT,'media unavailable') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM media_assets)>=16384 OR (SELECT COALESCE(SUM(length(payload)),0) FROM media_assets)+length(NEW.payload)>2147483648 OR (SELECT COUNT(*) FROM media_assets WHERE owner_account_id=NEW.owner_account_id)>=512 OR (SELECT COALESCE(SUM(length(payload)),0) FROM media_assets WHERE owner_account_id=NEW.owner_account_id)+length(NEW.payload)>67108864 OR (SELECT COUNT(*) FROM media_assets WHERE (NEW.article_draft_id IS NOT NULL AND article_draft_id=NEW.article_draft_id) OR (NEW.project_draft_id IS NOT NULL AND project_draft_id=NEW.project_draft_id))>=24 THEN RAISE(ABORT,'media unavailable') END;
END;
-- @statement
CREATE TRIGGER article_media_manifest_immutable BEFORE UPDATE OF media_ids_json ON article_publications WHEN NEW.media_ids_json!=OLD.media_ids_json BEGIN SELECT RAISE(ABORT,'immutable media manifest'); END;
-- @statement
CREATE TRIGGER project_media_manifest_immutable BEFORE UPDATE OF media_ids_json ON project_publications WHEN NEW.media_ids_json!=OLD.media_ids_json BEGIN SELECT RAISE(ABORT,'immutable media manifest'); END;
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
-- @statement
CREATE TRIGGER article_revision_initial AFTER INSERT ON content WHEN EXISTS(SELECT 1 FROM article_publications WHERE content_id=NEW.id) BEGIN
 INSERT INTO article_publication_revisions(content_id,revision,source_version,title,body,summary,tags_json,audience,prerequisite,outcome,minutes,media_ids_json,published_at_ms) SELECT NEW.id,1,r.source_version,NEW.title,NEW.body,NEW.summary,NEW.tags_json,NEW.audience,NEW.prerequisite,NEW.outcome,NEW.minutes,r.media_ids_json,r.published_at_ms FROM article_publications r WHERE r.content_id=NEW.id;
END;
-- @statement
CREATE TRIGGER article_revision_immutable_update BEFORE UPDATE ON article_publication_revisions BEGIN SELECT RAISE(ABORT,'immutable article revision'); END;
-- @statement
CREATE TRIGGER article_revision_guard BEFORE INSERT ON article_publication_revisions WHEN NEW.revision>1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM article_publications r JOIN private_article_drafts d ON d.id=r.draft_id JOIN private_accounts a ON a.id=r.owner_account_id AND a.status='active' JOIN account_public_profiles map ON map.owner_account_id=a.id AND map.public_profile_id=r.public_profile_id JOIN public_profiles profile ON profile.id=r.public_profile_id AND profile.is_sample=0 JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id AND c.kind='article' AND c.is_sample=0 AND c.status='published' JOIN article_publication_revisions previous ON previous.content_id=r.content_id AND previous.revision=NEW.revision-1 WHERE length(trim(NEW.title,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND length(trim(NEW.body,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND instr(NEW.title,char(0))=0 AND instr(NEW.body,char(0))=0 AND r.content_id=NEW.content_id AND d.owner_account_id=r.owner_account_id AND d.version=NEW.source_version AND d.title=NEW.title AND d.body=NEW.body AND d.updated_at_ms<=NEW.published_at_ms AND previous.source_version<NEW.source_version AND previous.published_at_ms<=NEW.published_at_ms AND NOT EXISTS(SELECT 1 FROM article_publication_revisions later WHERE later.content_id=r.content_id AND later.revision>=NEW.revision) AND NOT EXISTS(SELECT 1 FROM article_publication_stops WHERE content_id=r.content_id) AND NOT EXISTS(SELECT 1 FROM article_reports report WHERE report.content_id=r.content_id AND report.round=COALESCE((SELECT round FROM article_moderation_state WHERE content_id=r.content_id),1))) THEN RAISE(ABORT,'revision unavailable') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM media_assets m JOIN json_each(NEW.media_ids_json) ref ON ref.value=m.id JOIN article_publications r ON r.content_id=NEW.content_id WHERE ref.type='text' AND m.owner_account_id=r.owner_account_id AND m.article_draft_id=r.draft_id AND m.created_at_ms<=NEW.published_at_ms AND instr(NEW.body,'/api/media/'||m.id)>0)!=json_array_length(NEW.media_ids_json) OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.media_ids_json))!=json_array_length(NEW.media_ids_json) THEN RAISE(ABORT,'media unavailable') END;
END;
