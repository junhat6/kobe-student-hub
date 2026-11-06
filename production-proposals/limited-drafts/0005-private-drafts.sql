-- Private preparation only; no public route or publication policy.
CREATE TABLE private_article_drafts (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 owner_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(title)<=200),
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=262144),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1 AND version<=9007199254740991),
 updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=0)
);
CREATE INDEX private_drafts_owner_updated ON private_article_drafts(owner_account_id,updated_at_ms DESC,id ASC);
