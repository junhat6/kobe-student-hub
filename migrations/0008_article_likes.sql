-- Local-only explicit public article likes. No real eligibility/graduation or retention policy.
CREATE TABLE article_likes (
 owner_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
 liked_at_ms INTEGER NOT NULL CHECK(liked_at_ms>=0),
 PRIMARY KEY(owner_account_id,content_id)
);
CREATE INDEX article_likes_owner_recent ON article_likes(owner_account_id,liked_at_ms DESC,content_id ASC);
