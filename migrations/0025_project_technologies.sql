-- Optional one-line "technologies used" text on project drafts and immutable project snapshots.
-- Existing rows default to '' (no technologies stated). Length is bounded again at read time.
-- @statement
ALTER TABLE project_drafts ADD COLUMN technologies TEXT NOT NULL DEFAULT '';
-- @statement
ALTER TABLE project_publications ADD COLUMN technologies TEXT NOT NULL DEFAULT '';
-- @statement
CREATE TRIGGER project_technologies_immutable BEFORE UPDATE OF technologies ON project_publications WHEN NEW.technologies!=OLD.technologies BEGIN SELECT RAISE(ABORT,'immutable project snapshot'); END;
