-- Editorial reviews: an operator (the owner) records how a published article reads, so the owner's
-- taste accumulates and can be distilled into writing guidance. Expand only; append-only history.
-- Private: never part of a public DTO. The reviewer is checked against the operator allowlist and a
-- live session in the Worker; the trigger re-checks that the target is a real published article.
-- @statement
CREATE TABLE editorial_reviews (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 reviewer_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE CHECK(length(content_id)=36),
 revision INTEGER CHECK(revision IS NULL OR revision BETWEEN 1 AND 1000),
 verdict TEXT NOT NULL CHECK(verdict IN ('good','ok','bad')),
 points_json TEXT NOT NULL CHECK(json_valid(points_json) AND json_type(points_json)='array' AND json_array_length(points_json)<=32 AND length(points_json)<=1024),
 note TEXT NOT NULL CHECK(instr(note,char(0))=0 AND length(note)<=500 AND length(CAST(note AS BLOB))<=2000),
 reviewed_at_ms INTEGER NOT NULL CHECK(typeof(reviewed_at_ms)='integer' AND reviewed_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE INDEX editorial_reviews_recent ON editorial_reviews(content_id,reviewer_account_id,reviewed_at_ms DESC);
-- @statement
CREATE INDEX editorial_reviews_time ON editorial_reviews(reviewed_at_ms DESC);
-- @statement
CREATE TRIGGER editorial_reviews_valid_insert BEFORE INSERT ON editorial_reviews BEGIN
 SELECT CASE WHEN NEW.reviewer_account_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.reviewer_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM content c WHERE c.id=NEW.content_id AND c.kind='article' AND c.status='published' AND c.is_sample=0)
 THEN RAISE(ABORT,'editorial review unavailable') END;
END;
