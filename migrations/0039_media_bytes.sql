-- Image size as its own column (#260, the expand step before the contract of #12).
--
-- Until now every size was computed from the D1 BLOB (length(payload)): the owner's list, the
-- quotas (Worker check and the media_assets_insert trigger), the D1↔R2 audit and the operator
-- read. The contract of #12 empties payload, which would turn every size into 0 or NULL: the audit
-- would count every row as mismatched and the quotas would stop limiting. This column keeps the size
-- independent of payload.
--
-- Expand only: payload is kept and stays NOT NULL. The column is nullable so the previous Worker,
-- whose INSERT does not name it, still works; media_assets_bytes_fill fills it right after such an
-- insert. A size, once set, never changes (media_assets_bytes_immutable), and a size given on insert
-- must equal the payload length (media_assets_bytes_insert) while payload exists. Apply
-- transactionally, as with the normal D1 migrations command.
-- @statement
ALTER TABLE media_assets ADD COLUMN bytes INTEGER CHECK(bytes IS NULL OR (typeof(bytes)='integer' AND bytes BETWEEN 1 AND 524288));
-- @statement
UPDATE media_assets SET bytes=length(payload) WHERE bytes IS NULL;
-- @statement
CREATE TRIGGER media_assets_bytes_insert BEFORE INSERT ON media_assets WHEN NEW.bytes IS NOT NULL AND NEW.bytes IS NOT length(NEW.payload) BEGIN SELECT RAISE(ABORT,'media unavailable'); END;
-- @statement
CREATE TRIGGER media_assets_bytes_fill AFTER INSERT ON media_assets WHEN NEW.bytes IS NULL BEGIN UPDATE media_assets SET bytes=length(NEW.payload) WHERE id=NEW.id; END;
-- @statement
CREATE TRIGGER media_assets_bytes_immutable BEFORE UPDATE OF bytes ON media_assets WHEN NEW.bytes IS NOT OLD.bytes AND (OLD.bytes IS NOT NULL OR NEW.bytes IS NOT length(OLD.payload)) BEGIN SELECT RAISE(ABORT,'immutable media'); END;
-- @statement
DROP TRIGGER media_assets_insert;
-- @statement
CREATE TRIGGER media_assets_insert BEFORE INSERT ON media_assets BEGIN
 SELECT CASE WHEN NEW.owner_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active') OR (NEW.article_draft_id IS NULL AND NEW.project_draft_id IS NULL) OR (NEW.article_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private_article_drafts WHERE id=NEW.article_draft_id AND owner_account_id=NEW.owner_account_id)) OR (NEW.project_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_drafts WHERE id=NEW.project_draft_id AND owner_account_id=NEW.owner_account_id)) THEN RAISE(ABORT,'media unavailable') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM media_assets)>=16384 OR (SELECT COALESCE(SUM(COALESCE(bytes,length(payload))),0) FROM media_assets)+COALESCE(NEW.bytes,length(NEW.payload))>2147483648 OR (SELECT COUNT(*) FROM media_assets WHERE owner_account_id=NEW.owner_account_id)>=512 OR (SELECT COALESCE(SUM(COALESCE(bytes,length(payload))),0) FROM media_assets WHERE owner_account_id=NEW.owner_account_id)+COALESCE(NEW.bytes,length(NEW.payload))>67108864 OR (SELECT COUNT(*) FROM media_assets WHERE (NEW.article_draft_id IS NOT NULL AND article_draft_id=NEW.article_draft_id) OR (NEW.project_draft_id IS NOT NULL AND project_draft_id=NEW.project_draft_id))>=24 THEN RAISE(ABORT,'media unavailable') END;
END;
