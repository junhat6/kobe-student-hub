import { afterEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { AuthMaintenanceStore, type AuthMaintenancePolicy } from '../worker/auth/maintenance';
import { BrowserSessionCoordinator } from '../worker/auth/browser-session';
import { BrowserOAuthFlow } from '../worker/auth/browser-flow';
import { SessionStore } from '../worker/auth/sessions';
import { applyOrderSchema } from './helpers/order-schema';
const NOW = 1_800_000_000_000,
  O = 'https://maintenance.example.invalid',
  policy: AuthMaintenancePolicy = { expiredGraceMs: 0, minimumIntervalMs: 1000, batchLimit: 100 };
const instances: Miniflare[] = [];
async function database() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("local-only")}}',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  instances.push(mf);
  const db = await mf.getD1Database('DB');
  for (const file of ['0003_oauth_attempts.sql', '0004_private_sessions.sql'])
    for (const sql of readFileSync('migrations/' + file, 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?:\n|$)/)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  await applyOrderSchema(db as unknown as D1Database);
  for (const sql of readFileSync('migrations/0014_auth_maintenance.sql', 'utf8')
    .replace(/^--.*$/gm, '')
    .split(/;\s*(?:\n|$)/)
    .filter((s) => s.trim()))
    await db.prepare(sql).run();
  return db as unknown as D1Database;
}
const count = async (db: D1Database, table: string) =>
  (await db.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())!.n;
async function seed(db: D1Database, n: number) {
  await db
    .prepare(
      "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('a','fictional-subject','fictional@st.kobedenshi.ac.jp','active',?)",
    )
    .bind(NOW - 1000)
    .run();
  // Generate the same n real rows per category inside SQLite. Avoid thousands of
  // client-side prepared statements/serialized RPC payloads during finite-backlog setup.
  const seq =
    'WITH RECURSIVE seq(i) AS(SELECT 0 WHERE ?1>0 UNION ALL SELECT i+1 FROM seq WHERE i+1<?1) ';
  await db.batch([
    db
      .prepare(
        seq +
          "INSERT INTO auth_browser_contexts(context_hash,created_at_ms,expires_at_ms) SELECT printf('%064x',i),?2,?3 FROM seq",
      )
      .bind(n, NOW - 1000, NOW),
    db
      .prepare(
        seq +
          "INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms,context_hash) SELECT printf('%064x',i),printf('%064x',i),?4,?2,?3,printf('%064x',i) FROM seq",
      )
      .bind(n, NOW - 1000, NOW, 'n'.repeat(43)),
    db
      .prepare(
        seq +
          "INSERT INTO auth_browser_commands(command_hash,context_hash,action,expected_generation,revocation_fence,created_at_ms,expires_at_ms) SELECT printf('%064x',i),printf('%064x',i),'login',0,0,?2,?3 FROM seq",
      )
      .bind(n, NOW - 1000, NOW),
    db
      .prepare(
        seq +
          "INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,context_hash,context_generation,attempt_hash) SELECT printf('%064x',i),'a',0,?2,?2,?3,printf('%064x',i),0,printf('%064x',i) FROM seq",
      )
      .bind(n, NOW - 1000, NOW),
  ]);
}
async function claim(db: D1Database, now: number) {
  const coordinator = new BrowserSessionCoordinator(db, O, () => now),
    boot = (await coordinator.bootstrap(
      new Request(O, { method: 'POST', headers: { Origin: O } }),
    ))!;
  const headers = new Headers({ Origin: O, Cookie: boot.setCookie.split(';')[0] });
  const command = (await coordinator.command(
    new Request(O, { method: 'POST', headers }),
    'login',
  ))!;
  headers.set('Authorization', 'Bearer command.' + command.commandToken);
  const flow = new BrowserOAuthFlow(
      db,
      {
        origin: O,
        clientId: 'fixture.apps.googleusercontent.com',
        cookieKey: new Uint8Array(32).fill(9),
      },
      () => now,
    ),
    start = (await flow.start(new Request(O + '/api/auth/start', { method: 'POST', headers })))!;
  const state = new URL(start.location).searchParams.get('state')!,
    callback = new Request(O + '/api/auth/callback?state=' + state + '&code=fictional', {
      headers: { Cookie: boot.setCookie.split(';')[0] + '; ' + start.setCookie.split(';')[0] },
    });
  const result = await flow.claim(callback);
  if (result?.kind !== 'code') throw Error('missing fictional claim');
  return { proof: result.proof, contextCookie: boot.setCookie, flow, callback };
}
afterEach(async () => {
  await Promise.all(instances.splice(0).map((mf) => mf.dispose()));
});
describe('explicit local authentication maintenance', () => {
  it('refuses malformed policy/origin/time and does not invent a retention default', async () => {
    const db = await database();
    await seed(db, 1);
    for (const p of [
      undefined,
      { ...policy, batchLimit: 1000 },
      { ...policy, minimumIntervalMs: 0 },
      { ...policy, expiredGraceMs: -1 },
    ])
      expect(
        await new AuthMaintenanceStore(db, O, p as AuthMaintenancePolicy, () => NOW).run(),
      ).toEqual({ kind: 'unavailable' });
    for (const now of [-1, NaN, 1.5])
      expect(await new AuthMaintenanceStore(db, O, policy, () => now).run()).toEqual({
        kind: 'unavailable',
      });
    expect(
      await new AuthMaintenanceStore(
        db,
        'http://maintenance.example.invalid',
        policy,
        () => NOW,
      ).run(),
    ).toEqual({ kind: 'unavailable' });
    expect(await count(db, 'oauth_attempts')).toBe(1);
  });
  it('bounds each category to100, persists throttling and drains only after explicit later runs', async () => {
    const db = await database();
    await seed(db, 205);
    let now = NOW;
    const run = () => new AuthMaintenanceStore(db, O, policy, () => now).run();
    expect(await run()).toEqual({
      kind: 'completed',
      deleted: { attempts: 100, commands: 100, sessions: 100, contexts: 100, subjectFloors: 0 },
    });
    expect(await run()).toEqual({ kind: 'throttled' });
    expect(await count(db, 'auth_browser_contexts')).toBe(105);
    now++;
    expect(await run()).toEqual({ kind: 'throttled' });
    now = NOW + 1000;
    expect(await run()).toEqual({
      kind: 'completed',
      deleted: { attempts: 100, commands: 100, sessions: 100, contexts: 100, subjectFloors: 0 },
    });
    now += 1000;
    expect(await run()).toEqual({
      kind: 'completed',
      deleted: { attempts: 5, commands: 5, sessions: 5, contexts: 5, subjectFloors: 0 },
    });
    expect(await count(db, 'private_accounts')).toBe(1);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
  it('lets only one equal-time concurrent reservation perform cleanup', async () => {
    const db = await database();
    await seed(db, 5);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => new AuthMaintenanceStore(db, O, policy, () => NOW).run()),
    );
    expect(results.filter((r) => r.kind === 'completed')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'throttled')).toHaveLength(7);
  });
  it('keeps a still-live session when its attempt expires and cannot replay deleted capabilities after rollback', async () => {
    const db = await database();
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('a','fictional-subject','fictional@st.kobedenshi.ac.jp','active',?)",
      )
      .bind(NOW)
      .run();
    const pending = await claim(db, NOW),
      identity = {
        provider: 'google' as const,
        subject: 'fictional-subject',
        email: 'fictional@st.kobedenshi.ac.jp',
      },
      session = (await new SessionStore(db, O, () => NOW).create(identity, pending.proof))!;
    expect(session).not.toBeNull();
    const later = NOW + 600001;
    const result = await new AuthMaintenanceStore(db, O, policy, () => later).run();
    expect(result).toEqual({
      kind: 'completed',
      deleted: { attempts: 1, commands: 1, sessions: 0, contexts: 0, subjectFloors: 0 },
    });
    const req = new Request(O, {
      headers: {
        Cookie: pending.contextCookie.split(';')[0] + '; ' + session.setCookie.split(';')[0],
      },
    });
    expect(await new SessionStore(db, O, () => later).authenticate(req)).not.toBeNull();
    expect(
      (await db.prepare('SELECT attempt_hash FROM auth_sessions').first())?.attempt_hash,
    ).toBeNull();
    expect(await pending.flow.claim(pending.callback)).toBeNull();
    expect(await new SessionStore(db, O, () => NOW).create(identity, pending.proof)).toBeNull();
    expect(await new AuthMaintenanceStore(db, O, policy, () => NOW).run()).toEqual({
      kind: 'throttled',
    });
  });
  it('preserves subject floors until old capabilities expire and retains the permanent watermark after cleanup', async () => {
    const db = await database();
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('a','fictional-subject','fictional@st.kobedenshi.ac.jp','active',?)",
      )
      .bind(NOW)
      .run();
    const old = await claim(db, NOW);
    await db.prepare("DELETE FROM private_accounts WHERE id='a'").run();
    const first = await new AuthMaintenanceStore(db, O, policy, () => NOW).run();
    expect(first.kind === 'completed' && first.deleted.subjectFloors).toBe(0);
    const later = await new AuthMaintenanceStore(db, O, policy, () => NOW + 600001).run();
    expect(later.kind === 'completed' && later.deleted.subjectFloors).toBe(1);
    expect(
      (await db.prepare('SELECT minimum_generation FROM auth_revocation_fence').first())
        ?.minimum_generation,
    ).toBe(1);
    expect(await old.flow.claim(old.callback)).toBeNull();
  });
  it('respects an explicit grace period and keeps contexts referenced by retained children', async () => {
    const db = await database();
    await seed(db, 1);
    const p = { ...policy, expiredGraceMs: 1000 };
    const early = await new AuthMaintenanceStore(db, O, p, () => NOW + 999).run();
    expect(early).toEqual({
      kind: 'completed',
      deleted: { attempts: 0, commands: 0, sessions: 0, contexts: 0, subjectFloors: 0 },
    });
    // Keeping a nonexpired child must pin the parent even when its nominal expiry has passed.
    await db
      .prepare('UPDATE auth_browser_commands SET expires_at_ms=?')
      .bind(NOW + 10000)
      .run();
    const later = await new AuthMaintenanceStore(db, O, p, () => NOW + 1999).run();
    expect(later).toEqual({
      kind: 'completed',
      deleted: { attempts: 1, commands: 0, sessions: 1, contexts: 0, subjectFloors: 0 },
    });
    expect(await count(db, 'auth_browser_contexts')).toBe(1);
  });
  it('reports unavailable after partial failure and keeps the reservation rather than automatically replaying', async () => {
    const db = await database();
    await seed(db, 1);
    await db
      .prepare(
        "CREATE TRIGGER qa_fail_command_cleanup BEFORE DELETE ON auth_browser_commands BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
      )
      .run();
    expect(await new AuthMaintenanceStore(db, O, policy, () => NOW).run()).toEqual({
      kind: 'unavailable',
    });
    expect(await count(db, 'oauth_attempts')).toBe(0);
    expect(await count(db, 'auth_browser_commands')).toBe(1);
    expect(await new AuthMaintenanceStore(db, O, policy, () => NOW).run()).toEqual({
      kind: 'throttled',
    });
  });
  it('aborts remaining work on clock rollback, and fails closed on missing singleton state', async () => {
    const db = await database();
    await seed(db, 1);
    let calls = 0;
    expect(
      await new AuthMaintenanceStore(db, O, policy, () => (++calls === 1 ? NOW : NOW - 1)).run(),
    ).toEqual({ kind: 'unavailable' });
    expect(await count(db, 'oauth_attempts')).toBe(1);
    await db.prepare('DELETE FROM auth_maintenance_state').run();
    expect(await new AuthMaintenanceStore(db, O, policy, () => NOW).run()).toEqual({
      kind: 'unavailable',
    });
  });
  it('uses expiry/context/floor indexes with a larger synthetic backlog and remains batch bounded', async () => {
    const db = await database();
    await seed(db, 1000);
    const explain = async (sql: string) =>
      (
        await db
          .prepare('EXPLAIN QUERY PLAN ' + sql)
          .bind(NOW)
          .all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join('\n');
    expect(
      await explain(
        'SELECT command_hash FROM auth_browser_commands WHERE expires_at_ms<=? ORDER BY expires_at_ms,command_hash LIMIT 100',
      ),
    ).toContain('auth_command_expiry');
    expect(
      await explain(
        'SELECT token_hash FROM auth_sessions WHERE expires_at_ms<=? ORDER BY expires_at_ms,token_hash LIMIT 100',
      ),
    ).toContain('session_expiry');
    expect(
      await explain(
        'SELECT c.context_hash FROM auth_browser_contexts c WHERE c.expires_at_ms<=? AND NOT EXISTS(SELECT 1 FROM oauth_attempts a WHERE a.context_hash=c.context_hash) AND NOT EXISTS(SELECT 1 FROM auth_browser_commands q WHERE q.context_hash=c.context_hash) AND NOT EXISTS(SELECT 1 FROM auth_sessions s WHERE s.context_hash=c.context_hash) ORDER BY c.expires_at_ms,c.context_hash LIMIT 100',
      ),
    ).toMatch(
      /auth_context_expiry[\s\S]*auth_attempt_context[\s\S]*auth_command_context[\s\S]*auth_session_context/,
    );
    const result = await new AuthMaintenanceStore(db, O, policy, () => NOW).run();
    expect(result).toEqual({
      kind: 'completed',
      deleted: { attempts: 100, commands: 100, sessions: 100, contexts: 100, subjectFloors: 0 },
    });
    expect(await count(db, 'auth_sessions')).toBe(900);
  });
  it('indexes subject-floor checks and conservatively retains a larger floor backlog behind a live old attempt', async () => {
    const db = await database();
    await db.prepare('UPDATE auth_revocation_fence SET generation=1000').run();
    // Keep the same 1000 real floor rows without preparing/serializing 1000
    // client-side statements inside this test's unchanged five-second budget.
    await db
      .prepare(
        "WITH RECURSIVE seq(i) AS(SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i<999) INSERT INTO auth_subject_fences(google_subject,generation) SELECT 'fictional-floor-'||i,i+1 FROM seq",
      )
      .run();
    await db
      .prepare(
        'INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms,revocation_fence) VALUES(?,?,?,?,?,0)',
      )
      .bind('f'.repeat(64), 'e'.repeat(64), 'n'.repeat(43), NOW, NOW + 600000)
      .run();
    const plan = (
      await db
        .prepare(
          'EXPLAIN QUERY PLAN SELECT b.generation FROM auth_subject_fences b WHERE NOT EXISTS(SELECT 1 FROM oauth_attempts t WHERE t.revocation_fence<b.generation AND t.expires_at_ms>?) AND NOT EXISTS(SELECT 1 FROM auth_browser_commands q WHERE q.revocation_fence<b.generation AND q.executed_at_ms IS NULL AND q.expires_at_ms>?) ORDER BY b.generation LIMIT 100',
        )
        .bind(NOW, NOW)
        .all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join('\n');
    expect(plan).toContain('auth_subject_floor_generation');
    expect(plan).toContain('auth_attempt_fence_expiry');
    expect(plan).toContain('auth_command_live_fence_expiry');
    const early = await new AuthMaintenanceStore(db, O, policy, () => NOW).run();
    expect(early.kind === 'completed' && early.deleted.subjectFloors).toBe(0);
    expect(await count(db, 'auth_subject_fences')).toBe(1000);
    const expired = await new AuthMaintenanceStore(db, O, policy, () => NOW + 600000).run();
    expect(expired.kind === 'completed' && expired.deleted.subjectFloors).toBe(100);
    expect(await count(db, 'auth_subject_fences')).toBe(900);
    expect(
      (await db.prepare('SELECT minimum_generation FROM auth_revocation_fence').first())
        ?.minimum_generation,
    ).toBe(100);
  });
});
