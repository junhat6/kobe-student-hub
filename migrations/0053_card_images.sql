-- 記事・作品のカードに出す画像を、本人が添付済みの自分の画像から選んだ記録（#311、C26 条件5）。expand のみ。
-- 行は下書きに従う（下書き・アカウントが消えると消える）。選ばない＝行が無い＝既定（本文の最初の添付画像）。
-- カードに出るのは、選んだ画像が「いま公開中の版」の添付に入っているときだけ。外れたら既定に戻る（読み取り側で判定）。
-- 公開 DTO には公開メディアのパスだけが出る。この表の行そのもの（下書き id・アカウント）は公開しない。
-- 書き込みは Worker（CardImageStore.choose）が本人のセッション・在籍・下書きの所有を確かめ、同じ文で書く。
-- trigger が同じ境界をもう一度確かめる：本人が active で、下書きが本人のもので、画像が本人のものでその下書きに添付されていること。
-- 1つ前の Worker はこの表を知らず、そのまま動く（カードは既定の画像か自動カード）。
-- @statement
CREATE TABLE IF NOT EXISTS article_card_images (
 draft_id TEXT NOT NULL PRIMARY KEY REFERENCES private_article_drafts(id) ON DELETE CASCADE CHECK(length(draft_id)=36),
 owner_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL CHECK(length(media_id)=36),
 updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE TABLE IF NOT EXISTS project_card_images (
 draft_id TEXT NOT NULL PRIMARY KEY REFERENCES project_drafts(id) ON DELETE CASCADE CHECK(length(draft_id)=36),
 owner_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL CHECK(length(media_id)=36),
 updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE TRIGGER IF NOT EXISTS article_card_images_valid_insert BEFORE INSERT ON article_card_images BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM private_article_drafts d WHERE d.id=NEW.draft_id AND d.owner_account_id=NEW.owner_account_id)
  OR NOT EXISTS(SELECT 1 FROM media_assets m WHERE m.id=NEW.media_id AND m.owner_account_id=NEW.owner_account_id AND m.article_draft_id=NEW.draft_id)
 THEN RAISE(ABORT,'card image unavailable') END;
END;
-- @statement
CREATE TRIGGER IF NOT EXISTS article_card_images_valid_update BEFORE UPDATE ON article_card_images BEGIN
 SELECT CASE WHEN NEW.draft_id IS NOT OLD.draft_id OR NEW.owner_account_id IS NOT OLD.owner_account_id
  OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM media_assets m WHERE m.id=NEW.media_id AND m.owner_account_id=NEW.owner_account_id AND m.article_draft_id=NEW.draft_id)
 THEN RAISE(ABORT,'card image unavailable') END;
END;
-- @statement
CREATE TRIGGER IF NOT EXISTS project_card_images_valid_insert BEFORE INSERT ON project_card_images BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM project_drafts d WHERE d.id=NEW.draft_id AND d.owner_account_id=NEW.owner_account_id)
  OR NOT EXISTS(SELECT 1 FROM media_assets m WHERE m.id=NEW.media_id AND m.owner_account_id=NEW.owner_account_id AND m.project_draft_id=NEW.draft_id)
 THEN RAISE(ABORT,'card image unavailable') END;
END;
-- @statement
CREATE TRIGGER IF NOT EXISTS project_card_images_valid_update BEFORE UPDATE ON project_card_images BEGIN
 SELECT CASE WHEN NEW.draft_id IS NOT OLD.draft_id OR NEW.owner_account_id IS NOT OLD.owner_account_id
  OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM media_assets m WHERE m.id=NEW.media_id AND m.owner_account_id=NEW.owner_account_id AND m.project_draft_id=NEW.draft_id)
 THEN RAISE(ABORT,'card image unavailable') END;
END;
