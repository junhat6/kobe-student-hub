-- AI エージェント接続（MCP / OAuth 2.1）。expand のみ。トークン・コード・依頼 ID はハッシュだけを置く。
-- 動的クライアント登録で作られる公開クライアント（秘密を持たない）。
CREATE TABLE agent_oauth_clients (
 client_id TEXT NOT NULL PRIMARY KEY CHECK(length(client_id)=43),
 client_name TEXT NOT NULL CHECK(length(client_name) BETWEEN 1 AND 100),
 redirect_uris_json TEXT NOT NULL CHECK(length(redirect_uris_json)<=4096),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0)
);
CREATE INDEX agent_oauth_clients_created ON agent_oauth_clients(created_at_ms);
-- 本人の「接続を許可」を待つ認可依頼（10分）。
CREATE TABLE agent_oauth_requests (
 request_hash TEXT NOT NULL PRIMARY KEY CHECK(length(request_hash)=64),
 client_id TEXT NOT NULL REFERENCES agent_oauth_clients(client_id) ON DELETE CASCADE,
 redirect_uri TEXT NOT NULL CHECK(length(redirect_uri)<=2048),
 state TEXT CHECK(state IS NULL OR length(state)<=512),
 code_challenge TEXT NOT NULL CHECK(length(code_challenge)=43),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms),
 used_at_ms INTEGER
);
CREATE INDEX agent_oauth_requests_expiry ON agent_oauth_requests(expires_at_ms);
-- 本人が許可した接続。アカウントの状態変更（session_epoch）で自動的に無効になる。
CREATE TABLE agent_grants (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 account_epoch INTEGER NOT NULL,
 client_id TEXT NOT NULL CHECK(length(client_id)=43),
 client_name TEXT NOT NULL CHECK(length(client_name) BETWEEN 1 AND 100),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
 last_used_at_ms INTEGER NOT NULL CHECK(last_used_at_ms>=0),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms),
 revoked_at_ms INTEGER
);
CREATE INDEX agent_grants_account ON agent_grants(account_id,created_at_ms DESC);
-- 認可コード（5分・1回）、アクセス（1時間）、更新（30日・1回で入れ替え）。
CREATE TABLE agent_tokens (
 token_hash TEXT NOT NULL PRIMARY KEY CHECK(length(token_hash)=64),
 grant_id TEXT NOT NULL REFERENCES agent_grants(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('code','access','refresh')),
 redirect_uri TEXT CHECK(redirect_uri IS NULL OR length(redirect_uri)<=2048),
 code_challenge TEXT CHECK(code_challenge IS NULL OR length(code_challenge)=43),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms),
 used_at_ms INTEGER
);
CREATE INDEX agent_tokens_grant ON agent_tokens(grant_id);
CREATE INDEX agent_tokens_expiry ON agent_tokens(expires_at_ms);
-- AI エージェントが作った下書きの印（下書き一覧の表示と1日の作成上限に使う）。
CREATE TABLE agent_draft_origins (
 draft_id TEXT NOT NULL PRIMARY KEY REFERENCES private_article_drafts(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 grant_id TEXT NOT NULL CHECK(length(grant_id)=36),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0)
);
CREATE INDEX agent_draft_origins_account ON agent_draft_origins(account_id,created_at_ms);
-- AI エージェントが出した公開情報の案（概要・タグ）。公開の準備で本人が押したときだけ使う。
CREATE TABLE agent_draft_hints (
 draft_id TEXT NOT NULL PRIMARY KEY REFERENCES private_article_drafts(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 summary TEXT NOT NULL CHECK(length(summary)<=300),
 tags_json TEXT NOT NULL CHECK(length(tags_json)<=400),
 updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=0)
);
