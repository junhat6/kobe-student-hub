import { workerModules } from './helpers/worker-modules';
import { applySelfRegistrationSchema } from './helpers/order-schema';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { base64url } from 'jose';
import { googleFixture, TEST_CLIENT_ID } from './helpers/google-fixtures';
const O = 'https://independent-app.example.test',
  NOW = Date.now(),
  bindings = {
    AUTH_ORIGIN: O,
    GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'synthetic-independent-secret',
    OAUTH_COOKIE_KEY: base64url.encode(crypto.getRandomValues(new Uint8Array(32))),
  };
let mf: Miniflare,
  signer: Awaited<ReturnType<typeof googleFixture>>,
  exchanges = 0;
const tokens = new Map<string, string>();
async function req(
  path: string,
  method = 'GET',
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) {
  return mf.dispatchFetch('https://fixture.invalid', {
    redirect: 'manual',
    method: 'POST',
    body: JSON.stringify({
      url: O + path,
      method,
      headers,
      bindings,
      enabled: true,
      now: NOW,
      ...extra,
    }),
  });
}
async function attempt(subject: string, registration = false) {
  await applySelfRegistrationSchema(await mf.getD1Database('DB'));
  const bootstrap = await req('/api/auth/bootstrap', 'POST', { Origin: O }),
    context = bootstrap.headers.getSetCookie()[0].split(';')[0],
    proof = await req(
      '/api/auth/command?action=' + (registration ? 'self-registration' : 'login'),
      'POST',
      { Origin: O, Cookie: context },
    ),
    { commandToken } = (await proof.json()) as { commandToken: string };
  const r = await req(
    registration ? '/api/auth/register' : '/api/auth/start',
    'POST',
    {
      Origin: O,
      Cookie: context,
      Authorization: 'Bearer command.' + commandToken,
      ...(registration ? { 'Content-Type': 'application/json' } : {}),
    },
    registration ? { body: JSON.stringify({ admissionYear: 2026, graduationYear: 2027 }) } : {},
  );
  expect(r.status).toBe(303);
  const location = new URL(r.headers.get('Location')!),
    state = location.searchParams.get('state')!;
  tokens.set(
    state,
    await signer.sign({
      sub: subject,
      email: subject + '@st.kobedenshi.ac.jp',
      nonce: location.searchParams.get('nonce'),
    }),
  );
  return { state, cookie: r.headers.getSetCookie()[0].split(';')[0] + '; ' + context };
}
async function callback(a: Awaited<ReturnType<typeof attempt>>, cookie = '') {
  return req(
    '/api/auth/callback',
    'POST',
    {
      Cookie: [a.cookie, cookie].filter(Boolean).join('; '),
      Origin: O,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    { body: new URLSearchParams({ state: a.state, code: a.state }).toString() },
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
        const body = new URLSearchParams(await r.text());
        expect(body.get('redirect_uri')).toBe(O + '/api/auth/callback');
        return Response.json({ id_token: tokens.get(body.get('code')!) });
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
      "INSERT INTO private_accounts VALUES('independent-active','existing-active','existing-active@st.kobedenshi.ac.jp','active',0,?)",
    )
    .bind(NOW)
    .run();
});
afterAll(async () => {
  await mf?.dispose();
});
it('independent self-registration creates its own session and preserves an unrelated browser context', async () => {
  const original = await attempt('existing-active'),
    login = await callback(original);
  expect(login.status).toBe(303);
  const raw = login.headers.getSetCookie();
  expect(raw).toHaveLength(1);
  expect(raw.filter((c) => c.startsWith('__Host-kobe-oauth='))).toHaveLength(0);
  const session = raw.find((c) => c.startsWith('__Host-kobe-session='))!.split(';')[0];
  const before = await count('auth_sessions');
  const registered = await callback(await attempt('new-self-declared', true), session);
  expect(registered.status).toBe(303);
  expect(registered.headers.get('Location')).toBe(O + '/#');
  expect(await registered.text()).toBe('');
  expect(
    registered.headers.getSetCookie().filter((c) => c.startsWith('__Host-kobe-session=')),
  ).toHaveLength(1);
  expect(await count('auth_sessions')).toBe(before + 1);
  const db = await mf.getD1Database('DB');
  expect(
    await db
      .prepare("SELECT status FROM private_accounts WHERE google_subject='new-self-declared'")
      .first(),
  ).toEqual({ status: 'active' });
  const old = await req('/api/private/session', 'GET', {
    Cookie: session + '; ' + original.cookie.split('; ')[1],
  });
  expect(old.status).toBe(200);
  expect(Object.keys((await old.json()) as object)).toEqual(['csrfToken']);
  expect((await req('/api/private/session')).status).toBe(401);
  const returning = await callback(await attempt('new-self-declared'));
  expect(
    returning.headers.getSetCookie().filter((c) => c.startsWith('__Host-kobe-session=')),
  ).toHaveLength(1);
  expect(await count('auth_sessions')).toBe(before + 2);
});
it('independent partial absent null or wrongly typed optional configuration stays closed before attempts and exchange', async () => {
  const attempts = await count('oauth_attempts'),
    before = exchanges;
  const variants: Record<string, unknown>[] = [{}];
  for (const name of Object.keys(bindings)) {
    const missing: Record<string, unknown> = { ...bindings };
    delete missing[name];
    variants.push(
      missing,
      { ...bindings, [name]: null },
      { ...bindings, [name]: 43 },
      { ...bindings, [name]: { value: 'PRIVATE' } },
    );
  }
  for (const config of variants)
    for (const path of [
      '/api/auth/bootstrap',
      '/api/auth/command?action=login',
      '/api/private/logout-command',
      '/api/auth/start',
      '/api/auth/register',
      '/api/auth/callback?state=PRIVATE&code=PRIVATE',
      '/api/private/session',
      '/api/private/logout',
    ]) {
      const r = await req(
        path,
        path.includes('callback') || path.endsWith('session') ? 'GET' : 'POST',
        { Origin: O },
        { bindings: config },
      );
      const callback = path.includes('callback');
      expect(r.status).toBe(callback ? 303 : 503);
      expect(r.headers.get('Cache-Control')).toBe('private, no-store');
      expect(r.headers.has('Set-Cookie')).toBe(false);
      expect(r.headers.get('Location')).toBe(callback ? '/#authentication-failed' : null);
      expect(await r.text()).toBe(callback ? '' : '{"error":"authentication_unavailable"}');
    }
  expect(await count('oauth_attempts')).toBe(attempts);
  expect(exchanges).toBe(before);
});
it('independent ordinary login stage rejects unproved identity and runtime flags cannot open authoring', async () => {
  const before = exchanges;
  for (const [path, status] of [
    ['/api/auth/bootstrap', 503],
    ['/api/auth/command?action=login', 503],
    ['/api/private/logout-command', 503],
    ['/api/auth/start', 400],
    ['/api/auth/register', 400],
    ['/api/auth/callback', 200],
    ['/api/auth/callback?state=PRIVATE&code=PRIVATE', 303],
    ['/api/private/session', 401],
    ['/api/private/logout', 401],
    ['/api/private/drafts', 405],
    ['/api/private/moderation/cases', 405],
  ] as const) {
    const r = await req(
      path,
      path.includes('callback') || path.endsWith('session') ? 'GET' : 'POST',
      { Origin: O, 'X-Auth-Enabled': 'true' },
      {
        production: true,
        forbidDb: true,
        enabled: true,
        bindings: { ...bindings, AUTH_ENABLED: 'true', OAUTH_HTTP_RELEASE_ENABLED: 'true' },
      },
    );
    expect(r.status).toBe(status);
    expect(r.headers.has('Set-Cookie')).toBe(false);
    expect(r.headers.get('Location')).toBe(
      path.includes('callback?') ? O + '/account#authentication-failed' : null,
    );
  }
  expect(
    await (await req('/api/health', 'GET', {}, { production: true, forbidDb: true })).json(),
  ).toMatchObject({ writesEnabled: false });
  expect(exchanges).toBe(before);
});
