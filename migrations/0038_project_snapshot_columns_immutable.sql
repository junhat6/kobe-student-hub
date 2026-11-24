-- 作品の公開スナップショットの列を UPDATE から守る（#257 (1)、#255 の独立検証の P2）。expand のみ。
-- 0024/0025/0020(0032) は article_ids_json・technologies・media_ids_json だけを止めていた。残りの列を UPDATE で書き換えると、
-- 本文の差し替えや、UPDATE OR REPLACE で id・draft_id を他の行と衝突させて DELETE trigger（0036）を通らずに行を消すことができた。
-- worker（今と1つ前）がこの表に行う UPDATE は status だけ（公開停止 0011・運営 0021・通報しきい値 0026 の trigger）なので両立する。
-- 例外は ON DELETE SET NULL：下書き・アカウントの行が消えたときに draft_id・owner_account_id が NULL になる変化だけを、
-- 親の行がもう無いときに限って通す（D1 は外部キーの動作をこの trigger の前に親を消してから行う）。
-- BEFORE trigger は UPDATE OR REPLACE の衝突行の削除より前に発火するので、衝突による暗黙の削除も起きない。
-- @statement
CREATE TRIGGER IF NOT EXISTS project_publications_snapshot_immutable BEFORE UPDATE OF id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,published_at_ms ON project_publications
WHEN NEW.id IS NOT OLD.id
  OR NEW.public_profile_id IS NOT OLD.public_profile_id
  OR NEW.source_version IS NOT OLD.source_version
  OR NEW.title IS NOT OLD.title
  OR NEW.description IS NOT OLD.description
  OR NEW.github_url IS NOT OLD.github_url
  OR NEW.demo_url IS NOT OLD.demo_url
  OR NEW.published_at_ms IS NOT OLD.published_at_ms
  OR (NEW.draft_id IS NOT OLD.draft_id AND (NEW.draft_id IS NOT NULL OR EXISTS(SELECT 1 FROM project_drafts WHERE id=OLD.draft_id)))
  OR (NEW.owner_account_id IS NOT OLD.owner_account_id AND (NEW.owner_account_id IS NOT NULL OR EXISTS(SELECT 1 FROM private_accounts WHERE id=OLD.owner_account_id)))
BEGIN SELECT RAISE(ABORT,'immutable project snapshot'); END;
