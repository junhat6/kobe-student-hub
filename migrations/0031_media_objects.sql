-- Private R2 objects for media bytes (#12). Expand only: one nullable column, no change to existing rows.
-- NULL means the bytes are only in D1 payload (rows from the previous Worker or before the bucket
-- existed); the scheduled backfill copies them to R2 and sets the time. The previous Worker ignores
-- the column, so a rollback keeps working. The payload column is contracted in a later migration.
-- @statement
ALTER TABLE media_assets ADD COLUMN object_stored_at_ms INTEGER CHECK(object_stored_at_ms IS NULL OR (typeof(object_stored_at_ms)='integer' AND object_stored_at_ms BETWEEN 0 AND 253402300799999));
-- @statement
CREATE INDEX media_object_pending ON media_assets(created_at_ms,id) WHERE object_stored_at_ms IS NULL;
