-- Owner-chosen article links captured in the immutable project snapshot.
-- The insert trigger is the ownership boundary: every linked article must be a currently published article
-- of the same account and public profile. Readers additionally re-check public status at read time.
-- @statement
ALTER TABLE project_publications ADD COLUMN article_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(article_ids_json) AND json_type(article_ids_json)='array' AND json_array_length(article_ids_json)<=3);
-- @statement
CREATE TRIGGER project_article_links_owned BEFORE INSERT ON project_publications WHEN NEW.article_ids_json!='[]' BEGIN SELECT CASE WHEN NEW.owner_account_id IS NULL OR (SELECT COUNT(DISTINCT j.value) FROM json_each(NEW.article_ids_json) j)!=json_array_length(NEW.article_ids_json) OR EXISTS(SELECT 1 FROM json_each(NEW.article_ids_json) j WHERE j.type!='text' OR length(j.value)!=36 OR NOT EXISTS(SELECT 1 FROM article_publications a JOIN content c ON c.id=a.content_id WHERE a.content_id=j.value AND a.owner_account_id=NEW.owner_account_id AND a.public_profile_id=NEW.public_profile_id AND c.kind='article' AND c.status='published' AND c.is_sample=0 AND c.author_id=a.public_profile_id)) THEN RAISE(ABORT,'article link unavailable') END; END;
-- @statement
CREATE TRIGGER project_article_links_immutable BEFORE UPDATE OF article_ids_json ON project_publications WHEN NEW.article_ids_json!=OLD.article_ids_json BEGIN SELECT RAISE(ABORT,'immutable article links'); END;
-- @statement
CREATE INDEX project_publications_linked ON project_publications(status) WHERE article_ids_json!='[]';
