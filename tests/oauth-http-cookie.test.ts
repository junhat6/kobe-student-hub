import { workerModules } from './helpers/worker-modules';
import { applySelfRegistrationSchema } from './helpers/order-schema';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { base64url } from 'jose';
import { googleFixture, TEST_CLIENT_ID } from './helpers/google-fixtures';
const O = 'https://cookie-ownership.example.test',
  NOW = Date.now();
// Public deterministic fixture bytes, never an operational key or credential.
const bindings = {
  AUTH_ORIGIN: O,
  GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'synthetic-cookie-fixture',
  OAUTH_COOKIE_KEY: base64url.encode(new Uint8Array(32).fill(17)),
};
let mf: Miniflare,
  signer: Awaited<ReturnType<typeof googleFixture>>,
  exchanges = 0,
  refuse = false;
const tokens = new Map<string, string>();
class Jar {
  values = new Map<string, string>();
  header() {
    return [...this.values].map(([name, value]) => name + '=' + value).join('; ');
  }
  apply(response: { headers: { getSetCookie(): string[] } }) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0],
        at = pair.indexOf('='),
        name = pair.slice(0, at),
        value = pair.slice(at + 1);
      if (/(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cookie)) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
}
async function call(jar: Jar, path: string, method = 'GET', extra: Record<string, unknown> = {}) {
  const r = await mf.dispatchFetch('https://fixture.invalid', {
    method: 'POST',
    redirect: 'manual',
    body: JSON.stringify({
      url: O + path,
      method,
      headers: { Cookie: jar.header(), ...(method === 'POST' ? { Origin: O } : {}) },
      bindings,
      enabled: true,
      now: NOW,
      ...extra,
    }),
  });
  jar.apply(r);
  return r;
}
async function start(jar: Jar, registration = false, subject = 'cookie-active') {
  await applySelfRegistrationSchema(await mf.getD1Database('DB'));
  if (!jar.header().includes('__Host-kobe-browser='))
    await call(jar, '/api/auth/bootstrap', 'POST');
  const commandResponse = await call(
    jar,
    '/api/auth/command?action=' + (registration ? 'self-registration' : 'login'),
    'POST',
  );
  const { commandToken } = (await commandResponse.json()) as { commandToken: string };
  const r = await call(jar, registration ? '/api/auth/register' : '/api/auth/start', 'POST', {
    headers: {
      Origin: O,
      Cookie: jar.header(),
      Authorization: 'Bearer command.' + commandToken,
      ...(registration ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(registration
      ? { body: JSON.stringify({ admissionYear: 2026, graduationYear: 2027 }) }
      : {}),
  });
  expect(r.status).toBe(303);
  const u = new URL(r.headers.get('Location')!),
    state = u.searchParams.get('state')!;
  tokens.set(
    state,
    await signer.sign({
      sub: subject,
      email: subject + '@st.kobedenshi.ac.jp',
      nonce: u.searchParams.get('nonce'),
    }),
  );
  return state;
}
const postCallback = (jar: Jar, body: string, extra: Record<string, unknown> = {}) =>
  call(jar, '/api/auth/callback', 'POST', {
    headers: {
      Origin: O,
      Cookie: jar.header(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    ...extra,
  });
const callback = (jar: Jar, state: string, suffix = '') =>
  postCallback(jar, new URLSearchParams({ state, code: state }).toString() + suffix);
beforeAll(async () => {
  signer = await googleFixture();
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/oauth-http-test.js'),
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: async (r) => {
        if (r.url === 'https://www.googleapis.com/oauth2/v3/certs')
          return Response.json(signer.jwks);
        expect(r.url).toBe('https://oauth2.googleapis.com/token');
        exchanges++;
        const form = new URLSearchParams(await r.text());
        return refuse
          ? new Response('PRIVATE_PROVIDER_FAILURE', { status: 400 })
          : Response.json({ id_token: tokens.get(form.get('code')!) });
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const f of ['0003_oauth_attempts.sql', '0004_private_sessions.sql'])
    for (const sql of readFileSync('migrations/' + f, 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?:\n|$)/)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  await db
    .prepare(
      "INSERT INTO private_accounts VALUES('cookie-active-id','cookie-active','cookie-active@st.kobedenshi.ac.jp','active',0,?)",
    )
    .bind(NOW)
    .run();
});
afterAll(async () => {
  await mf?.dispose();
});
it('preserves newer B after stale A callback and completes B using the updated cookie jar', async () => {
  const jar = new Jar(),
    a = await start(jar),
    b = await start(jar),
    bCookie = jar.values.get('__Host-kobe-oauth'),
    before = exchanges;
  const stale = await callback(jar, a),
    bPreserved = jar.values.get('__Host-kobe-oauth') === bCookie;
  const completed = await callback(jar, b);
  expect({
    staleCookieWrites: stale.headers.getSetCookie().length,
    bPreserved,
    bSession: jar.values.has('__Host-kobe-session'),
    attemptRetained: jar.values.has('__Host-kobe-oauth'),
    exchanges: exchanges - before,
    status: completed.status,
  }).toEqual({
    staleCookieWrites: 0,
    bPreserved: true,
    bSession: true,
    attemptRetained: true,
    exchanges: 1,
    status: 303,
  });
});
function clean(r: Awaited<ReturnType<typeof call>>) {
  expect(r.status).toBe(303);
  expect(r.headers.get('Location')).toBe(O + '/#');
  for (const [k, v] of Object.entries({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  }))
    expect(r.headers.get(k)).toBe(v);
}
const sessions = async () =>
  Number(
    (await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT count(*) n FROM auth_sessions')
      .first<{ n: number }>())!.n,
  );
for (const mode of ['denial', 'exchange-failure'])
  it(`retains the original attempt after matched ${mode} keeps the old Cookie inert and allows a fresh attempt`, async () => {
    const jar = new Jar();
    await callback(jar, await start(jar));
    const session = jar.values.get('__Host-kobe-session'),
      state = await start(jar),
      before = exchanges;
    let failed: Awaited<ReturnType<typeof call>>;
    try {
      refuse = mode === 'exchange-failure';
      failed =
        mode === 'denial'
          ? await postCallback(
              jar,
              new URLSearchParams({
                state,
                error: 'access_denied',
                error_description: 'PRIVATE',
              }).toString(),
            )
          : await callback(jar, state);
    } finally {
      refuse = false;
    }
    clean(failed!);
    expect(failed!.headers.getSetCookie()).toEqual([]);
    expect(await failed!.text()).toBe('');
    expect(jar.values.has('__Host-kobe-oauth')).toBe(true);
    expect(jar.values.get('__Host-kobe-session') === session).toBe(true);
    expect((await call(jar, '/api/private/session')).status).toBe(401);
    const replay = await callback(jar, state);
    clean(replay);
    expect(replay.headers.getSetCookie()).toHaveLength(0);
    expect(exchanges - before).toBe(mode === 'denial' ? 0 : 1);
    await callback(jar, await start(jar));
    expect((await call(jar, '/api/private/session')).status).toBe(200);
  });
it('preserves both a newer attempt and the issued session when a completed callback is replayed', async () => {
  const jar = new Jar(),
    a = await start(jar);
  await callback(jar, a);
  const oldSession = jar.values.get('__Host-kobe-session')!,
    b = await start(jar),
    bCookie = jar.values.get('__Host-kobe-oauth'),
    before = exchanges;
  const replay = await callback(jar, a);
  clean(replay);
  expect(replay.headers.getSetCookie()).toHaveLength(0);
  expect(jar.values.get('__Host-kobe-oauth') === bCookie).toBe(true);
  expect(jar.values.get('__Host-kobe-session') === oldSession).toBe(true);
  expect(exchanges).toBe(before);
  await callback(jar, b);
  expect(jar.values.has('__Host-kobe-oauth')).toBe(true);
  expect((await call(jar, '/api/private/session')).status).toBe(200);
  const oldJar = new Jar();
  oldJar.values.set('__Host-kobe-session', oldSession);
  expect((await call(oldJar, '/api/private/session')).status).toBe(401);
});
it('applies concurrent callback cookies and later concurrent replays without erasing a newer attempt', async () => {
  const jar = new Jar(),
    state = await start(jar),
    before = exchanges,
    sessionCount = await sessions();
  const rs = await Promise.all(Array.from({ length: 8 }, () => callback(jar, state)));
  rs.forEach(clean);
  expect(rs.map((r) => r.headers.getSetCookie().length).sort()).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  expect(exchanges - before).toBe(1);
  expect(await sessions()).toBe(sessionCount + 1);
  expect(jar.values.has('__Host-kobe-oauth')).toBe(true);
  expect((await call(jar, '/api/private/session')).status).toBe(200);
  const next = await start(jar),
    nextCookie = jar.values.get('__Host-kobe-oauth'),
    session = jar.values.get('__Host-kobe-session');
  const replays = await Promise.all(Array.from({ length: 4 }, () => callback(jar, state)));
  for (const r of replays) {
    clean(r);
    expect(r.headers.getSetCookie()).toHaveLength(0);
  }
  expect(jar.values.get('__Host-kobe-oauth') === nextCookie).toBe(true);
  expect(jar.values.get('__Host-kobe-session') === session).toBe(true);
  await callback(jar, next);
  expect((await call(jar, '/api/private/session')).status).toBe(200);
});
it('leaves B usable after malformed, missing, duplicate and fragment callbacks', async () => {
  const jar = new Jar(),
    b = await start(jar),
    saved = jar.values.get('__Host-kobe-oauth'),
    before = exchanges;
  for (const path of [
    '/api/auth/callback',
    '/api/auth/callback?state=not-a-state&code=PRIVATE',
    '/api/auth/callback?state=' + b + '&state=' + b + '&code=' + b,
    '/api/auth/callback?state=' + b + '&code=' + b + '#fragment',
  ]) {
    const r = await call(jar, path);
    if (path === '/api/auth/callback') {
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('/api/auth/callback/receive.js');
    } else clean(r);
    expect(r.headers.getSetCookie()).toHaveLength(0);
    expect(jar.values.get('__Host-kobe-oauth') === saved).toBe(true);
  }
  expect(exchanges).toBe(before);
  await callback(jar, b);
  expect((await call(jar, '/api/private/session')).status).toBe(200);
});
it('preserves newer sealed login and registration purposes across stale callbacks', async () => {
  for (const [index, aReg, bReg] of [
    [0, true, false],
    [1, false, true],
    [2, true, true],
  ] as const) {
    const jar = new Jar();
    await callback(jar, await start(jar));
    const session = jar.values.get('__Host-kobe-session'),
      a = await start(jar, aReg),
      b = await start(jar, bReg, bReg ? 'cookie-new-' + index : 'cookie-active'),
      saved = jar.values.get('__Host-kobe-oauth'),
      before = exchanges;
    const stale = await callback(jar, a);
    clean(stale);
    expect(stale.headers.getSetCookie()).toHaveLength(0);
    expect(jar.values.get('__Host-kobe-oauth') === saved).toBe(true);
    expect(jar.values.get('__Host-kobe-session') === session).toBe(true);
    expect(exchanges).toBe(before);
    const result = await callback(jar, b);
    clean(result);
    expect(jar.values.has('__Host-kobe-oauth')).toBe(true);
    expect(result.headers.getSetCookie()).toHaveLength(1);
    expect(jar.values.get('__Host-kobe-session') === session).toBe(false);
    expect((await call(jar, '/api/private/session')).status).toBe(200);
  }
});
it('preserves the attempt and session when a database claim fails closed, then permits retry', async () => {
  const jar = new Jar();
  await callback(jar, await start(jar));
  const session = jar.values.get('__Host-kobe-session'),
    b = await start(jar),
    saved = jar.values.get('__Host-kobe-oauth'),
    before = exchanges;
  const failed = await postCallback(jar, new URLSearchParams({ state: b, code: b }).toString(), {
    forbidDb: true,
  });
  clean(failed);
  expect(failed.headers.getSetCookie()).toHaveLength(0);
  expect(await failed.text()).toBe('');
  expect(jar.values.get('__Host-kobe-oauth') === saved).toBe(true);
  expect(jar.values.get('__Host-kobe-session') === session).toBe(true);
  expect(exchanges).toBe(before);
  await callback(jar, b);
  expect(jar.values.has('__Host-kobe-oauth')).toBe(true);
  expect((await call(jar, '/api/private/session')).status).toBe(200);
  expect(exchanges - before).toBe(1);
});
it('does not clear B for missing, duplicated or oversized request cookies', async () => {
  const jar = new Jar(),
    b = await start(jar),
    saved = jar.values.get('__Host-kobe-oauth')!,
    before = exchanges;
  for (const Cookie of [
    '',
    jar.header() + '; __Host-kobe-oauth=' + saved,
    '__Host-kobe-oauth=' + 'x'.repeat(4097),
  ]) {
    const r = await postCallback(jar, new URLSearchParams({ state: b, code: b }).toString(), {
      headers: { Cookie, Origin: O, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    clean(r);
    expect(r.headers.getSetCookie()).toHaveLength(0);
    expect(jar.values.get('__Host-kobe-oauth') === saved).toBe(true);
  }
  expect(exchanges).toBe(before);
  await callback(jar, b);
  expect(jar.values.has('__Host-kobe-session')).toBe(true);
  expect((await call(jar, '/api/private/session')).status).toBe(200);
});
