import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { AuthMaintenanceStore } from '../worker/auth/maintenance';
const T = 1800000000000,
  O = 'https://independent-maintenance.example.invalid';
const policy = { expiredGraceMs: 0, minimumIntervalMs: 1000, batchLimit: 100 as const };
const instances: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((m) => m.dispose()));
});
async function db() {
  const m = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("synthetic-only")}}',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  instances.push(m);
  const d = (await m.getD1Database('DB')) as unknown as D1Database;
  for (const f of [
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0012_browser_session_order.sql',
    '0014_auth_maintenance.sql',
  ]) {
    const text = readFileSync('migrations/' + f, 'utf8');
    await d.batch(
      text
        .split(text.includes('-- @statement') ? /^-- @statement\s*$/m : /;\s*(?:\n|$)/)
        .map((s) => s.replace(/^--.*$/gm, '').trim())
        .filter(Boolean)
        .map((s) => d.prepare(s)),
    );
  }
  return d;
}
const n = async (d: D1Database, table: string) =>
  (await d.prepare('SELECT count(*) n FROM ' + table).first<{ n: number }>())!.n;
it('keeps revoked/idle-expired sessions until their absolute retention cutoff, while removing absolutely expired rows', async () => {
  const d = await db();
  await d
    .prepare(
      "INSERT INTO private_accounts VALUES('account','fictional','fictional@st.kobedenshi.ac.jp','active',0,?)",
    )
    .bind(T - 2000000)
    .run();
  for (const [i, expires, revoked] of [
    [1, T + 10000, T - 1000],
    [2, T + 10000, null],
    [3, T, null],
  ] as const)
    await d
      .prepare(
        "INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,revoked_at_ms) VALUES(?,'account',0,?,?,?,?)",
      )
      .bind(String(i).repeat(64), T - 2000000, T - 2000000, expires, revoked)
      .run();
  const r = await new AuthMaintenanceStore(d, O, policy, () => T).run();
  expect(r.kind === 'completed' && r.deleted.sessions).toBe(1);
  expect(
    (await d.prepare('SELECT token_hash FROM auth_sessions ORDER BY token_hash').all()).results,
  ).toEqual([{ token_hash: '1'.repeat(64) }, { token_hash: '2'.repeat(64) }]);
  expect(await n(d, 'private_accounts')).toBe(1);
});
it('retains subject floor behind an old live command even without any attempts; expiry advances watermark without reviving command', async () => {
  const d = await db();
  const hash = 'a'.repeat(64);
  await d
    .prepare(
      'INSERT INTO auth_browser_contexts(context_hash,created_at_ms,expires_at_ms) VALUES(?,?,?)',
    )
    .bind(hash, T, T + 28800000)
    .run();
  await d
    .prepare(
      "INSERT INTO auth_browser_commands(command_hash,context_hash,action,expected_generation,revocation_fence,created_at_ms,expires_at_ms) VALUES(?,?,'login',0,0,?,?)",
    )
    .bind(hash, hash, T, T + 60000)
    .run();
  await d.prepare('UPDATE auth_revocation_fence SET generation=1').run();
  await d.prepare("INSERT INTO auth_subject_fences VALUES('fictional-deleted-subject',1)").run();
  const early = await new AuthMaintenanceStore(d, O, policy, () => T).run();
  expect(early.kind === 'completed' && early.deleted.subjectFloors).toBe(0);
  expect(
    (await d.prepare('SELECT minimum_generation n FROM auth_revocation_fence').first())?.n,
  ).toBe(0);
  const later = await new AuthMaintenanceStore(d, O, policy, () => T + 60000).run();
  expect(later.kind === 'completed' && later.deleted).toEqual({
    attempts: 0,
    commands: 1,
    sessions: 0,
    contexts: 0,
    subjectFloors: 1,
  });
  expect(
    (await d.prepare('SELECT minimum_generation n FROM auth_revocation_fence').first())?.n,
  ).toBe(1);
  expect(await n(d, 'auth_browser_commands')).toBe(0);
  expect((await d.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
it('clock rollback after committed attempt deletion aborts remaining categories and keeps the persisted throttle', async () => {
  const d = await db(),
    hash = 'b'.repeat(64);
  await d
    .prepare(
      'INSERT INTO auth_browser_contexts(context_hash,created_at_ms,expires_at_ms) VALUES(?,?,?)',
    )
    .bind(hash, T - 1000, T)
    .run();
  await d
    .prepare(
      'INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms,context_hash) VALUES(?,?,?,?,?,?)',
    )
    .bind(hash, hash, 'n'.repeat(43), T - 1000, T, hash)
    .run();
  await d
    .prepare(
      "INSERT INTO auth_browser_commands(command_hash,context_hash,action,expected_generation,revocation_fence,created_at_ms,expires_at_ms) VALUES(?,?,'login',0,0,?,?)",
    )
    .bind(hash, hash, T - 1000, T)
    .run();
  let calls = 0;
  const r = await new AuthMaintenanceStore(d, O, policy, () => (++calls <= 2 ? T : T - 1)).run();
  expect(r).toEqual({ kind: 'unavailable' });
  expect(await n(d, 'oauth_attempts')).toBe(0);
  expect(await n(d, 'auth_browser_commands')).toBe(1);
  expect(await n(d, 'auth_browser_contexts')).toBe(1);
  expect(await new AuthMaintenanceStore(d, O, policy, () => T).run()).toEqual({
    kind: 'throttled',
  });
  const next = await new AuthMaintenanceStore(d, O, policy, () => T + 1000).run();
  expect(next.kind === 'completed' && next.deleted).toEqual({
    attempts: 0,
    commands: 1,
    sessions: 0,
    contexts: 1,
    subjectFloors: 0,
  });
});
