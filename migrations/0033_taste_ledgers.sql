-- 本人の好みの台帳と、AI エージェントが書いた版（C23、DECISIONS 2026-11-23）。expand のみ。
-- どちらも本人専用の非公開データ。公開 DTO・公開ページ・他の利用者の執筆経路には出さない。
-- 台帳：本人のエージェントが MCP で版の確認つきで丸ごと置き換える。行は Worker が型と上限で検査する。
CREATE TABLE agent_taste_ledgers (
 account_id TEXT NOT NULL PRIMARY KEY REFERENCES private_accounts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1),
 lines_json TEXT NOT NULL CHECK(json_valid(lines_json) AND json_type(lines_json)='array' AND json_array_length(lines_json)<=40 AND length(lines_json)<=40000),
 updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=0)
);
-- AI エージェントが create_draft／update_draft／update_published_article で書いた最新の版（下書きごとに1つ）。
-- 本人が直した行の差を、別の端末・別のエージェントからも読めるようにするための原本。下書きを消すと消える。
CREATE TABLE agent_draft_versions (
 draft_id TEXT NOT NULL PRIMARY KEY REFERENCES private_article_drafts(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(title)<=200),
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=262144),
 draft_version INTEGER NOT NULL CHECK(draft_version>=1),
 recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms>=0)
);
CREATE INDEX agent_draft_versions_account ON agent_draft_versions(account_id,recorded_at_ms DESC);
