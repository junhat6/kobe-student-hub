-- Editorial draft reviews (#271, first stage): an operator (the owner) records how one of their own
-- unpublished drafts reads in its preview, the same verdict/points/note as editorial_reviews (0030).
-- Expand only; append-only history. Private: never part of a public DTO, a public page or MCP.
-- The Worker checks the operator allowlist, a live session and draft ownership; the trigger re-checks
-- that the reviewer is active and owns the draft. Deleting the draft or the account deletes its reviews.
-- @statement
CREATE TABLE editorial_draft_reviews (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 reviewer_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 draft_id TEXT NOT NULL REFERENCES private_article_drafts(id) ON DELETE CASCADE CHECK(length(draft_id)=36),
 draft_version INTEGER NOT NULL CHECK(typeof(draft_version)='integer' AND draft_version BETWEEN 1 AND 9007199254740991),
 verdict TEXT NOT NULL CHECK(verdict IN ('good','ok','bad')),
 points_json TEXT NOT NULL CHECK(json_valid(points_json) AND json_type(points_json)='array' AND json_array_length(points_json)<=32 AND length(points_json)<=1024),
 note TEXT NOT NULL CHECK(instr(note,char(0))=0 AND length(note)<=500 AND length(CAST(note AS BLOB))<=2000),
 reviewed_at_ms INTEGER NOT NULL CHECK(typeof(reviewed_at_ms)='integer' AND reviewed_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE INDEX editorial_draft_reviews_recent ON editorial_draft_reviews(draft_id,reviewer_account_id,reviewed_at_ms DESC);
-- @statement
CREATE INDEX editorial_draft_reviews_reviewer_time ON editorial_draft_reviews(reviewer_account_id,reviewed_at_ms DESC);
-- @statement
CREATE TRIGGER editorial_draft_reviews_valid_insert BEFORE INSERT ON editorial_draft_reviews BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.reviewer_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM private_article_drafts d WHERE d.id=NEW.draft_id AND d.owner_account_id=NEW.reviewer_account_id)
 THEN RAISE(ABORT,'editorial draft review unavailable') END;
END;
-- @statement
CREATE TRIGGER editorial_draft_reviews_append_only BEFORE UPDATE ON editorial_draft_reviews BEGIN
 SELECT RAISE(ABORT,'editorial draft reviews are append-only');
END;
