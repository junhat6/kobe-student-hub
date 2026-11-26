-- AI エージェントが MCP で作った作品の下書きの印（#298）。expand のみ。記事の agent_draft_origins（0029）と同じ役目：
-- 本人の作品の下書き一覧に「AIエージェントが作成」と出すことと、1アカウント1日の作成上限を数えること。
-- 非公開：公開 DTO・公開ページには出ない。行は本人の下書きに従い、下書き・アカウントが消えると消える。
-- Worker（AgentConnectionStore.createProjectDraft）が接続の有効性・在籍を確かめ、下書きと同じ batch で書く。
-- INSERT の trigger が同じ境界をもう一度確かめる：本人が active で、下書きが本人のもので、まだ公開されておらず、
-- 同じ下書きの行がまだ無いこと（INSERT OR REPLACE で作成時刻を書き換えて上限を逃れる形も拒む）。行は書き換えない（UPDATE は拒否）。
-- 1つ前の Worker はこの表を知らず、そのまま動く。
-- @statement
CREATE TABLE IF NOT EXISTS agent_project_draft_origins (
 draft_id TEXT NOT NULL PRIMARY KEY REFERENCES project_drafts(id) ON DELETE CASCADE CHECK(length(draft_id)=36),
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 grant_id TEXT NOT NULL CHECK(length(grant_id)=36),
 created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE INDEX IF NOT EXISTS agent_project_draft_origins_account ON agent_project_draft_origins(account_id,created_at_ms);
-- @statement
CREATE TRIGGER IF NOT EXISTS agent_project_draft_origins_valid_insert BEFORE INSERT ON agent_project_draft_origins BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM project_drafts d WHERE d.id=NEW.draft_id AND d.owner_account_id=NEW.account_id)
  OR EXISTS(SELECT 1 FROM project_publications r WHERE r.draft_id=NEW.draft_id)
  OR EXISTS(SELECT 1 FROM agent_project_draft_origins o WHERE o.draft_id=NEW.draft_id OR o.rowid=NEW.rowid)
 THEN RAISE(ABORT,'agent project draft unavailable') END;
END;
-- @statement
CREATE TRIGGER IF NOT EXISTS agent_project_draft_origins_immutable BEFORE UPDATE ON agent_project_draft_origins BEGIN
 SELECT RAISE(ABORT,'immutable agent project draft');
END;
