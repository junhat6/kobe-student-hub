import { readFileSync, readdirSync } from 'node:fs';
/** Current repository schema for behavior fixtures; migration-specific tests keep their own versions. */
export async function applyFixtureMigrations(db: {
  prepare: (sql: string) => { run: () => Promise<unknown> };
}) {
  for (const name of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + name, 'utf8');
    for (const sql of (raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/)
    )
      .map((sql) => sql.replace(/^--.*$/gm, '').trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  }
}
