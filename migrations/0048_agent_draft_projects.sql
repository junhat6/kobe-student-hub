-- 作品の日誌の下書き（#276）：MCP の create_draft で、本人の公開中の作品を「紐づける作品」として下書きに付ける。expand のみ。
-- 非公開：公開 DTO・公開ページには出ない。下書きの行が本人だけのものなので、この行も本人の下書きに従う。
-- Worker（AgentConnectionStore.createDraft）が接続の有効性・在籍・作品の所有を確かめ、下書きと同じ batch で書く。
-- INSERT の trigger が同じ境界をもう一度確かめる：本人が active で、下書きが本人のもので、まだ公開されておらず、
-- 作品が本人の公開中のスナップショットであること。行は書き換えない（UPDATE は拒否）。
-- 本人がアプリで初めて公開したとき、Worker（ArticlePublicationStore.publish）がこの行を読んで project_journal_links（0046）に
-- 1行足し、この行を消す（1回だけ使う。本人があとで作品の画面から外した紐づけは戻らない）。
-- 下書き・アカウントが消えるとこの行も消える。1つ前の Worker はこの表を知らず、そのまま動く。
-- @statement
CREATE TABLE IF NOT EXISTS agent_draft_projects (
 draft_id TEXT NOT NULL PRIMARY KEY REFERENCES private_article_drafts(id) ON DELETE CASCADE CHECK(length(draft_id)=36),
 project_id TEXT NOT NULL REFERENCES project_publications(id) CHECK(length(project_id)=36),
 owner_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE INDEX IF NOT EXISTS agent_draft_projects_owner ON agent_draft_projects(owner_account_id);
-- @statement
CREATE TRIGGER IF NOT EXISTS agent_draft_projects_valid_insert BEFORE INSERT ON agent_draft_projects BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.owner_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM private_article_drafts d WHERE d.id=NEW.draft_id AND d.owner_account_id=NEW.owner_account_id)
  OR EXISTS(SELECT 1 FROM article_publications r WHERE r.draft_id=NEW.draft_id)
  OR NOT EXISTS(SELECT 1 FROM project_publications r WHERE r.id=NEW.project_id AND r.owner_account_id=NEW.owner_account_id AND r.status='published')
 THEN RAISE(ABORT,'agent draft project unavailable') END;
END;
-- @statement
CREATE TRIGGER IF NOT EXISTS agent_draft_projects_immutable BEFORE UPDATE ON agent_draft_projects BEGIN
 SELECT RAISE(ABORT,'immutable agent draft project');
END;
