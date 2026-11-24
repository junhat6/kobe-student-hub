import { afterEach, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { BrowserSessionCoordinator } from '../worker/auth/browser-session';
import { BrowserOAuthFlow } from '../worker/auth/browser-flow';
import { SESSION_CLOCK_SKEW_MS, SessionStore } from '../worker/auth/sessions';
import { createPrivateSessionHandler } from '../worker/session-http';
import { createOAuthHttpHandler } from '../worker/auth/oauth-http';
import { proofAuthorization } from '../src/shared/auth-proof';
const O = 'https://proof.example.invalid',
  NOW = 1800000000000,
  instances: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((m) => m.dispose()));
});
async function setup() {
  const m = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default{fetch(){return new Response("local")}}',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  instances.push(m);
  const db = (await m.getD1Database('DB')) as unknown as D1Database;
  for (const f of [
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0012_browser_session_order.sql',
    '0041_session_long_lifetime.sql',
    '0042_auth_command_context_skew.sql',
  ]) {
    const raw = readFileSync('migrations/' + f, 'utf8');
    await db.batch(
      raw
        .split(raw.includes('-- @statement') ? /^-- @statement\s*$/m : /;\s*(?:\n|$)/)
        .map((s) => s.replace(/^--.*$/gm, '').trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  }
  const c = new BrowserSessionCoordinator(db, O, () => NOW),
    s = new SessionStore(db, O, () => NOW);
  await db
    .prepare(
      "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('a','proof-subject','proof@st.kobedenshi.ac.jp','active',?)",
    )
    .bind(NOW)
    .run();
  return { db, c, s };
}
const request = (headers: Record<string, string | undefined> = {}, path = '/', method = 'POST') =>
  new Request(O + path, {
    method,
    headers: {
      Origin: O,
      ...Object.fromEntries(
        Object.entries(headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    },
  });
async function start(t: Awaited<ReturnType<typeof setup>>) {
  const b = (await t.c.bootstrap(request()))!,
    cookie = b.setCookie.split(';')[0];
  const command = (await t.c.command(request({ Cookie: cookie }), 'login'))!;
  return { cookie, command: command.commandToken };
}
async function session(t: Awaited<ReturnType<typeof setup>>) {
  const a = await start(t),
    flow = new BrowserOAuthFlow(
      t.db,
      {
        origin: O,
        clientId: 'proof.apps.googleusercontent.com',
        cookieKey: new Uint8Array(32).fill(29),
      },
      () => NOW,
    ),
    h = { Cookie: a.cookie, Authorization: proofAuthorization('command', a.command) };
  const begun = (await flow.start(request(h, '/api/auth/start')))!;
  const state = new URL(begun.location).searchParams.get('state');
  const claimed = await flow.claim(
    request(
      { Cookie: a.cookie + '; ' + begun.setCookie.split(';')[0] },
      '/api/auth/callback?state=' + state + '&code=synthetic',
      'GET',
    ),
  );
  if (claimed?.kind !== 'code') throw Error('fixture claim');
  const value = (await t.s.create(
    { provider: 'google', subject: 'proof-subject', email: 'proof@st.kobedenshi.ac.jp' },
    claimed.proof,
  ))!;
  return { ...value, cookie: a.cookie + '; ' + value.setCookie.split(';')[0] };
}
it('wrong purpose or legacy/mixed headers cannot execute or consume a valid start command', async () => {
  const t = await setup(),
    a = await start(t),
    attempt = { stateHash: 'a'.repeat(64), browserHash: 'b'.repeat(64), nonce: 'n'.repeat(43) };
  for (const h of [
    { Authorization: proofAuthorization('csrf', a.command) },
    { 'X-Session-Command': a.command },
    { Authorization: proofAuthorization('command', a.command), 'X-CSRF-Token': '' },
    {
      Authorization:
        proofAuthorization('command', a.command) + ', ' + proofAuthorization('command', a.command),
    },
  ])
    expect(await t.c.execute(request({ Cookie: a.cookie, ...h }), 'login', attempt)).toEqual({
      kind: 'rejected',
    });
  expect(
    (await t.db.prepare('SELECT generation FROM auth_browser_contexts').first())?.generation,
  ).toBe(0);
  expect((await t.db.prepare('SELECT count(*) n FROM oauth_attempts').first())?.n).toBe(0);
  expect(
    await t.c.execute(
      request({ Cookie: a.cookie, Authorization: proofAuthorization('command', a.command) }),
      'login',
      attempt,
    ),
  ).toEqual({ kind: 'executed' });
});
it('CSRF proofs require current cookies, Origin and csrf purpose; obsolete custom fields never substitute', async () => {
  const t = await setup(),
    a = await session(t);
  for (const h of [
    { Cookie: a.cookie, 'X-CSRF-Token': a.csrfToken },
    { Cookie: a.cookie, Authorization: proofAuthorization('command', a.csrfToken) },
    {
      Cookie: a.cookie,
      Authorization: proofAuthorization('csrf', a.csrfToken),
      'X-Session-Command': '',
    },
    { Authorization: proofAuthorization('csrf', a.csrfToken) },
    {
      Cookie: a.cookie,
      Authorization: proofAuthorization('csrf', a.csrfToken),
      Origin: 'https://other.invalid',
    },
  ])
    expect(await t.s.storageAuthorization(request(h))).toBeNull();
  expect(
    await t.s.storageAuthorization(
      new Request(O, {
        method: 'POST',
        headers: { Cookie: a.cookie, Authorization: proofAuthorization('csrf', a.csrfToken) },
      }),
    ),
  ).toBeNull();
  expect(
    await t.s.storageAuthorization(
      request({ Cookie: a.cookie, Authorization: proofAuthorization('csrf', a.csrfToken) }),
    ),
  ).toBeTruthy();
});
it('logout distinguishes parsed purpose and cannot treat csrf as a command merely because Authorization exists', async () => {
  const t = await setup(),
    a = await session(t),
    handler = createPrivateSessionHandler(t.db, O, () => NOW);
  expect(
    (
      await handler(
        request(
          { Cookie: a.cookie, Authorization: proofAuthorization('command', a.csrfToken) },
          '/api/private/logout',
        ),
      )
    )?.status,
  ).toBe(409);
  expect(await t.s.authenticate(request({ Cookie: a.cookie }, '/', 'GET'))).toBeTruthy();
  expect(
    (
      await handler(
        request(
          { Cookie: a.cookie, Authorization: proofAuthorization('csrf', a.csrfToken) },
          '/api/private/logout',
        ),
      )
    )?.status,
  ).toBe(200);
  expect(await t.s.authenticate(request({ Cookie: a.cookie }, '/', 'GET'))).toBeNull();
});
it('a context logout command remains bound to Origin and Cookie without accepting csrf purpose', async () => {
  const t = await setup(),
    a = await session(t),
    handler = createPrivateSessionHandler(t.db, O, () => NOW);
  const generated = (await handler(request({ Cookie: a.cookie }, '/api/private/logout-command')))!;
  const { commandToken } = (await generated.json()) as { commandToken: string };
  expect(
    (
      await handler(
        request(
          { Cookie: a.cookie, Authorization: proofAuthorization('csrf', commandToken) },
          '/api/private/logout',
        ),
      )
    )?.status,
  ).toBe(401);
  expect(
    (
      await handler(
        request(
          { Authorization: proofAuthorization('command', commandToken) },
          '/api/private/logout',
        ),
      )
    )?.status,
  ).toBe(409);
  expect(
    (
      await handler(
        request(
          {
            Cookie: a.cookie,
            Authorization: proofAuthorization('command', commandToken),
            Origin: 'https://other.invalid',
          },
          '/api/private/logout',
        ),
      )
    )?.status,
  ).toBe(401);
  expect(
    (
      await handler(
        request(
          { Cookie: a.cookie, Authorization: proofAuthorization('command', commandToken) },
          '/api/private/logout',
        ),
      )
    )?.status,
  ).toBe(200);
});
it('HTTP glue rejects legacy/mixed fields even on anonymous bootstrap, without setting context cookies', async () => {
  const t = await setup(),
    handler = createOAuthHttpHandler(
      t.db,
      {
        AUTH_ORIGIN: O,
        GOOGLE_CLIENT_ID: 'proof.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'synthetic-only',
        OAUTH_COOKIE_KEY: 'A'.repeat(43),
      },
      { enabled: true },
      () => NOW,
    );
  for (const h of [
    { 'X-Session-Command': 'x'.repeat(43) },
    { 'X-CSRF-Token': '' },
    {
      Authorization: proofAuthorization('command', 'x'.repeat(43)),
      'X-CSRF-Token': 'x'.repeat(43),
    },
  ]) {
    const r = (await handler(request(h, '/api/auth/bootstrap')))!;
    expect(r.status).toBe(400);
    expect(r.headers.has('Set-Cookie')).toBe(false);
  }
  expect((await t.db.prepare('SELECT count(*) n FROM auth_browser_contexts').first())?.n).toBe(0);
});
async function twoStepLogout() {
  const t = await setup(),
    a = await session(t),
    clock = { now: NOW };
  const handler = createPrivateSessionHandler(t.db, O, () => clock.now),
    generation = async () =>
      (await t.db.prepare('SELECT generation FROM auth_browser_contexts').first<{
        generation: number;
      }>())!.generation,
    commands = async () =>
      (await t.db.prepare('SELECT count(*) n FROM auth_browser_commands').first<{ n: number }>())!
        .n,
    issue = async (at: number) => {
      clock.now = at;
      return (await handler(request({ Cookie: a.cookie }, '/api/private/logout-command')))!;
    },
    token = async (at: number) => {
      const r = await issue(at);
      expect(r.status).toBe(200);
      return ((await r.json()) as { commandToken: string }).commandToken;
    },
    run = async (at: number, command: string, cookie = a.cookie) => {
      clock.now = at;
      return (await handler(
        request(
          { Cookie: cookie, Authorization: proofAuthorization('command', command) },
          '/api/private/logout',
        ),
      ))!;
    },
    live = () => t.s.authenticate(request({ Cookie: a.cookie }, '/', 'GET'));
  return { t, a, clock, generation, commands, issue, token, run, live };
}
it('two-step logout tolerates exactly SESSION_CLOCK_SKEW_MS of a trailing clock on the context row (#280)', async () => {
  const { clock, generation, commands, issue, token, run, live } = await twoStepLogout();
  const before = await generation(),
    issued = await commands();
  // The browser context was written at NOW by another isolate; both steps run on a trailing one.
  expect((await issue(NOW - SESSION_CLOCK_SKEW_MS - 1)).status).toBe(409);
  expect(await commands()).toBe(issued);
  const command = await token(NOW - SESSION_CLOCK_SKEW_MS);
  const tooEarly = await run(NOW - SESSION_CLOCK_SKEW_MS - 1, command);
  expect(tooEarly.status).toBe(409);
  expect(await tooEarly.json()).toEqual({ error: 'authentication_restart_required' });
  expect(await generation()).toBe(before);
  expect(await live()).not.toBeNull();
  const ok = await run(NOW - SESSION_CLOCK_SKEW_MS, command);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ loggedOut: true });
  expect(await generation()).toBe(before + 1);
  clock.now = NOW;
  expect(await live()).toBeNull();
});
it('two-step logout tolerates exactly SESSION_CLOCK_SKEW_MS on the command row and replays only the same command (#280)', async () => {
  const { t, a, clock, generation, token, run, live } = await twoStepLogout();
  // The command row is the newer write: the context is older, the command was issued at NOW,
  // and the proof arrives on an isolate whose clock trails.
  await t.db
    .prepare('UPDATE auth_browser_contexts SET created_at_ms=?')
    .bind(NOW - 60_000)
    .run();
  const before = await generation(),
    command = await token(NOW);
  const rolledBack = await run(NOW - SESSION_CLOCK_SKEW_MS - 1, command);
  expect(rolledBack.status).toBe(409);
  expect(await generation()).toBe(before);
  expect(await live()).not.toBeNull();
  const ok = await run(NOW - SESSION_CLOCK_SKEW_MS, command);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ loggedOut: true });
  expect(await generation()).toBe(before + 1);
  clock.now = NOW;
  expect(await live()).toBeNull();
  // A replay of the executed command from the same trailing isolate is reported as already done.
  expect((await run(NOW - SESSION_CLOCK_SKEW_MS, command)).status).toBe(200);
  // ...but not beyond the tolerance, after the command expired, for another action, or from
  // another browser context.
  expect((await run(NOW - SESSION_CLOCK_SKEW_MS - 1, command)).status).toBe(409);
  expect((await run(NOW + 60_000, command)).status).toBe(409);
  clock.now = NOW;
  expect(
    await t.c.execute(
      request({ Cookie: a.cookie, Authorization: proofAuthorization('command', command) }),
      'login',
    ),
  ).toEqual({ kind: 'rejected' });
  const other = await session(t);
  expect((await run(NOW, command, other.cookie)).status).toBe(409);
});
