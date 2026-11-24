import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { BrowserSessionCoordinator } from '../worker/auth/browser-session';
const O = 'https://limits.example.invalid',
  NOW = 1800000000000;
const ms: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(ms.splice(0).map((m) => m.dispose()));
});
async function setup(
  files = [
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0012_browser_session_order.sql',
    '0041_session_long_lifetime.sql',
  ],
) {
  const m = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("local only")}}',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  ms.push(m);
  const db = (await m.getD1Database('DB')) as unknown as D1Database;
  for (const f of files) {
    const text = readFileSync('migrations/' + f, 'utf8');
    await db.batch(
      text
        .split(text.includes('-- @statement') ? /^-- @statement\s*$/m : /;\s*(?:\n|$)/)
        .map((s) => s.replace(/^--.*$/gm, '').trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  }
  return db;
}
function apply(db: D1Database, f: string) {
  const text = readFileSync('migrations/' + f, 'utf8');
  return db.batch(
    text
      .split(/^-- @statement\s*$/m)
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
}
it('0041 copies existing sessions unchanged and keeps the logout trigger byte-identical (#269)', async () => {
  const db = await setup([
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0012_browser_session_order.sql',
    '0014_auth_maintenance.sql',
  ]);
  const schema = () =>
    db
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE name<>'auth_sessions' AND (tbl_name='auth_sessions' OR sql LIKE '%auth_sessions%') ORDER BY name",
      )
      .all();
  const before = (await schema()).results;
  await db
    .prepare(
      "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('a','s','a@st.kobedenshi.ac.jp','active',?)",
    )
    .bind(NOW)
    .run();
  await db
    .prepare(
      'INSERT INTO auth_browser_contexts(context_hash,created_at_ms,expires_at_ms) VALUES(?,?,?)',
    )
    .bind('c'.repeat(64), NOW, NOW + 28800000)
    .run();
  await db.batch(
    [
      ['1', NOW + 28800000, null],
      ['2', NOW + 3600000, NOW + 60000],
    ].map(([t, e, r]) =>
      db
        .prepare(
          'INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,revoked_at_ms,context_hash,context_generation) VALUES(?,?,0,?,?,?,?,?,0)',
        )
        .bind(String(t).repeat(64), 'a', NOW, NOW + 1000, e, r, 'c'.repeat(64)),
    ),
  );
  const rows = () => db.prepare('SELECT * FROM auth_sessions ORDER BY token_hash').all();
  const old = (await rows()).results;
  await expect(
    db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms) VALUES(?,?,0,?,?,?)',
      )
      .bind('3'.repeat(64), 'a', NOW, NOW, NOW + 28800001)
      .run(),
  ).rejects.toThrow();
  await apply(db, '0041_session_long_lifetime.sql');
  expect((await rows()).results).toEqual(old);
  const after = (await schema()).results;
  // Same indexes and triggers (browser_command_execute unchanged), plus the new extension trigger.
  expect(after.filter((x: any) => x.name !== 'session_context_lifetime')).toEqual(before);
  expect(after.map((x: any) => x.name)).toContain('session_context_lifetime');
});
const req = (cookie?: string) =>
  new Request(O, {
    method: 'POST',
    headers: { Origin: O, ...(cookie ? { Cookie: cookie.split(';')[0] } : {}) },
  });
it('bounds concurrent anonymous contexts atomically and recovers when their fixed lifetime ends', async () => {
  const db = await setup();
  let now = NOW;
  const c = new BrowserSessionCoordinator(db, O, () => now, {
    maxLiveContexts: 3,
    maxCommandsPerMinute: 2,
  });
  const results = await Promise.all(Array.from({ length: 12 }, () => c.bootstrap(req())));
  expect(results.filter(Boolean)).toHaveLength(3);
  expect((await db.prepare('SELECT count(*) n FROM auth_browser_contexts').first())?.n).toBe(3);
  expect(await c.bootstrap(req())).toBeNull();
  now += 28800000;
  expect(await c.bootstrap(req())).toBeTruthy();
});
it('keeps anonymous context rows at 8 hours; only a session insert extends its own context (#269)', async () => {
  const db = await setup();
  const c = new BrowserSessionCoordinator(db, O, () => NOW);
  const boot = (await c.bootstrap(req()))!;
  // The cookie carries the session length, so it is still sent once a login has extended the row.
  expect(boot.setCookie).toMatch(
    /^__Host-kobe-browser=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000$/,
  );
  const ctx = (await db
    .prepare(
      'SELECT context_hash h,generation g,created_at_ms c,expires_at_ms e FROM auth_browser_contexts',
    )
    .first<{ h: string; g: number; c: number; e: number }>())!;
  expect(ctx.e - ctx.c).toBe(28800000);
  await db
    .prepare(
      "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('a','s','a@st.kobedenshi.ac.jp','active',?)",
    )
    .bind(NOW)
    .run();
  const YEAR = 365 * 86400000;
  const insert = (token: string, generation: number, expires: number) =>
    db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,context_hash,context_generation) VALUES(?,?,0,?,?,?,?,?)',
      )
      .bind(token.repeat(64), 'a', NOW, NOW, expires, ctx.h, generation)
      .run();
  const expiry = async () =>
    (await db.prepare('SELECT expires_at_ms e FROM auth_browser_contexts').first<{ e: number }>())!
      .e;
  // A session bound to another generation of the context does not extend it.
  await insert('1', ctx.g + 1, NOW + YEAR);
  expect(await expiry()).toBe(NOW + 28800000);
  // A shorter session (the previous Worker's 8 hours, or a trial grant) never shortens it.
  await insert('2', ctx.g, NOW + 3600000);
  expect(await expiry()).toBe(NOW + 28800000);
  await insert('3', ctx.g, NOW + YEAR);
  expect(await expiry()).toBe(NOW + YEAR);
  // The CHECK accepts exactly one year and nothing longer.
  await expect(insert('4', ctx.g, NOW + YEAR + 1)).rejects.toThrow();
});
it('does not count login-extended contexts toward the anonymous cap, even after logout (#269)', async () => {
  const db = await setup();
  let now = NOW;
  const c = new BrowserSessionCoordinator(db, O, () => now, {
    maxLiveContexts: 2,
    maxCommandsPerMinute: 2,
  });
  await db
    .prepare(
      "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('a','s','a@st.kobedenshi.ac.jp','active',?)",
    )
    .bind(NOW)
    .run();
  const YEAR = 365 * 86400000;
  // Two logins fill the cap with contexts, then a session extends each to a year and is revoked.
  for (const t of ['1', '2']) {
    expect(await c.bootstrap(req())).toBeTruthy();
    const h = (await db
      .prepare('SELECT context_hash h FROM auth_browser_contexts ORDER BY expires_at_ms LIMIT 1')
      .first<{ h: string }>())!.h;
    await db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,revoked_at_ms,context_hash,context_generation) VALUES(?,?,0,?,?,?,?,?,0)',
      )
      .bind(t.repeat(64), 'a', now, now, now + YEAR, now, h)
      .run();
    await db
      .prepare('UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash=?')
      .bind(h)
      .run();
  }
  expect(
    (
      await db
        .prepare('SELECT count(*) n FROM auth_browser_contexts WHERE expires_at_ms>?')
        .bind(now + 28800000)
        .first<{ n: number }>()
    )?.n,
  ).toBe(2);
  // The year-long rows leave the anonymous cap free; anonymous rows are still bounded.
  expect(await c.bootstrap(req())).toBeTruthy();
  expect(await c.bootstrap(req())).toBeTruthy();
  expect(await c.bootstrap(req())).toBeNull();
  now += 28800000;
  expect(await c.bootstrap(req())).toBeTruthy();
});
it('counts executed commands too, binds quota to context, permits recovery at the minute boundary', async () => {
  const db = await setup();
  let now = NOW;
  const c = new BrowserSessionCoordinator(db, O, () => now, {
    maxLiveContexts: 3,
    maxCommandsPerMinute: 2,
  });
  const a = (await c.bootstrap(req()))!,
    b = (await c.bootstrap(req()))!;
  const first = (await c.command(req(a.setCookie), 'login'))!;
  const h = new Headers(req(a.setCookie).headers);
  h.set('Authorization', 'Bearer command.' + first.commandToken);
  expect(
    await c.execute(new Request(O, { method: 'POST', headers: h }), 'login', {
      stateHash: 'a'.repeat(64),
      browserHash: 'b'.repeat(64),
      nonce: 'n'.repeat(43),
    }),
  ).toEqual({ kind: 'executed' });
  expect(await c.command(req(a.setCookie), 'login')).toBeTruthy();
  expect(await c.command(req(a.setCookie), 'pending-registration')).toBeNull();
  expect(await c.command(req(a.setCookie), 'logout')).toBeTruthy();
  expect(await c.command(req(b.setCookie), 'login')).toBeTruthy();
  now += 60000;
  expect(await c.command(req(a.setCookie), 'login')).toBeTruthy();
});
it('concurrent command insertion cannot exceed configured limit or advance context generation', async () => {
  const db = await setup();
  const c = new BrowserSessionCoordinator(db, O, () => NOW, {
    maxLiveContexts: 2,
    maxCommandsPerMinute: 3,
  });
  const a = (await c.bootstrap(req()))!;
  const results = await Promise.all(
    Array.from({ length: 12 }, () => c.command(req(a.setCookie), 'login')),
  );
  expect(results.filter(Boolean)).toHaveLength(3);
  expect(
    (await db.prepare('SELECT generation FROM auth_browser_contexts').first())?.generation,
  ).toBe(0);
  expect((await db.prepare('SELECT count(*) n FROM oauth_attempts').first())?.n).toBe(0);
});
it('rejects malformed/unbounded quota configuration before insertion', async () => {
  const db = await setup();
  for (const limits of [
    { maxLiveContexts: 0, maxCommandsPerMinute: 2 },
    { maxLiveContexts: 10001, maxCommandsPerMinute: 2 },
    { maxLiveContexts: 2, maxCommandsPerMinute: 21 },
    { maxLiveContexts: NaN, maxCommandsPerMinute: 2 },
  ])
    expect(
      await new BrowserSessionCoordinator(db, O, () => NOW, limits).bootstrap(req()),
    ).toBeNull();
  expect((await db.prepare('SELECT count(*) n FROM auth_browser_contexts').first())?.n).toBe(0);
});
