import { readFileSync } from 'node:fs';
const statements = (file: string) =>
  readFileSync('migrations/' + file, 'utf8')
    .split(/^-- @statement\s*$/m)
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
/**
 * 0041 rebuilds auth_sessions with the year-long CHECK and adds the context-extension trigger.
 * Every fixture that assembles 0004 + 0012 by hand needs it, or a session insert fails the 8h CHECK.
 * 0042 then rebuilds the command trigger with the clock-skew tolerance (#277).
 */
/** 0042: the command trigger tolerates the session clock skew on context creation (#277). Idempotent. */
export async function applyCommandContextSkew(db: Pick<D1Database, 'prepare' | 'batch'>) {
  const t = await db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='browser_command_execute'",
    )
    .first<{ sql: string }>();
  if (!t || t.sql.includes('executed_at_ms+5000')) return;
  await db.batch(statements('0042_auth_command_context_skew.sql').map((s) => db.prepare(s)));
}
export async function applySessionLifetimeSchema(db: Pick<D1Database, 'prepare' | 'batch'>) {
  if (
    await db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='session_context_lifetime'",
      )
      .first()
  )
    return applyCommandContextSkew(db);
  // A fixture that has not applied 0014 yet gets that index from 0014 later, not here.
  const has0014 = await db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='auth_session_context'")
    .first();
  await db.batch(
    statements('0041_session_long_lifetime.sql')
      .filter((s) => has0014 || !s.includes('auth_session_context'))
      .map((s) => db.prepare(s)),
  );
  await applyCommandContextSkew(db);
}
export async function applyOrderSchema(db: Pick<D1Database, 'prepare' | 'batch'>) {
  if (
    !(await db.prepare('PRAGMA table_info(auth_sessions)').all<{ name: string }>()).results.some(
      (c) => c.name === 'context_hash',
    )
  )
    await db.batch(statements('0012_browser_session_order.sql').map((s) => db.prepare(s)));
  await applySessionLifetimeSchema(db);
}

export async function applySelfRegistrationSchema(db: Pick<D1Database, 'prepare' | 'batch'>) {
  await applyOrderSchema(db);
  for (const [name, table] of [
    ['0016_self_declared_enrollment.sql', 'private_enrollment_periods'],
    ['0017_self_registration.sql', 'auth_self_registration_attempts'],
  ]) {
    if (
      await db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .bind(table)
        .first()
    )
      continue;
    const raw = readFileSync('migrations/' + name, 'utf8'),
      statements = (
        raw.includes('-- @statement') ? raw.split(/^-- @statement\s*$/m) : raw.split(/;\s*(?:\n|$)/)
      )
        .map((s) => s.replace(/^--.*$/gm, '').trim())
        .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
}
