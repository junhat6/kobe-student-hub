import { workerModules } from './helpers/worker-modules';
import { applySelfRegistrationSchema } from './helpers/order-schema';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { base64url } from 'jose';
import { googleFixture, TEST_CLIENT_ID } from './helpers/google-fixtures';
const O = 'https://student-app.example.test',
  NOW = Date.now(),
  cookieKey = base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const config = {
  AUTH_ORIGIN: O,
  GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'synthetic-secret-only',
  OAUTH_COOKIE_KEY: cookieKey,
};
let mf: Miniflare,
  fixture: Awaited<ReturnType<typeof googleFixture>>,
  exchanges = 0;
const tokens = new Map<string, string>();
let refusal = false;
async function request(
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
      bindings: config,
      enabled: true,
      now: NOW,
      ...extra,
    }),
  });
}
type HttpResponse = Awaited<ReturnType<typeof request>>;
function privacy(r: HttpResponse) {
  for (const [k, v] of Object.entries({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  }))
    expect(r.headers.get(k)).toBe(v);
  expect(r.headers.has('Access-Control-Allow-Origin')).toBe(false);
}
const cookies = (r: HttpResponse) => r.headers.getSetCookie();
async function start(reg = false, headers: Record<string, string> = { Origin: O }) {
  await applySelfRegistrationSchema(await mf.getD1Database('DB'));
  const bootstrap = await request('/api/auth/bootstrap', 'POST', { Origin: O }),
    context = cookies(bootstrap)[0].split(';')[0];
  const proof = await request(
    '/api/auth/command?action=' + (reg ? 'self-registration' : 'login'),
    'POST',
    { Origin: O, Cookie: context },
  );
  const { commandToken } = (await proof.json()) as { commandToken: string };
  const r = await request(
    reg ? '/api/auth/register' : '/api/auth/start',
    'POST',
    {
      ...headers,
      Cookie: context,
      Authorization: 'Bearer command.' + commandToken,
      ...(reg ? { 'Content-Type': 'application/json' } : {}),
    },
    reg ? { body: JSON.stringify({ admissionYear: 2026, graduationYear: 2027 }) } : {},
  );
  privacy(r);
  expect(r.status).toBe(303);
  const u = new URL(r.headers.get('Location')!);
  return { url: u, cookie: cookies(r)[0].split(';')[0] + '; ' + context, context };
}
async function prepare(subject = 'active-subject', reg = false, patch = {}) {
  const a = await start(reg);
  const state = a.url.searchParams.get('state')!;
  tokens.set(
    state,
    await fixture.sign({
      sub: subject,
      email: subject + '@st.kobedenshi.ac.jp',
      nonce: a.url.searchParams.get('nonce'),
      ...patch,
    }),
  );
  return a;
}
const responseContexts = new WeakMap<object, string>();
async function callback(a: Awaited<ReturnType<typeof start>>, suffix = '') {
  const state = a.url.searchParams.get('state')!;
  const r = await request(
    '/api/auth/callback',
    'POST',
    {
      Cookie: a.cookie,
      Origin: O,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    { body: new URLSearchParams({ state, code: state }).toString() + suffix },
  );
  responseContexts.set(r, a.context);
  return r;
}
function clean(r: HttpResponse, _cleared = false) {
  privacy(r);
  expect(r.status).toBe(303);
  expect(r.headers.get('Location')).toBe(
    O +
      '/#' +
      (r.headers.getSetCookie().some((value) => value.startsWith('__Host-kobe-session='))
        ? ''
        : 'authentication-failed'),
  );
  expect(
    cookies(r).some((c) => c.startsWith('__Host-kobe-oauth=;') && c.includes('Max-Age=0')),
  ).toBe(false);
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
      modules: workerModules('.worker/oauth-http-test.js'),
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: async (r) => {
        if (r.url === 'https://www.googleapis.com/oauth2/v3/certs')
          return Response.json(fixture.jwks);
        expect(r.url).toBe('https://oauth2.googleapis.com/token');
        exchanges++;
        const form = new URLSearchParams(await r.text());
        expect(form.get('redirect_uri')).toBe(O + '/api/auth/callback');
        expect(form.get('client_id')).toBe(TEST_CLIENT_ID);
        expect(form.get('client_secret')).toBe(config.GOOGLE_CLIENT_SECRET);
        expect(form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        return refusal
          ? new Response('PRIVATE_PROVIDER_ERROR', { status: 400 })
          : Response.json({
              id_token: tokens.get(form.get('code')!),
              access_token: 'PRIVATE_TOKEN',
            });
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of ['0003_oauth_attempts.sql', '0004_private_sessions.sql'])
    for (const sql of readFileSync('migrations/' + file, 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?:\n|$)/)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  await db
    .prepare(
      "INSERT INTO private_accounts VALUES('private-active','active-subject','active-subject@st.kobedenshi.ac.jp','active',0,?)",
    )
    .bind(NOW)
    .run();
});
afterAll(async () => {
  await mf?.dispose();
});
it('mounts ordinary account and authoring routes while rejecting unproved requests', async () => {
  const before = await count('oauth_attempts'),
    calls = exchanges;
  for (const [path, status] of [
    ['/api/auth/bootstrap', 503],
    ['/api/auth/command?action=login', 503],
    ['/api/private/logout-command', 503],
    ['/api/auth/start', 400],
    ['/api/auth/register', 400],
    ['/api/auth/callback', 200],
    ['/api/auth/callback?code=synthetic&state=synthetic', 303],
    ['/api/private/session', 401],
    ['/api/private/logout', 401],
    ['/api/private/drafts', 401],
    ['/api/private/profile', 401],
  ] as const)
    expect(
      (
        await request(
          path,
          path.includes('callback') || path.endsWith('session') ? 'GET' : 'POST',
          { Origin: O },
          { production: true, forbidDb: true },
        )
      ).status,
    ).toBe(status);
  expect(
    await (await request('/api/health', 'GET', {}, { production: true })).json(),
  ).toMatchObject({ writesEnabled: true });
  expect(await count('oauth_attempts')).toBe(before);
  expect(exchanges).toBe(calls);
});
it('ordinary production entry registers a verified fictional student, manages years and enforces authoring input checks before logout', async () => {
  await applySelfRegistrationSchema(await mf.getD1Database('DB'));
  const production = { production: true },
    bootstrap = await request('/api/auth/bootstrap', 'POST', { Origin: O }, production);
  expect(bootstrap.status).toBe(204);
  const context = cookies(bootstrap)[0].split(';')[0],
    command = await request(
      '/api/auth/command?action=self-registration',
      'POST',
      { Origin: O, Cookie: context },
      production,
    ),
    { commandToken } = (await command.json()) as { commandToken: string };
  const start = await request(
    '/api/auth/register',
    'POST',
    {
      Origin: O,
      Cookie: context,
      Authorization: 'Bearer command.' + commandToken,
      'Content-Type': 'application/json',
    },
    { ...production, body: JSON.stringify({ admissionYear: 2026, graduationYear: 2028 }) },
  );
  expect(start.status).toBe(200);
  privacy(start);
  const { authorizationUrl } = (await start.json()) as { authorizationUrl: string },
    authorization = new URL(authorizationUrl),
    state = authorization.searchParams.get('state')!;
  expect(authorization.searchParams.get('response_type')).toBe('code');
  expect(authorization.searchParams.get('response_mode')).toBe('form_post');
  tokens.set(
    state,
    await fixture.sign({
      sub: 'ordinary-stage-student',
      email: 'ordinary-stage-student@st.kobedenshi.ac.jp',
      nonce: authorization.searchParams.get('nonce'),
    }),
  );
  const callbackCookie = context + '; ' + cookies(start)[0].split(';')[0],
    exchangeBeforeGet = exchanges;
  const shell = await request('/api/auth/callback', 'GET', { Cookie: callbackCookie }, production);
  expect(shell.status).toBe(200);
  privacy(shell);
  expect(shell.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  expect(shell.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  expect(shell.headers.has('Set-Cookie')).toBe(false);
  expect(await shell.text()).toContain('/api/auth/callback/receive.js');
  const query = await request(
    '/api/auth/callback?' + new URLSearchParams({ state, code: state }),
    'GET',
    { Cookie: callbackCookie },
    production,
  );
  expect(query.status).toBe(303);
  expect(query.headers.get('Location')).toBe(O + '/account#authentication-failed');
  expect(query.headers.has('Set-Cookie')).toBe(false);
  expect(exchanges).toBe(exchangeBeforeGet);
  // The valid attempt still completes through POST: the shell/query GETs consumed nothing.
  const callback = await request(
    '/api/auth/callback',
    'POST',
    {
      Cookie: callbackCookie,
      Origin: O,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    { ...production, body: new URLSearchParams({ state, code: state }).toString() },
  );
  expect(callback.status).toBe(303);
  expect(callback.headers.get('Location')).toBe(O + '/account#');
  const cookie = context + '; ' + cookies(callback)[0].split(';')[0],
    inspection = await request('/api/private/session', 'GET', { Cookie: cookie }, production);
  expect(inspection.status).toBe(200);
  const privateSession = (await inspection.json()) as { csrfToken: string };
  expect(Object.keys(privateSession)).toEqual(['csrfToken']);
  const years = await request('/api/private/enrollment', 'GET', { Cookie: cookie }, production);
  privacy(years);
  expect(await years.json()).toMatchObject({
    enrollment: { admissionYear: 2026, graduationYear: 2028, version: 1 },
  });
  const headers = {
    Cookie: cookie,
    Origin: O,
    Authorization: 'Bearer csrf.' + privateSession.csrfToken,
  };
  const saved = await request(
    '/api/private/enrollment',
    'PUT',
    { ...headers, 'Content-Type': 'application/json' },
    {
      ...production,
      body: JSON.stringify({ admissionYear: 2026, graduationYear: 2027, expectedVersion: 1 }),
    },
  );
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ enrollment: { graduationYear: 2027, version: 2 } });
  for (const path of [
    '/api/private/drafts',
    '/api/private/profile',
    '/api/private/article-likes/test',
    '/api/private/reports/test',
  ]) {
    const r = await request(path, 'POST', headers, production);
    expect(r.status).toBe(path === '/api/private/article-likes/test' ? 404 : 415);
    expect(r.headers.has('Set-Cookie')).toBe(false);
  }
  const loggedOut = await request('/api/private/logout', 'POST', headers, production);
  expect(loggedOut.status).toBe(200);
  expect(await loggedOut.json()).toEqual({ loggedOut: true });
  expect(
    (await request('/api/private/session', 'GET', { Cookie: cookie }, production)).status,
  ).toBe(401);
});
it('defaults disabled and refuses malformed config before any attempt or exchange', async () => {
  expect((await request('/api/auth/start', 'POST', { Origin: O }, { enabled: false })).status).toBe(
    418,
  );
  const before = await count('oauth_attempts');
  for (const patch of [
    { AUTH_ORIGIN: 'http://student-app.example.test' },
    { AUTH_ORIGIN: O + '/' },
    { GOOGLE_CLIENT_ID: 'invalid' },
    { GOOGLE_CLIENT_SECRET: '' },
    { OAUTH_COOKIE_KEY: cookieKey + '=' },
    { OAUTH_COOKIE_KEY: 'A'.repeat(42) + 'B' },
    { OAUTH_COOKIE_KEY: 'A'.repeat(42) },
  ]) {
    const r = await request(
      '/api/auth/start',
      'POST',
      { Origin: O },
      { bindings: { ...config, ...patch } },
    );
    privacy(r);
    expect(r.status).toBe(503);
  }
  expect(await count('oauth_attempts')).toBe(before);
});

it('cleans normal GET callback credentials even when configuration or proof headers are invalid', async () => {
  const before = await count('oauth_attempts'),
    calls = exchanges;
  for (const bindings of [{}, { ...config, AUTH_ORIGIN: 'https://other.example.test' }, config]) {
    const response = await request(
      '/api/auth/callback?code=PRIVATE_CODE&state=PRIVATE_STATE',
      'GET',
      { 'X-CSRF-Token': 'legacy-proof' },
      { bindings, forbidDb: true },
    );
    privacy(response);
    expect(response.status).toBe(303);
    const destination = response.headers.get('Location')!;
    expect(destination).toBe((bindings === config ? O : '') + '/#authentication-failed');
    expect(await response.text()).toBe('');
    expect(cookies(response)).toHaveLength(0);
  }
  expect(await count('oauth_attempts')).toBe(before);
  expect(exchanges).toBe(calls);
});
it('starts distinct cryptographic purposes only through same-origin POST without reflecting payloads', async () => {
  const login = await start(),
    reg = await start(true);
  expect(login.url.origin).toBe('https://accounts.google.com');
  expect(login.url.searchParams.get('redirect_uri')).toBe(O + '/api/auth/callback');
  expect(reg.url.searchParams.get('redirect_uri')).toBe(O + '/api/auth/callback');
  expect(login.url.searchParams.get('response_mode')).toBe('form_post');
  expect(reg.url.searchParams.get('response_mode')).toBe('form_post');
  expect(login.cookie).not.toBe(reg.cookie);
  expect((await request('/api/auth/start')).status).toBe(405);
  expect(
    (await request('/api/auth/register', 'POST', { Origin: 'https://evil.example.test' })).status,
  ).toBe(400);
  expect((await request('/api/auth/start?secret=PRIVATE', 'POST', { Origin: O })).status).toBe(404);
});
it('finishes active login with clean redirect, secure separate cookies and csrf-only session inspection', async () => {
  const a = await prepare(),
    r = await callback(a, '&error_description=PRIVATE');
  clean(r);
  expect(await r.text()).toBe('');
  const session = cookies(r).find((c) => c.startsWith('__Host-kobe-session='))!;
  for (const flag of ['; Secure;', '; HttpOnly;', '; SameSite=Lax;'])
    expect(session).toContain(flag);
  for (const x of [
    'active-subject',
    'private-active',
    'st.kobedenshi',
    'PRIVATE_TOKEN',
    'synthetic-secret',
  ])
    expect(session).not.toContain(x);
  const checked = await request('/api/private/session', 'GET', {
    Cookie: session.split(';')[0] + '; ' + a.context,
  });
  privacy(checked);
  expect(checked.status).toBe(200);
  const dto = (await checked.json()) as { csrfToken: string };
  expect(Object.keys(dto)).toEqual(['csrfToken']);
  expect(dto.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const replay = await callback(a);
  clean(replay, false);
  expect(cookies(replay)).toHaveLength(0);
});
it('self-registers through one sealed callback while ordinary login never creates an account', async () => {
  const before = await count('auth_sessions'),
    reg = await prepare('new-registration', true),
    r = await callback(reg);
  clean(r);
  expect(cookies(r).filter((c) => c.startsWith('__Host-kobe-session='))).toHaveLength(1);
  const db = await mf.getD1Database('DB');
  expect(
    await db
      .prepare('SELECT status FROM private_accounts WHERE google_subject=?')
      .bind('new-registration')
      .first(),
  ).toEqual({ status: 'active' });
  expect(await count('auth_sessions')).toBe(before + 1);
  expect(
    await db
      .prepare(
        'SELECT admission_year,graduation_year FROM private_enrollment_periods e JOIN private_accounts a ON a.id=e.owner_account_id WHERE a.google_subject=?',
      )
      .bind('new-registration')
      .first(),
  ).toEqual({ admission_year: 2026, graduation_year: 2027 });
  clean(await callback(await prepare('unknown-login')));
  expect(
    await db
      .prepare('SELECT id FROM private_accounts WHERE google_subject=?')
      .bind('unknown-login')
      .first(),
  ).toBeNull();
  expect(await count('auth_sessions')).toBe(before + 1);
  const activeReg = await callback(await prepare('active-subject', true));
  clean(activeReg);
  expect(cookies(activeReg).filter((c) => c.startsWith('__Host-kobe-session='))).toHaveLength(1);
  expect(await count('auth_sessions')).toBe(before + 2);
});
it('handles denial, malformed, unmatched and wrong cookies with indistinguishable clean redirects', async () => {
  const before = exchanges,
    a = await start();
  for (const [path, matched] of [
    ['/api/auth/callback?state=PRIVATE&code=PRIVATE', false],
    [
      '/api/auth/callback?state=' +
        a.url.searchParams.get('state') +
        '&error=access_denied&error_description=PRIVATE',
      true,
    ],
  ] as const) {
    const r = matched
      ? await request(
          '/api/auth/callback',
          'POST',
          { Cookie: a.cookie, Origin: O, 'Content-Type': 'application/x-www-form-urlencoded' },
          { body: path.split('?')[1] },
        )
      : await request(path, 'GET', { Cookie: a.cookie });
    clean(r, matched);
    expect(await r.text()).toBe('');
    expect(cookies(r)).toHaveLength(0);
  }
  expect(exchanges).toBe(before);
  const r = await request('/api/auth/callback', 'POST');
  privacy(r);
  expect(r.status).toBe(400);
});
it('fails invalid nonce/domain/signature and provider failures without session or secret exposure', async () => {
  const before = await count('auth_sessions');
  for (const patch of [{ nonce: 'bad' }, { hd: 'other.example.test' }]) {
    const r = await callback(await prepare('active-subject', false, patch));
    clean(r);
    expect(cookies(r)).toHaveLength(0);
  }
  const foreign = await googleFixture(),
    a = await prepare();
  tokens.set(
    a.url.searchParams.get('state')!,
    await foreign.sign({ nonce: a.url.searchParams.get('nonce') }),
  );
  clean(await callback(a));
  refusal = true;
  try {
    const r = await callback(await prepare());
    clean(r);
    expect(cookies(r)).toHaveLength(0);
  } finally {
    refusal = false;
  }
  expect(await count('auth_sessions')).toBe(before);
});
it('allows exactly one concurrent callback exchange/session and only its winner issues a session', async () => {
  const a = await prepare(),
    before = exchanges,
    sessions = await count('auth_sessions');
  const rs = await Promise.all(Array.from({ length: 12 }, () => callback(a)));
  for (const r of rs)
    clean(
      r,
      cookies(r).some((c) => c.startsWith('__Host-kobe-session=')),
    );
  expect(exchanges - before).toBe(1);
  expect(await count('auth_sessions')).toBe(sessions + 1);
  expect(
    rs.filter((r) => cookies(r).some((c) => c.startsWith('__Host-kobe-session='))),
  ).toHaveLength(1);
});
it('revokes only the current session on confirmed CSRF logout and leaves earlier login sessions live', async () => {
  const first = await callback(await prepare()),
    second = await callback(await prepare());
  const a =
      cookies(first)
        .find((c) => c.startsWith('__Host-kobe-session='))!
        .split(';')[0] +
      '; ' +
      responseContexts.get(first),
    b =
      cookies(second)
        .find((c) => c.startsWith('__Host-kobe-session='))!
        .split(';')[0] +
      '; ' +
      responseContexts.get(second);
  const check = await request('/api/private/session', 'GET', { Cookie: b }),
    csrf = ((await check.json()) as { csrfToken: string }).csrfToken;
  expect(
    (
      await request('/api/private/logout', 'POST', {
        Cookie: b,
        Origin: O,
        'Content-Length': '0',
        Authorization: 'Bearer csrf.' + 'invalid',
      })
    ).status,
  ).toBe(401);
  const logged = await request('/api/private/logout', 'POST', {
    Cookie: b,
    Origin: O,
    'Content-Length': '0',
    Authorization: 'Bearer csrf.' + csrf,
  });
  privacy(logged);
  expect(logged.status).toBe(200);
  expect(await logged.json()).toEqual({ loggedOut: true });
  expect(cookies(logged)).toEqual([]);
  expect((await request('/api/private/session', 'GET', { Cookie: b })).status).toBe(401);
  expect((await request('/api/private/session', 'GET', { Cookie: a })).status).toBe(200);
});
it('rejects wrong origins and noncanonical routes without parsing secret config into responses', async () => {
  for (const p of [
    '/api/auth/callback/',
    '/api/auth/other',
    '/api/private/session?secret=PRIVATE',
  ]) {
    const r = await request(p);
    privacy(r);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain('PRIVATE');
  }
  const r = await request(
    '/api/auth/start',
    'POST',
    { Origin: O },
    { url: 'https://other.example.test/api/auth/start' },
  );
  expect(r.status).toBe(404);
});

async function stageReturn(a: Awaited<ReturnType<typeof start>>, suffix = '') {
  const state = a.url.searchParams.get('state')!;
  return request(
    '/api/auth/callback',
    'POST',
    {
      Origin: 'https://accounts.google.com',
      'Sec-Fetch-Site': 'cross-site',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    {
      forbidDb: true,
      body:
        new URLSearchParams({ state, code: state, iss: 'https://accounts.google.com' }).toString() +
        suffix,
    },
  );
}

it('stages an untrusted Google form POST without DB/provider authority, then registers only with original Lax proofs', async () => {
  const a = await prepare('form-post-student', true),
    accounts = await count('private_accounts'),
    sessions = await count('auth_sessions'),
    before = exchanges;
  const staged = await stageReturn(a, '&extra1=extension&scope=x&scope=y');
  privacy(staged);
  expect(staged.status).toBe(303);
  expect(staged.headers.get('Location')).toBe(O + '/api/auth/callback/complete#');
  expect(await staged.text()).toBe('');
  expect(cookies(staged)).toHaveLength(1);
  const carrier = cookies(staged)[0];
  expect(carrier).toMatch(/^__Host-kobe-oauth-return=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=60'])
    expect(carrier).toContain(flag);
  expect(carrier.length).toBeLessThanOrEqual(3800);
  expect(exchanges).toBe(before);
  expect(await count('private_accounts')).toBe(accounts);
  expect(await count('auth_sessions')).toBe(sessions);
  const cookie = carrier.split(';')[0],
    other = await start();
  for (const original of [
    '',
    a.context,
    a.cookie.split(';')[0],
    a.cookie.split(';')[0] + '; ' + other.context,
  ]) {
    const failed = await request('/api/auth/callback/complete', 'GET', {
      Cookie: cookie + '; ' + original,
    });
    expect(failed.headers.get('Location')).toBe(O + '/#authentication-failed');
    expect(cookies(failed)).toEqual([]);
  }
  expect(exchanges).toBe(before);
  expect(await count('private_accounts')).toBe(accounts);
  const completed = await request('/api/auth/callback/complete', 'GET', {
    Cookie: cookie + '; ' + a.cookie,
  });
  expect(completed.headers.get('Location')).toBe(O + '/#');
  expect(cookies(completed)).toHaveLength(1);
  expect(cookies(completed)[0]).toMatch(/^__Host-kobe-session=/);
  expect(await count('private_accounts')).toBe(accounts + 1);
  expect(await count('auth_sessions')).toBe(sessions + 1);
  expect(exchanges).toBe(before + 1);
  const db = await mf.getD1Database('DB');
  expect(
    await db
      .prepare(
        'SELECT admission_year,graduation_year FROM private_enrollment_periods e JOIN private_accounts a ON a.id=e.owner_account_id WHERE a.google_subject=?',
      )
      .bind('form-post-student')
      .first(),
  ).toEqual({ admission_year: 2026, graduation_year: 2027 });
  const replay = await request('/api/auth/callback/complete', 'GET', {
    Cookie: cookie + '; ' + a.cookie,
  });
  expect(replay.headers.get('Location')).toBe(O + '/#authentication-failed');
  expect(cookies(replay)).toEqual([]);
  expect(exchanges).toBe(before + 1);
});

it('rejects malformed, expired, tampered and ambiguous return envelopes without claims or cookie clears', async () => {
  const a = await prepare(),
    staged = await stageReturn(a),
    carrier = cookies(staged)[0].split(';')[0],
    Cookie = carrier + '; ' + a.cookie,
    before = exchanges;
  for (const [path, header, extra] of [
    ['/api/auth/callback/complete?code=ignored', Cookie, {}],
    ['/api/auth/callback/complete?', Cookie, {}],
    ['/api/auth/callback/complete#', Cookie, {}],
    ['/api/auth/callback/complete#ignored', Cookie, {}],
    ['/api/auth/callback/complete', carrier + 'x; ' + a.cookie, {}],
    ['/api/auth/callback/complete', carrier + '; ' + carrier + '; ' + a.cookie, {}],
    ['/api/auth/callback/complete', Cookie, { now: NOW + 61000 }],
    ['/api/auth/callback/complete', a.cookie, {}],
  ] as const) {
    const failed = await request(path, 'GET', { Cookie: header }, { forbidDb: true, ...extra });
    expect(failed.status).toBe(303);
    expect(failed.headers.get('Location')).toBe(O + '/#authentication-failed');
    expect(cookies(failed)).toEqual([]);
  }
  expect(exchanges).toBe(before);
  const completed = await request('/api/auth/callback/complete', 'GET', { Cookie });
  expect(cookies(completed)).toHaveLength(1);
  expect(exchanges).toBe(before + 1);
});

it('pins the provider Origin exception to callback POST and rejects critical duplicates before staging', async () => {
  const a = await prepare(),
    state = a.url.searchParams.get('state')!,
    before = exchanges;
  for (const Origin of [
    'https://accounts.google.com.evil.test',
    'https://accounts.google.com/',
    'null',
    '',
  ]) {
    const failed = await request(
      '/api/auth/callback',
      'POST',
      { Origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      { forbidDb: true, body: new URLSearchParams({ state, code: state }).toString() },
    );
    expect(failed.status).toBe(400);
    expect(cookies(failed)).toEqual([]);
  }
  for (const suffix of [
    '&code=duplicate',
    '&%73tate=' + state,
    '&iss=https%3A%2F%2Fevil.test',
    '&error=access_denied',
    '&extra=' + 'x'.repeat(1025),
  ]) {
    const failed = await stageReturn(a, suffix);
    expect(failed.status).toBe(400);
    expect(cookies(failed)).toEqual([]);
  }
  for (const path of [
    '/api/auth/start',
    '/api/auth/register',
    '/api/auth/bootstrap',
    '/api/auth/command?action=login',
    '/api/private/logout',
  ]) {
    const failed = await request(
      path,
      'POST',
      { Origin: 'https://accounts.google.com' },
      { forbidDb: true },
    );
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(cookies(failed)).toEqual([]);
  }
  expect(exchanges).toBe(before);
  expect(cookies(await callback(a))).toHaveLength(1);
});

it('ignores any stale return cookie on the bare receiver and original same-origin fragment POST', async () => {
  const old = await prepare(),
    carrier = cookies(await stageReturn(old))[0].split(';')[0],
    current = await prepare(),
    state = current.url.searchParams.get('state')!,
    Cookie = current.cookie + '; ' + carrier;
  const shell = await request('/api/auth/callback', 'GET', { Cookie }, { forbidDb: true });
  expect(shell.status).toBe(200);
  expect(cookies(shell)).toEqual([]);
  const completed = await request(
    '/api/auth/callback',
    'POST',
    { Cookie, Origin: O, 'Content-Type': 'application/x-www-form-urlencoded' },
    { body: new URLSearchParams({ state, code: state }).toString() },
  );
  expect(cookies(completed)).toHaveLength(1);
  expect(cookies(completed)[0]).toMatch(/^__Host-kobe-session=/);
});
