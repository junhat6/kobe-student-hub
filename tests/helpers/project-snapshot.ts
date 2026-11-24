type Db = {
  prepare: (sql: string) => {
    first: <T>() => Promise<T | null>;
    run: () => Promise<unknown>;
  };
};
/**
 * Some fixtures rewrite a published project snapshot directly to stand in for an older or damaged row.
 * Migration 0038 refuses that UPDATE, so the fixture lifts the trigger only around its own write and
 * restores the exact stored definition afterwards (also when the write throws).
 */
export async function withProjectSnapshotUnlocked<T>(db: Db, write: () => Promise<T>): Promise<T> {
  const trigger = await db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='project_publications_snapshot_immutable'",
    )
    .first<{ sql: string }>();
  if (!trigger) throw new Error('project snapshot trigger is missing');
  await db.prepare('DROP TRIGGER project_publications_snapshot_immutable').run();
  try {
    return await write();
  } finally {
    await db.prepare(trigger.sql).run();
  }
}
