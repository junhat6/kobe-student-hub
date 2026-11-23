-- 作品の公開スナップショットを DELETE と INSERT OR REPLACE から守る（#177 (a)）。expand のみ。
-- 0020/0024/0025 の不変 trigger は UPDATE だけを止めていた。worker は行を消さず（公開停止・運営の削除は status の UPDATE）、
-- 公開は新しい id の INSERT … ON CONFLICT(draft_id) DO NOTHING なので、どちらの trigger も既存の経路と1つ前の Worker を止めない。
-- D1 は recursive_triggers=0 のため、REPLACE が衝突行を暗黙に消すときは DELETE trigger が発火しない。
-- そこで同じ id の行がある INSERT を先に拒む（REPLACE を含む。普通の INSERT は主キー衝突でもともと失敗する）。
-- @statement
CREATE TRIGGER IF NOT EXISTS project_publications_no_delete BEFORE DELETE ON project_publications BEGIN SELECT RAISE(ABORT,'immutable project snapshot'); END;
-- @statement
CREATE TRIGGER IF NOT EXISTS project_publications_no_replace BEFORE INSERT ON project_publications WHEN EXISTS(SELECT 1 FROM project_publications WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'immutable project snapshot'); END;
