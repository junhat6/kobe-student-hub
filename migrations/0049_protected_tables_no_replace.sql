-- 保護された公開表を、同じ主キー・UNIQUE・rowid の INSERT OR REPLACE から守る（#265、#261 の独立検証の P2-1・P2-2）。expand のみ。
-- 保護された表＝無条件の BEFORE DELETE で ABORT する表（project_publications・article_publication_revisions・
-- article_report_revisions・article_publication_media・project_publication_media）。
-- D1 は recursive_triggers=0 のため、REPLACE が衝突行を暗黙に消すときは DELETE trigger が発火しない。
-- そこで衝突する行が既にある INSERT を、行の削除より前に BEFORE INSERT で拒む（REPLACE・INSERT OR REPLACE を含む）。
-- rowid を書かない INSERT では BEFORE INSERT の NEW.rowid は -1 になる。どの表も rowid は自動採番（1 以上）なので、
-- 普通の INSERT は rowid の条件に当たらない（-1 の行を D1 に直接書いた場合だけ、以後の INSERT が止まる。消せない表なのでそれも拒む側に倒す）。
-- worker（今と1つ前）がこれらの表に行う INSERT は、新しい id・次の revision・新しい report id・json_each の重複なしの media だけで、
-- 衝突する INSERT はもともと UNIQUE 違反で失敗していた。OR IGNORE・ON CONFLICT DO NOTHING でこれらの表へ書く経路は無いので、
-- ABORT にしても既存の経路と1つ前の Worker は変わらない（project_publications の draft_id の衝突は 0037 が RAISE(IGNORE) で扱う）。
-- @statement
CREATE TRIGGER IF NOT EXISTS project_publications_rowid_no_replace BEFORE INSERT ON project_publications
WHEN EXISTS(SELECT 1 FROM project_publications WHERE rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'immutable project snapshot'); END;
-- @statement
CREATE TRIGGER IF NOT EXISTS article_revision_no_replace BEFORE INSERT ON article_publication_revisions
WHEN EXISTS(SELECT 1 FROM article_publication_revisions WHERE rowid=NEW.rowid OR (content_id=NEW.content_id AND (revision=NEW.revision OR source_version=NEW.source_version)))
BEGIN SELECT RAISE(ABORT,'immutable article revision'); END;
-- @statement
CREATE TRIGGER IF NOT EXISTS article_report_revision_no_replace BEFORE INSERT ON article_report_revisions
WHEN EXISTS(SELECT 1 FROM article_report_revisions WHERE rowid=NEW.rowid OR report_id=NEW.report_id)
BEGIN SELECT RAISE(ABORT,'immutable article revision'); END;
-- @statement
CREATE TRIGGER IF NOT EXISTS article_media_map_no_replace BEFORE INSERT ON article_publication_media
WHEN EXISTS(SELECT 1 FROM article_publication_media WHERE rowid=NEW.rowid OR (content_id=NEW.content_id AND media_id=NEW.media_id))
BEGIN SELECT RAISE(ABORT,'immutable media grant'); END;
-- @statement
CREATE TRIGGER IF NOT EXISTS project_media_map_no_replace BEFORE INSERT ON project_publication_media
WHEN EXISTS(SELECT 1 FROM project_publication_media WHERE rowid=NEW.rowid OR (project_id=NEW.project_id AND media_id=NEW.media_id))
BEGIN SELECT RAISE(ABORT,'immutable media grant'); END;
