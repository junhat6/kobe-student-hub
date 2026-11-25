-- 作品の制作日誌（#273 1段目）：公開済みの作品に、本人の公開記事をあとから紐づけ・外せる。expand のみ。
-- 公開時に選ぶ article_ids_json（0024、不変・3件まで）はそのまま残し、あとから足す紐づけはこの表に置く。
-- Worker（ProjectStore.setJournalLink）が live session・作品の所有者を確かめ、INSERT の trigger が同じ境界を
-- もう一度確かめる：本人が active で、作品が本人の公開中のスナップショットで、記事が同じアカウント・同じ公開
-- プロフィールの公開中の記事であること。1作品20件まで（公開ページの応答 64KiB に収める）。行は書き換えず、外すときは DELETE する。
-- 公開ページは読むたびに記事の公開状態を確かめるので、紐づけ後に公開停止された記事は出ない。
-- 記事（content）またはアカウントが消えると紐づけも消える。1つ前の Worker はこの表を知らず、そのまま動く。
-- @statement
CREATE TABLE IF NOT EXISTS project_journal_links (
 project_id TEXT NOT NULL REFERENCES project_publications(id) CHECK(length(project_id)=36),
 article_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE CHECK(length(article_id)=36),
 owner_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 linked_at_ms INTEGER NOT NULL CHECK(typeof(linked_at_ms)='integer' AND linked_at_ms BETWEEN 0 AND 253402300799999),
 PRIMARY KEY(project_id,article_id)
);
-- @statement
CREATE INDEX IF NOT EXISTS project_journal_links_article ON project_journal_links(article_id);
-- @statement
CREATE TRIGGER IF NOT EXISTS project_journal_links_valid_insert BEFORE INSERT ON project_journal_links BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM project_publications r WHERE r.id=NEW.project_id AND r.owner_account_id=NEW.owner_account_id AND r.status='published')
  OR NOT EXISTS(SELECT 1 FROM project_publications r JOIN article_publications a ON a.public_profile_id=r.public_profile_id JOIN content c ON c.id=a.content_id WHERE r.id=NEW.project_id AND a.content_id=NEW.article_id AND a.owner_account_id=NEW.owner_account_id AND c.kind='article' AND c.status='published' AND c.is_sample=0 AND c.author_id=a.public_profile_id)
  OR (SELECT COUNT(*) FROM project_journal_links l WHERE l.project_id=NEW.project_id AND l.article_id!=NEW.article_id)>=20
 THEN RAISE(ABORT,'project journal link unavailable') END;
END;
-- @statement
CREATE TRIGGER IF NOT EXISTS project_journal_links_immutable BEFORE UPDATE ON project_journal_links BEGIN
 SELECT RAISE(ABORT,'immutable project journal link');
END;
