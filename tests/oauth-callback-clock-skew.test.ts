import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { BrowserSessionCoordinator, type BrowserClaim } from '../worker/auth/browser-session';
import { BrowserOAuthFlow } from '../worker/auth/browser-flow';
import { SESSION_CLOCK_SKEW_MS, SessionStore } from '../worker/auth/sessions';
import { SelfRegistrationStore } from '../worker/auth/self-registration';
import { PendingRegistrationStore } from '../worker/auth/pending-registration';
import { proofAuthorization } from '../src/shared/auth-proof';

// #282: the start request (attempt + context rows, sealed cookie iat) may run on an isolate whose
// clock is ahead of the isolate that receives the Google callback. The callback must tolerate
// exactly SESSION_CLOCK_SKEW_MS; expiry, one-time consumption, generation and fence stay strict.
const O = 'https://skew.example.invalid',
  NOW = 1800000000000,
  SKEW = SESSION_CLOCK_SKEW_MS,
  years = { admissionYear: 2026, graduationYear: 2028 },
  instances: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((m) => m.dispose()));
});
type Path = 'login' | 'self-registration' | 'pending-registration';
const paths: Path[] = ['login', 'self-registration', 'pending-registration'];
const identity = (subject: string) => ({
  provider: 'google' as const,
  subject,
  email: subject + '@st.kobedenshi.ac.jp',
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
    '0016_self_declared_enrollment.sql',
    '0017_self_registration.sql',
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
  await db
    .prepare(
      "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('a','skew-login','skew-login@st.kobedenshi.ac.jp','active',?)",
    )
    .bind(NOW - 600_000)
    .run();
  const clock = { now: NOW },
    tick = () => clock.now,
    flow = new BrowserOAuthFlow(
      db,
      {
        origin: O,
        clientId: 'skew.apps.googleusercontent.com',
        cookieKey: new Uint8Array(32).fill(41),
      },
      tick,
    ),
    coordinator = new BrowserSessionCoordinator(db, O, tick);
  return { db, clock, flow, coordinator, tick };
}
type T = Awaited<ReturnType<typeof setup>>;
const request = (headers: Record<string, string>, path = '/', method = 'POST', body?: string) =>
  new Request(O + path, {
    method,
    headers: { Origin: O, ...headers },
    ...(body === undefined ? {} : { body }),
  });

/** Bootstrap, issue a command and start Google sign-in, all at `at`. */
async function begin(t: T, path: Path, at: number) {
  t.clock.now = at;
  const b = (await t.coordinator.bootstrap(request({})))!,
    context = b.setCookie.split(';')[0];
  const command = (await t.coordinator.command(
    request({ Cookie: context }),
    path === 'pending-registration' ? 'pending-registration' : 'login',
  ))!;
  const h = {
    Cookie: context,
    Authorization: proofAuthorization('command', command.commandToken),
  };
  const begun =
    path === 'self-registration'
      ? await t.flow.startSelfRegistration(request(h, '/api/auth/start'), years)
      : await t.flow.start(request(h, '/api/auth/start'), path);
  if (!begun) throw Error('fixture start');
  const state = new URL(begun.location).searchParams.get('state')!;
  return {
    callback: () =>
      request(
        { Cookie: context + '; ' + begun.setCookie.split(';')[0] },
        '/api/auth/callback?state=' + state + '&code=synthetic',
        'GET',
      ),
  };
}
async function claim(t: T, path: Path, callback: Request, at: number) {
  t.clock.now = at;
  const r =
    path === 'self-registration'
      ? await t.flow.claimSelfRegistration(callback)
      : await t.flow.claim(callback, path);
  return r?.kind === 'code' ? r.proof : null;
}
async function complete(t: T, path: Path, proof: BrowserClaim, at: number, subject: string) {
  t.clock.now = at;
  if (path === 'login')
    return !!(await new SessionStore(t.db, O, t.tick).create(identity(subject), proof));
  if (path === 'self-registration')
    return !!(await new SelfRegistrationStore(t.db, t.tick).complete(identity(subject), proof));
  return !!(await new PendingRegistrationStore(t.db, t.tick).record(identity(subject), proof));
}
const subjectFor = (path: Path) => (path === 'login' ? 'skew-login' : 'skew-' + path);
const attempt = (t: T) =>
  t.db
    .prepare('SELECT created_at_ms,consumed_at_ms,claim_owner,completed_at_ms FROM oauth_attempts')
    .first<{
      created_at_ms: number;
      consumed_at_ms: number | null;
      claim_owner: string | null;
      completed_at_ms: number | null;
    }>();
const sessions = async (t: T) =>
  (await t.db.prepare('SELECT count(*) n FROM auth_sessions').first<{ n: number }>())!.n;
const accounts = async (t: T) =>
  (await t.db.prepare('SELECT count(*) n FROM private_accounts').first<{ n: number }>())!.n;

/** No account, session or receipt is made. Pending registration burns the attempt even when it
 * refuses (completed_at_ms is set unconditionally), so a refused attempt is never retried. */
async function refused(t: T, path: Path, proof: BrowserClaim, at: number) {
  const before = { sessions: await sessions(t), accounts: await accounts(t) };
  expect(await complete(t, path, proof, at, subjectFor(path))).toBe(false);
  expect({ sessions: await sessions(t), accounts: await accounts(t) }).toEqual(before);
  if (path !== 'pending-registration') expect((await attempt(t))!.completed_at_ms).toBeNull();
}
async function accepted(t: T, path: Path, proof: BrowserClaim, at: number) {
  expect(await complete(t, path, proof, at, subjectFor(path))).toBe(true);
  expect((await attempt(t))!.completed_at_ms).toBe(at);
  expect(await sessions(t)).toBe(path === 'pending-registration' ? 0 : 1);
  expect(
    await t.db
      .prepare('SELECT status FROM private_accounts WHERE google_subject=?')
      .bind(subjectFor(path))
      .first(),
  ).toEqual({ status: path === 'pending-registration' ? 'pending' : 'active' });
}

for (const path of paths) {
  it(`${path}: a callback on a clock trailing the start by SKEW completes; SKEW+1 consumes nothing (#282)`, async () => {
    // START is 999 ms into a second, so the cookie's whole-second iat accepts both callbacks below
    // and only the attempt row's created_at_ms decides.
    const START = NOW + 999;
    for (const ok of [false, true]) {
      const t = await setup(),
        { callback } = await begin(t, path, START);
      // The browser context came from an earlier visit; only the start ran on the leading clock.
      await t.db
        .prepare('UPDATE auth_browser_contexts SET created_at_ms=?')
        .bind(NOW - 60_000)
        .run();
      expect(await claim(t, path, callback(), START - SKEW - 1)).toBeNull();
      expect(await attempt(t)).toMatchObject({ consumed_at_ms: null, claim_owner: null });
      const proof = (await claim(t, path, callback(), START - SKEW))!;
      expect(proof).not.toBeNull();
      // 0003 requires consumed_at_ms >= created_at_ms, so the trailing claim is lifted to creation.
      expect(await attempt(t)).toMatchObject({ created_at_ms: START, consumed_at_ms: START });
      // One-time: the same callback cannot claim again, even from a clock that is now in sync.
      expect(await claim(t, path, callback(), START)).toBeNull();
      if (ok) await accepted(t, path, proof, START - SKEW);
      else await refused(t, path, proof, START - SKEW - 1);
    }
  });

  it(`${path}: the sealed cookie's iat alone bounds the trailing clock (#282)`, async () => {
    const t = await setup(),
      { callback } = await begin(t, path, NOW);
    // Make the rows old so only the cookie (iat = NOW/1000) can refuse the callback.
    await t.db
      .prepare('UPDATE oauth_attempts SET created_at_ms=?,expires_at_ms=?')
      .bind(NOW - 60_000, NOW + 500_000)
      .run();
    await t.db
      .prepare('UPDATE auth_browser_contexts SET created_at_ms=?')
      .bind(NOW - 60_000)
      .run();
    expect(await claim(t, path, callback(), NOW - SKEW - 1000)).toBeNull();
    expect(await attempt(t)).toMatchObject({ consumed_at_ms: null, claim_owner: null });
    expect(await claim(t, path, callback(), NOW - SKEW)).not.toBeNull();
  });

  it(`${path}: the context row written ahead of the callback is bounded separately (#282)`, async () => {
    for (const ok of [false, true]) {
      const t = await setup(),
        { callback } = await begin(t, path, NOW - 60_000);
      // The context row came from an isolate at NOW; the attempt itself is old.
      await t.db.prepare('UPDATE auth_browser_contexts SET created_at_ms=?').bind(NOW).run();
      expect(await claim(t, path, callback(), NOW - SKEW - 1)).toBeNull();
      expect(await attempt(t)).toMatchObject({ consumed_at_ms: null, claim_owner: null });
      const proof = (await claim(t, path, callback(), NOW - SKEW))!;
      expect(proof).not.toBeNull();
      expect((await attempt(t))!.consumed_at_ms).toBe(NOW - SKEW);
      if (ok) await accepted(t, path, proof, NOW - SKEW);
      else await refused(t, path, proof, NOW - SKEW - 1);
    }
  });

  it(`${path}: completion trailing its own claim by more than SKEW is refused (#282)`, async () => {
    for (const ok of [false, true]) {
      const t = await setup(),
        { callback } = await begin(t, path, NOW - 60_000);
      // Attempt and context are old; only consumed_at_ms (NOW) is ahead of the completing clock.
      const proof = (await claim(t, path, callback(), NOW))!;
      expect(proof).not.toBeNull();
      if (ok) await accepted(t, path, proof, NOW - SKEW);
      else await refused(t, path, proof, NOW - SKEW - 1);
    }
  });

  it(`${path}: expiry stays strict for the cookie, the claim and the completion (#282)`, async () => {
    // The cookie expires at NOW+600000 (whole seconds); the attempt row 999 ms later.
    const START = NOW + 999;
    {
      const t = await setup(),
        { callback } = await begin(t, path, START);
      expect(await claim(t, path, callback(), NOW + 600_000)).toBeNull();
      expect(await attempt(t)).toMatchObject({ consumed_at_ms: null, claim_owner: null });
    }
    const t = await setup(),
      { callback } = await begin(t, path, START);
    // Now let the attempt row expire before the cookie does.
    const expires = START + 1;
    await t.db.prepare('UPDATE oauth_attempts SET expires_at_ms=?').bind(expires).run();
    expect(await claim(t, path, callback(), expires)).toBeNull();
    expect(await attempt(t)).toMatchObject({ consumed_at_ms: null, claim_owner: null });
    const proof = (await claim(t, path, callback(), expires - 1))!;
    expect(proof).not.toBeNull();
    await refused(t, path, proof, expires);
  });
}

it('login: the session made on a trailing callback is usable once clocks agree (#282)', async () => {
  const t = await setup(),
    { callback } = await begin(t, 'login', NOW);
  const proof = (await claim(t, 'login', callback(), NOW - SKEW))!;
  t.clock.now = NOW - SKEW;
  const made = (await new SessionStore(t.db, O, t.tick).create(identity('skew-login'), proof))!;
  const context = callback().headers.get('Cookie')!.split('; ')[0];
  t.clock.now = NOW;
  expect(
    await new SessionStore(t.db, O, t.tick).authenticate(
      request({ Cookie: context + '; ' + made.setCookie.split(';')[0] }, '/', 'GET'),
    ),
  ).not.toBeNull();
});
