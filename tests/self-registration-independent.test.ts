import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { base64url } from 'jose';
import { googleFixture, TEST_CLIENT_ID } from './helpers/google-fixtures';

// Independent terminal-transaction QA. Fictional identity, local D1 and actual JOSE.
const ORIGIN = 'https://registration-independent.example.invalid',
  NOW = Date.now();
const bindings = {
  AUTH_ORIGIN: ORIGIN,
  GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'fictional-independent-secret',
  OAUTH_COOKIE_KEY: base64url.encode(crypto.getRandomValues(new Uint8Array(32))),
};
let mf: Miniflare, fixture: Awaited<ReturnType<typeof googleFixture>>;
const tokens = new Map<string, string>();
const db = () => mf.getD1Database('DB');
const cookies = (response: Awaited<ReturnType<typeof request>>) =>
  response.headers.getSetCookie().map((value) => value.split(';')[0]);
async function request(
  path: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string,
) {
  return mf.dispatchFetch('https://fixture.invalid', {
    method: 'POST',
    redirect: 'manual',
    body: JSON.stringify({ url: ORIGIN + path, method, headers, body, now: NOW, bindings }),
  });
}
async function start(subject: string) {
  const boot = await request('/api/auth/bootstrap', 'POST', { Origin: ORIGIN });
  expect(boot.status).toBe(204);
  const context = cookies(boot)[0];
  const command = await request('/api/auth/command?action=self-registration', 'POST', {
    Origin: ORIGIN,
    Cookie: context,
  });
  expect(command.status).toBe(200);
  const proof = ((await command.json()) as { commandToken: string }).commandToken;
  const response = await request(
    '/api/auth/register',
    'POST',
    {
      Origin: ORIGIN,
      Cookie: context,
      Authorization: 'Bearer command.' + proof,
      'Content-Type': 'application/json',
    },
    JSON.stringify({ admissionYear: 2026, graduationYear: 2028 }),
  );
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get('Location')!),
    state = location.searchParams.get('state')!;
  tokens.set(
    state,
    await fixture.sign({
      sub: subject,
      email: subject + '@st.kobedenshi.ac.jp',
      nonce: location.searchParams.get('nonce'),
    }),
  );
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
  return { state, hash, cookie: [...cookies(response), context].join('; ') };
}
async function finish(attempt: Awaited<ReturnType<typeof start>>) {
  const response = await request(
    '/api/auth/callback?state=' + attempt.state + '&code=' + attempt.state,
    'GET',
    { Cookie: attempt.cookie },
  );
  expect(response.status).toBe(303);
  return cookies(response).some((value) => value.startsWith('__Host-kobe-session='));
}
async function seed(subject: string, status = 'pending', epoch = 3) {
  await (
    await db()
  )
    .prepare(
      'INSERT INTO private_accounts(id,google_subject,email,status,session_epoch,created_at_ms) VALUES(?,?,?,?,?,?)',
    )
    .bind(subject, subject, subject + '@st.kobedenshi.ac.jp', status, epoch, NOW)
    .run();
}
async function snapshot(subject: string) {
  const database = await db();
  return {
    account: await database
      .prepare('SELECT * FROM private_accounts WHERE google_subject=?')
      .bind(subject)
      .first(),
    period: await database
      .prepare('SELECT * FROM private_enrollment_periods WHERE owner_account_id=?')
      .bind(subject)
      .first(),
    fence: await database.prepare('SELECT * FROM auth_revocation_fence').first(),
    subjectFloor: await database
      .prepare('SELECT * FROM auth_subject_fences WHERE google_subject=?')
      .bind(subject)
      .first(),
    sessions: (
      await database.prepare('SELECT * FROM auth_sessions WHERE account_id=?').bind(subject).all()
    ).results,
    receipts: (
      await database
        .prepare('SELECT * FROM auth_self_registration_commits WHERE account_id=?')
        .bind(subject)
        .all()
    ).results,
  };
}

beforeAll(async () => {
  fixture = await googleFixture();
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/self-registration-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: async (request) => {
        if (request.url === 'https://www.googleapis.com/oauth2/v3/certs')
          return Response.json(fixture.jwks);
        expect(request.url).toBe('https://oauth2.googleapis.com/token');
        const form = new URLSearchParams(await request.text());
        return Response.json({ id_token: tokens.get(form.get('code')!) });
      },
    }),
  );
  const database = await db();
  for (const file of [
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0012_browser_session_order.sql',
    '0016_self_declared_enrollment.sql',
    '0017_self_registration.sql',
  ]) {
    const source = readFileSync('migrations/' + file, 'utf8');
    const parts = source.includes('-- @statement')
      ? source.split(/^-- @statement\s*$/m)
      : source.replace(/^--.*$/gm, '').split(/;\s*(?:\n|$)/);
    for (const sql of parts.map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean))
      await database.prepare(sql).run();
  }
});
afterAll(async () => {
  await mf?.dispose();
});

it.each(['account', 'receipt', 'activation', 'period', 'session', 'completion'] as const)(
  'rolls back every terminal effect when %s silently ignores its write',
  async (stage) => {
    const subject = 'ignore-' + stage,
      database = await db();
    if (stage !== 'account') await seed(subject);
    const attempt = await start(subject),
      before = await snapshot(subject);
    const trigger = {
      account: `BEFORE INSERT ON private_accounts WHEN NEW.google_subject='${subject}'`,
      receipt: `BEFORE INSERT ON auth_self_registration_commits WHEN NEW.account_id='${subject}'`,
      activation: `BEFORE UPDATE OF status ON private_accounts WHEN NEW.id='${subject}' AND NEW.status='active'`,
      period: `BEFORE INSERT ON private_enrollment_periods WHEN NEW.owner_account_id='${subject}'`,
      session: `BEFORE INSERT ON auth_sessions WHEN NEW.account_id='${subject}'`,
      completion: `BEFORE UPDATE OF completed_at_ms ON oauth_attempts WHEN NEW.state_hash='${attempt.hash}'`,
    }[stage];
    await database
      .prepare('CREATE TRIGGER independent_ignore ' + trigger + ' BEGIN SELECT RAISE(IGNORE); END')
      .run();
    try {
      expect(await finish(attempt)).toBe(false);
      expect(await snapshot(subject)).toEqual(before);
      expect(
        await database
          .prepare('SELECT consumed_at_ms,completed_at_ms FROM oauth_attempts WHERE state_hash=?')
          .bind(attempt.hash)
          .first(),
      ).toEqual({ consumed_at_ms: NOW, completed_at_ms: null });
      expect(
        await database
          .prepare('SELECT count(*) n FROM auth_self_registration_commits WHERE state_hash=?')
          .bind(attempt.hash)
          .first(),
      ).toEqual({ n: 0 });
    } finally {
      await database.prepare('DROP TRIGGER independent_ignore').run();
    }
    // The provider claim stays one-time even though the terminal transaction rolled back.
    expect(await finish(attempt)).toBe(false);
    expect(await snapshot(subject)).toEqual(before);
  },
);

it.each(['epoch', 'status-cycle', 'delete-recreate'] as const)(
  'cannot promote an old attempt after a %s revocation',
  async (reason) => {
    const subject = 'revoked-' + reason,
      database = await db();
    await seed(subject);
    const attempt = await start(subject);
    if (reason === 'epoch')
      await database
        .prepare('UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id=?')
        .bind(subject)
        .run();
    if (reason === 'status-cycle') {
      await database
        .prepare("UPDATE private_accounts SET status='suspended' WHERE id=?")
        .bind(subject)
        .run();
      await database
        .prepare("UPDATE private_accounts SET status='pending' WHERE id=?")
        .bind(subject)
        .run();
    }
    if (reason === 'delete-recreate') {
      await database.prepare('DELETE FROM private_accounts WHERE id=?').bind(subject).run();
      await seed(subject);
    }
    const before = await snapshot(subject);
    expect(await finish(attempt)).toBe(false);
    expect(await snapshot(subject)).toEqual(before);
    expect(
      await database
        .prepare('SELECT completed_at_ms FROM oauth_attempts WHERE state_hash=?')
        .bind(attempt.hash)
        .first(),
    ).toEqual({ completed_at_ms: null });
  },
);

it('accepts an unaffected subject after an unrelated epoch fence moves', async () => {
  const subject = 'unrelated-fence',
    database = await db();
  await seed(subject, 'active', 7);
  const attempt = await start(subject);
  await seed('other-subject');
  await database
    .prepare("UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id='other-subject'")
    .run();
  const account = await database
    .prepare('SELECT * FROM private_accounts WHERE id=?')
    .bind(subject)
    .first();
  expect(await finish(attempt)).toBe(true);
  expect(
    await database.prepare('SELECT * FROM private_accounts WHERE id=?').bind(subject).first(),
  ).toEqual(account);
  expect(
    await database
      .prepare('SELECT count(*) n FROM auth_sessions WHERE account_id=?')
      .bind(subject)
      .first(),
  ).toEqual({ n: 1 });
});

it('fails before a terminal write after original declaration disappears', async () => {
  const subject = 'lost-declaration',
    database = await db(),
    attempt = await start(subject);
  await database
    .prepare('DELETE FROM auth_self_registration_attempts WHERE state_hash=?')
    .bind(attempt.hash)
    .run();
  expect(await finish(attempt)).toBe(false);
  expect(
    await database
      .prepare('SELECT * FROM private_accounts WHERE google_subject=?')
      .bind(subject)
      .first(),
  ).toBeNull();
  expect(
    await database
      .prepare('SELECT completed_at_ms FROM oauth_attempts WHERE state_hash=?')
      .bind(attempt.hash)
      .first(),
  ).toEqual({ completed_at_ms: null });
});
