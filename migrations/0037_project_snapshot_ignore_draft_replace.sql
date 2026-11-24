-- 作品の公開スナップショットを、同じ draft_id・別 id の INSERT OR REPLACE から守る（#255 (1)、#177 の独立検証の P2）。expand のみ。
-- 0036 は同じ id の INSERT を ABORT にしたが、別 id で同じ draft_id の REPLACE は UNIQUE(draft_id) の衝突行を暗黙に消し、
-- recursive_triggers=0 の D1 では DELETE trigger が発火しないので、スナップショットが丸ごと差し替わる。
-- ABORT にすると worker の公開（ON CONFLICT(draft_id) DO NOTHING）の再公開まで失敗するため、RAISE(IGNORE) でその行だけを捨てる。
-- worker（今と1つ前）は DO NOTHING で同じ結果（行を返さず receipt 経路で答える）になるので両立する。
-- 同じ id の行があるときは 0036 の ABORT に任せる（NOT EXISTS で重ならないようにし、trigger の発火順に頼らない）。
-- @statement
CREATE TRIGGER IF NOT EXISTS project_publications_keep_draft_snapshot BEFORE INSERT ON project_publications WHEN NEW.draft_id IS NOT NULL AND EXISTS(SELECT 1 FROM project_publications WHERE draft_id=NEW.draft_id) AND NOT EXISTS(SELECT 1 FROM project_publications WHERE id=NEW.id) BEGIN SELECT RAISE(IGNORE); END;
