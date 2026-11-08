import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { base64url } from 'jose';
import { googleFixture, TEST_CLIENT_ID, TEST_EMAIL } from './helpers/google-fixtures';
import { applyOrderSchema } from './helpers/order-schema';
import { parsePendingPilot } from '../worker/auth/pending-pilot-policy';
import { pendingPilotPage } from '../worker/auth/pending-pilot-ui';
const O = 'https://student-app.example.test',
  now = Date.now(),
  expiry = now + 60000;
const bindings = {
  AUTH_ORIGIN: O,
  GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'synthetic-pilot-only',
  OAUTH_COOKIE_KEY: base64url.encode(new Uint8Array(32).fill(19)),
  OAUTH_PENDING_PILOT: JSON.stringify({ allowedEmail: TEST_EMAIL, expiresAtMs: expiry }),
};
let mf: Miniflare,
  fixture: Awaited<ReturnType<typeof googleFixture>>,
  calls = 0,
  callbackNow = now;
const tokens = new Map<string, string>();
async function req(path: string, method = 'GET', headers: Record<string, string> = {}, extra = {}) {
  return mf.dispatchFetch('https://fixture.invalid', {
    method: 'POST',
    redirect: 'manual',
    body: JSON.stringify({
      url: O + path,
      method,
      headers,
      bindings,
      pendingPilot: true,
      now: callbackNow,
      ...extra,
    }),
  });
}
const cookie = (r: { headers: { getSetCookie(): string[] } }) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
async function start() {
  const b = await req('/api/auth/bootstrap', 'POST', { Origin: O });
  expect(b.status).toBe(204);
  const context = cookie(b),
    command = await req('/api/auth/command?action=pending-registration', 'POST', {
      Origin: O,
      Cookie: context,
    });
  const { commandToken } = (await command.json()) as { commandToken: string };
  const r = await req('/api/auth/register', 'POST', {
    Origin: O,
    Cookie: context,
    Authorization: 'Bearer command.' + commandToken,
  });
  expect(r.status).toBe(200);
  expect(r.headers.has('Location')).toBe(false);
  const { authorizationUrl } = (await r.json()) as { authorizationUrl: string };
  return { u: new URL(authorizationUrl), cookie: context + '; ' + cookie(r) };
}
async function complete(email = TEST_EMAIL, extra = {}) {
  const a = await start(),
    state = a.u.searchParams.get('state')!;
  tokens.set(state, await fixture.sign({ email, nonce: a.u.searchParams.get('nonce') }));
  return req(
    '/api/auth/callback?state=' + state + '&code=' + state,
    'GET',
    { Cookie: a.cookie },
    extra,
  );
}
async function count(table: string) {
  return (await (
    await mf.getD1Database('DB')
  )
    .prepare('SELECT count(*) n FROM ' + table)
    .first<{ n: number }>())!.n;
}
beforeAll(async () => {
  fixture = await googleFixture();
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/oauth-http-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: async (r) => {
        if (r.url === 'https://www.googleapis.com/oauth2/v3/certs')
          return Response.json(fixture.jwks);
        expect(r.url).toBe('https://oauth2.googleapis.com/token');
        calls++;
        const f = new URLSearchParams(await r.text());
        expect(f.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        return Response.json({ id_token: tokens.get(f.get('code')!) });
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const name of ['0003_oauth_attempts.sql', '0004_private_sessions.sql'])
    for (const sql of readFileSync('migrations/' + name, 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?:\n|$)/)
      .filter((x) => x.trim()))
      await db.prepare(sql).run();
  await applyOrderSchema(db);
});
afterAll(async () => {
  await mf.dispose();
});
it('strict finite private policy and UI never expose the selected identity', () => {
  for (const v of [
    undefined,
    '{}',
    'null',
    '[]',
    JSON.stringify({ allowedEmail: TEST_EMAIL, expiresAtMs: now }),
    JSON.stringify({ allowedEmail: TEST_EMAIL, expiresAtMs: now + 86400001 }),
    JSON.stringify({ allowedEmail: TEST_EMAIL, expiresAtMs: expiry, extra: true }),
  ])
    expect(parsePendingPilot(v, now)).toBeNull();
  expect(parsePendingPilot(bindings.OAUTH_PENDING_PILOT, now)).toEqual({
    allowedEmail: TEST_EMAIL,
    expiresAtMs: expiry,
  });
  const r = pendingPilotPage(new Request(O + '/api/auth/pilot'), bindings, now)!;
  expect(r.status).toBe(200);
  expect(pendingPilotPage(new Request(O + '/api/auth/pilot'), bindings, expiry)!.status).toBe(404);
});
it('complete configuration alone stays closed; pilot cannot enable login/private or login command', async () => {
  expect(
    (
      await req(
        '/api/auth/bootstrap',
        'POST',
        { Origin: O },
        { bindings: { ...bindings, OAUTH_PENDING_PILOT: undefined } },
      )
    ).status,
  ).toBe(418);
  expect(
    (
      await req(
        '/api/auth/bootstrap',
        'POST',
        { Origin: O },
        { bindings: { ...bindings, GOOGLE_CLIENT_SECRET: undefined } },
      )
    ).status,
  ).toBe(503);
  for (const p of ['/api/auth/start', '/api/private/session', '/api/private/logout'])
    expect((await req(p, 'POST', { Origin: O })).status).toBe(404);
  expect((await req('/api/auth/command?action=login', 'POST', { Origin: O })).status).toBe(400);
});
it('real JOSE wrong email is never stored; allowed identity records pending without session/grant', async () => {
  const denied = await complete('other-fictional@st.kobedenshi.ac.jp');
  expect(denied.headers.get('Location')).toBe(O + '/api/auth/pilot#unavailable');
  expect(await count('private_accounts')).toBe(0);
  const received = await complete();
  expect(received.headers.get('Location')).toBe(O + '/api/auth/pilot#received');
  expect(received.headers.getSetCookie()).toEqual([]);
  expect(await received.text()).toBe('');
  expect(await count('private_accounts')).toBe(1);
  expect(
    (await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT status FROM private_accounts')
      .first<{ status: string }>())!.status,
  ).toBe('pending');
  expect(await count('auth_sessions')).toBe(0);
  expect(calls).toBe(2);
});
it('expired policy prevents callback exchange and further database acceptance', async () => {
  const a = await start(),
    before = calls;
  callbackNow = expiry;
  try {
    const r = await req(
      '/api/auth/callback?state=' + a.u.searchParams.get('state') + '&code=fictional',
      'GET',
      { Cookie: a.cookie },
    );
    expect(r.status).toBe(303);
    expect(r.headers.get('Location')).toBe(O + '/api/auth/pilot#unavailable');
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(calls).toBe(before);
    expect(await count('private_accounts')).toBe(1);
  } finally {
    callbackNow = now;
  }
});

it('deadline is rechecked after real JWT verification before pending acceptance', async () => {
  const before = calls;
  const r = await complete(TEST_EMAIL, { clockValues: [now, now, now, expiry] });
  expect(r.headers.get('Location')).toBe(O + '/api/auth/pilot#unavailable');
  expect(calls).toBe(before + 1);
  expect(await count('private_accounts')).toBe(1);
  expect(await count('auth_sessions')).toBe(0);
});

it('late callback after policy removal cleans query without DB or provider access', async () => {
  const before = calls;
  const r = await req(
    '/api/auth/callback?code=fictional&state=fictional',
    'GET',
    {},
    { forbidDb: true, bindings: { ...bindings, OAUTH_PENDING_PILOT: undefined } },
  );
  expect(r.status).toBe(303);
  expect(r.headers.get('Location')).toBe(O + '/api/auth/pilot#unavailable');
  expect(calls).toBe(before);
});
