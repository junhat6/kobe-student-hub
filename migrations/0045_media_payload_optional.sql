-- 画像の D1 BLOB（payload）を NULL 可にする（#12 の contract の第1段。DECISIONS 2026-11-22 の5）。
-- 0020 の media_assets は payload を NOT NULL と CHECK で固定しており、SQLite は列の条件を ALTER できないので表を作り直す。
-- 列・列の順・外部キー・索引・trigger は 0020／0031／0032／0039 と同じにし、変えるのは次の3つだけ：
--   1. payload を NULL 可にする（入っているときの型と大きさの条件は今までどおり）。
--   2. payload が NULL の行は bytes と object_stored_at_ms が必須（R2 に写したと記録された行だけが D1 の BLOB を持たずにいられる）。
--   3. PNG の大きさの条件と media_assets_bytes_insert を、payload ではなく bytes（無ければ payload の長さ）で見る。
-- payload を書かない Worker と、既存行の payload の消去はこの migration に含めない（別の便）。media_assets_content_immutable は
-- payload の UPDATE を今までどおり拒むので、既存行の payload はこの migration の後も残る。旧版の Worker（payload を必ず書く）は
-- この表にそのまま書け、読みもそのまま動く。
--
-- 作り方：article_publication_media・project_publication_media が media_assets(id) を参照するので、旧表を消して新表を RENAME
-- すると、defer_foreign_keys を付けても commit で外部キー違反になる（DROP の暗黙の DELETE が数えた違反は RENAME では減らない）。
-- そこで行を退避表へ写し、旧表を DROP し、同じ名前で作り直してから写し戻す（親の行を INSERT すると違反の数が戻る）。RENAME を
-- 使わないので、本文で media_assets を読む他の表の trigger（article_media_snapshot・project_media_snapshot・article_revision_guard）
-- は作り直さなくてよい。DROP の暗黙の DELETE は trigger を呼ばない。
-- 通常の D1 migrations と同じく1つの batch（transaction）で当てる。手で当てるときも1回の batch で当てること。
-- @statement
PRAGMA defer_foreign_keys = on;
-- @statement
CREATE TABLE media_assets_hold AS SELECT id,owner_account_id,article_draft_id,project_draft_id,mime,width,height,payload,sha256,created_at_ms,object_stored_at_ms,bytes FROM media_assets;
-- @statement
DROP TABLE media_assets;
-- @statement
CREATE TABLE media_assets (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 owner_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 article_draft_id TEXT REFERENCES private_article_drafts(id) ON DELETE SET NULL,
 project_draft_id TEXT REFERENCES project_drafts(id) ON DELETE SET NULL,
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 width INTEGER NOT NULL CHECK(typeof(width)='integer' AND width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(typeof(height)='integer' AND height BETWEEN 1 AND 1600),
 payload BLOB CHECK(payload IS NULL OR (typeof(payload)='blob' AND length(payload) BETWEEN 1 AND 524288)),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 253402300799999),
 object_stored_at_ms INTEGER CHECK(object_stored_at_ms IS NULL OR (typeof(object_stored_at_ms)='integer' AND object_stored_at_ms BETWEEN 0 AND 253402300799999)),
 bytes INTEGER CHECK(bytes IS NULL OR (typeof(bytes)='integer' AND bytes BETWEEN 1 AND 524288)),
 CHECK(width*height<=CASE mime WHEN 'image/jpeg' THEN 524288 ELSE 1000000 END),
 CHECK(mime!='image/png' OR width*height<=524288 OR COALESCE(bytes,length(payload))<=65536),
 CHECK(article_draft_id IS NULL OR project_draft_id IS NULL),
 CHECK(payload IS NOT NULL OR (bytes IS NOT NULL AND object_stored_at_ms IS NOT NULL))
);
-- @statement
INSERT INTO media_assets(id,owner_account_id,article_draft_id,project_draft_id,mime,width,height,payload,sha256,created_at_ms,object_stored_at_ms,bytes) SELECT id,owner_account_id,article_draft_id,project_draft_id,mime,width,height,payload,sha256,created_at_ms,object_stored_at_ms,bytes FROM media_assets_hold;
-- @statement
DROP TABLE media_assets_hold;
-- @statement
CREATE INDEX media_owner ON media_assets(owner_account_id,created_at_ms,id);
-- @statement
CREATE INDEX media_article_draft ON media_assets(article_draft_id);
-- @statement
CREATE INDEX media_project_draft ON media_assets(project_draft_id);
-- @statement
CREATE INDEX media_object_pending ON media_assets(created_at_ms,id) WHERE object_stored_at_ms IS NULL;
-- @statement
CREATE INDEX media_bytes ON media_assets(owner_account_id,bytes);
-- @statement
CREATE TRIGGER media_assets_content_immutable BEFORE UPDATE OF id,mime,width,height,payload,sha256,created_at_ms ON media_assets BEGIN SELECT RAISE(ABORT,'immutable media'); END;
-- @statement
CREATE TRIGGER media_assets_no_retarget BEFORE UPDATE OF owner_account_id,article_draft_id,project_draft_id ON media_assets WHEN (NEW.owner_account_id IS NOT OLD.owner_account_id AND NEW.owner_account_id IS NOT NULL) OR (NEW.article_draft_id IS NOT OLD.article_draft_id AND NEW.article_draft_id IS NOT NULL) OR (NEW.project_draft_id IS NOT OLD.project_draft_id AND NEW.project_draft_id IS NOT NULL) BEGIN SELECT RAISE(ABORT,'immutable media owner'); END;
-- @statement
CREATE TRIGGER media_assets_bytes_insert BEFORE INSERT ON media_assets WHEN NEW.bytes IS NOT NULL AND NEW.payload IS NOT NULL AND NEW.bytes IS NOT length(NEW.payload) BEGIN SELECT RAISE(ABORT,'media unavailable'); END;
-- @statement
CREATE TRIGGER media_assets_bytes_fill AFTER INSERT ON media_assets WHEN NEW.bytes IS NULL BEGIN UPDATE media_assets SET bytes=length(NEW.payload) WHERE id=NEW.id; END;
-- @statement
CREATE TRIGGER media_assets_bytes_immutable BEFORE UPDATE OF bytes ON media_assets WHEN NEW.bytes IS NOT OLD.bytes AND (OLD.bytes IS NOT NULL OR NEW.bytes IS NOT length(OLD.payload)) BEGIN SELECT RAISE(ABORT,'immutable media'); END;
-- @statement
CREATE TRIGGER media_assets_insert BEFORE INSERT ON media_assets BEGIN
 SELECT CASE WHEN NEW.owner_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active') OR (NEW.article_draft_id IS NULL AND NEW.project_draft_id IS NULL) OR (NEW.article_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private_article_drafts WHERE id=NEW.article_draft_id AND owner_account_id=NEW.owner_account_id)) OR (NEW.project_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_drafts WHERE id=NEW.project_draft_id AND owner_account_id=NEW.owner_account_id)) THEN RAISE(ABORT,'media unavailable') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM media_assets)>=16384 OR (SELECT COALESCE(SUM(bytes),0) FROM media_assets INDEXED BY media_bytes)+COALESCE(NEW.bytes,length(NEW.payload))>2147483648 OR (SELECT COUNT(*) FROM media_assets WHERE owner_account_id=NEW.owner_account_id)>=512 OR (SELECT COALESCE(SUM(bytes),0) FROM media_assets INDEXED BY media_bytes WHERE owner_account_id=NEW.owner_account_id)+COALESCE(NEW.bytes,length(NEW.payload))>67108864 OR (SELECT COUNT(*) FROM media_assets WHERE (NEW.article_draft_id IS NOT NULL AND article_draft_id=NEW.article_draft_id) OR (NEW.project_draft_id IS NOT NULL AND project_draft_id=NEW.project_draft_id))>=24 THEN RAISE(ABORT,'media unavailable') END;
END;
