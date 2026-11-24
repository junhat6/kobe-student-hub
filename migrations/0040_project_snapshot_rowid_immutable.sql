-- 作品の公開行の rowid を UPDATE から守る（#261 A、#257 の独立検証の P2）。expand のみ。
-- rowid（oid・_rowid_ も同じ）は列ではないので、0038 の BEFORE UPDATE OF … の列一覧に書けず、
-- `UPDATE OR REPLACE project_publications SET rowid=<他の行の rowid>` が 0038 を通らずに走り、衝突した他の公開行が
-- DELETE trigger（0036）を通らずに消えていた（D1 は recursive_triggers=0 で、REPLACE の暗黙削除に DELETE trigger が効かない）。
-- 列を指定しない BEFORE UPDATE は rowid だけの UPDATE でも発火し、衝突行の削除より前に止まる。
-- worker（今と1つ前）がこの表に行う UPDATE は status だけで rowid は変えない。ON DELETE SET NULL も rowid を変えないので両立する。
-- 他の保護された表（article_publication_revisions・article_report_revisions・*_publication_media）は
-- 列を指定しない無条件の BEFORE UPDATE で止めているので、rowid の書き換えも既に止まる。
-- @statement
CREATE TRIGGER IF NOT EXISTS project_publications_rowid_immutable BEFORE UPDATE ON project_publications
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN SELECT RAISE(ABORT,'immutable project snapshot'); END;
