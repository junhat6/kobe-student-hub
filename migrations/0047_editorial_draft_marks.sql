-- Editorial draft marks (#274, second stage of #271): the operator comments on a selected passage
-- of one of their own drafts in its preview (赤ペン). The passage is anchored by its text plus up to
-- 32 characters before and after, and the draft version it was made on. Expand only.
-- Private: never part of a public DTO, a public page or MCP. The Worker checks the operator
-- allowlist, a live session and draft ownership; the trigger re-checks that the reviewer is active,
-- owns the draft and has fewer than 100 marks on it. Marks are never edited (UPDATE is refused);
-- the operator may delete one, and deleting the draft or the account deletes its marks.
-- @statement
CREATE TABLE editorial_draft_marks (
 id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
 reviewer_account_id TEXT NOT NULL REFERENCES private_accounts(id) ON DELETE CASCADE,
 draft_id TEXT NOT NULL REFERENCES private_article_drafts(id) ON DELETE CASCADE CHECK(length(draft_id)=36),
 draft_version INTEGER NOT NULL CHECK(typeof(draft_version)='integer' AND draft_version BETWEEN 1 AND 9007199254740991),
 quote TEXT NOT NULL CHECK(typeof(quote)='text' AND length(quote) BETWEEN 1 AND 200 AND instr(quote,char(0))=0 AND length(CAST(quote AS BLOB))<=800),
 prefix TEXT NOT NULL CHECK(typeof(prefix)='text' AND length(prefix)<=32 AND instr(prefix,char(0))=0 AND length(CAST(prefix AS BLOB))<=128),
 suffix TEXT NOT NULL CHECK(typeof(suffix)='text' AND length(suffix)<=32 AND instr(suffix,char(0))=0 AND length(CAST(suffix AS BLOB))<=128),
 note TEXT NOT NULL CHECK(typeof(note)='text' AND length(note) BETWEEN 1 AND 500 AND instr(note,char(0))=0 AND length(CAST(note AS BLOB))<=2000),
 created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 253402300799999)
);
-- @statement
CREATE INDEX editorial_draft_marks_draft ON editorial_draft_marks(draft_id,reviewer_account_id,created_at_ms);
-- @statement
CREATE INDEX editorial_draft_marks_reviewer_time ON editorial_draft_marks(reviewer_account_id,created_at_ms DESC);
-- @statement
CREATE TRIGGER editorial_draft_marks_valid_insert BEFORE INSERT ON editorial_draft_marks BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_accounts WHERE id=NEW.reviewer_account_id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM private_article_drafts d WHERE d.id=NEW.draft_id AND d.owner_account_id=NEW.reviewer_account_id)
  OR (SELECT count(*) FROM editorial_draft_marks m WHERE m.draft_id=NEW.draft_id)>=100
  OR EXISTS(SELECT 1 FROM editorial_draft_marks m WHERE m.id=NEW.id)
 THEN RAISE(ABORT,'editorial draft mark unavailable') END;
END;
-- @statement
CREATE TRIGGER editorial_draft_marks_no_update BEFORE UPDATE ON editorial_draft_marks BEGIN
 SELECT RAISE(ABORT,'editorial draft marks are not edited');
END;
