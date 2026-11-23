-- 本人の台帳の行のうち、本人が「運営に見せる」を押した行（C23 条件4、#243）。expand のみ。
-- 行は 種類＋本文 で指す。エージェントが台帳を置き換えても同じ本文の行だけが見せたまま残り、
-- 本文が変わった行・消えた行の記録は置き換えと同じ batch で消す。アカウントを消すと消える。
CREATE TABLE agent_taste_shares (
 account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('writing','app')),
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 200),
 shared_at_ms INTEGER NOT NULL CHECK(shared_at_ms>=0),
 PRIMARY KEY(account_id,kind,text)
);
CREATE INDEX agent_taste_shares_recent ON agent_taste_shares(shared_at_ms DESC);
