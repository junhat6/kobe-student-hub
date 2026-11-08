import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import type { OwnEnrollmentResult } from '../src/shared/enrollment';
const ORIGIN = 'https://enrollment.example.invalid',
  NOW = 1800000000000;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare, users: Session[];
const value = { admissionYear: 2026, graduationYear: 2027, expectedVersion: 0 };
const headers = (session: Session) => ({
  Cookie: [session.setCookie, session.contextCookie]
    .map((cookie) => cookie.split(';')[0])
    .join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + session.csrfToken,
  'Content-Type': 'application/json',
});
async function session(who: number, now = NOW) {
  return (await (
    await mf.dispatchFetch(ORIGIN + '/fixture/session', {
      headers: { 'X-Test-Who': String(who), 'X-Test-Now': String(now) },
    })
  ).json()) as Session;
}
async function store(
  action: string,
  n = 0,
  input: unknown = value,
  extra: Record<string, string> = {},
  method?: string,
) {
  return (await (
    await mf.dispatchFetch(ORIGIN + '/fixture/store', {
      method: 'POST',
      headers: extra,
      body: JSON.stringify({ action, input, method, headers: headers(users[n]) }),
    })
  ).json()) as OwnEnrollmentResult | null;
}
async function request(
  method = 'GET',
  n = 0,
  input?: unknown,
  extra: Record<string, string | undefined> = {},
  path = '/api/private/enrollment',
) {
  const requestHeaders: Record<string, string> = { ...headers(users[n]) };
  for (const [key, header] of Object.entries(extra))
    if (header !== undefined) requestHeaders[key] = header;
  const response = await mf.dispatchFetch(ORIGIN + path, {
    method,
    headers: requestHeaders,
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  for (const [key, v] of Object.entries({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Type': 'application/json; charset=utf-8',
  }))
    expect(response.headers.get(key)).toBe(v);
  for (const key of ['Set-Cookie', 'Location', 'Access-Control-Allow-Origin'])
    expect(response.headers.has(key)).toBe(false);
  return response;
}
async function rows() {
  return (
    await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT * FROM private_enrollment_periods ORDER BY owner_account_id')
      .all()
  ).results;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/enrollment-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of [
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0012_browser_session_order.sql',
    '0016_self_declared_enrollment.sql',
  ]) {
    const text = readFileSync('migrations/' + file, 'utf8');
    const statements = text
      .split(text.includes('-- @statement') ? /^-- @statement\s*$/m : /;\s*(?:\n|$)/)
      .map((sql) => sql.replace(/^--.*$/gm, '').trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  for (let n = 0; n < 16; n++)
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
  users = await Promise.all(Array.from({ length: 16 }, (_, n) => session(n)));
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
describe('private self-declared enrollment D1 and HTTP boundary', () => {
  it('keeps legacy active accounts missing and returns only own minimal projection', async () => {
    expect(await store('get')).toEqual({ enrollment: null, participation: 'missing' });
    const response = await request('PUT', 0, value);
    expect(response.status).toBe(200);
    const expected = {
      enrollment: { admissionYear: 2026, graduationYear: 2027, version: 1, updatedAtMs: NOW },
      participation: 'current',
    };
    expect(await response.json()).toEqual(expected);
    expect(await store('get')).toEqual(expected);
    expect(await store('get', 1)).toEqual({ enrollment: null, participation: 'missing' });
    for (const marker of [
      'account-0',
      'subject-0',
      'st.kobedenshi',
      'startsAtMs',
      'endsAtMs',
      'policyVersion',
      'tokenHash',
    ])
      expect(JSON.stringify(await store('get'))).not.toContain(marker);
  });
  it('requires exact CAS and allows one winner among concurrent initial saves and corrections', async () => {
    const initial = await Promise.all(Array.from({ length: 12 }, () => store('save', 1)));
    expect(initial.filter(Boolean)).toHaveLength(1);
    expect(await store('save', 1)).toBeNull();
    const corrections = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        store('save', 1, { ...value, graduationYear: 2028 + i, expectedVersion: 1 }),
      ),
    );
    expect(corrections.filter(Boolean)).toHaveLength(1);
    expect(corrections.find(Boolean)!.enrollment!.version).toBe(2);
    expect(await store('save', 1, { ...value, expectedVersion: 1 })).toBeNull();
    expect((await store('get', 1))!.enrollment!.version).toBe(2);
    expect((await rows()).filter((row) => row.owner_account_id === 'account-1')).toHaveLength(1);
  });
  it('supports ended/upcoming read and self-correction without approving or modifying public data', async () => {
    expect(
      await store('save', 2, { admissionYear: 2024, graduationYear: 2024, expectedVersion: 0 }),
    ).toMatchObject({ participation: 'ended' });
    expect(await store('get', 2)).toMatchObject({ participation: 'ended' });
    expect(
      await store('save', 2, { admissionYear: 2024, graduationYear: 2028, expectedVersion: 1 }),
    ).toEqual({
      enrollment: { admissionYear: 2024, graduationYear: 2028, version: 2, updatedAtMs: NOW },
      participation: 'current',
    });
    expect(
      await store('save', 3, { admissionYear: 2029, graduationYear: 2029, expectedVersion: 0 }),
    ).toMatchObject({ participation: 'upcoming' });
    expect(await store('get', 3)).toMatchObject({ participation: 'upcoming' });
    const db = await mf.getD1Database('DB');
    expect(
      await db
        .prepare("SELECT status,session_epoch FROM private_accounts WHERE id='account-2'")
        .first(),
    ).toEqual({ status: 'active', session_epoch: 0 });
  });
  it('rejects identity injection, unbounded/noninteger years, stale/invalid versions and wrong methods', async () => {
    const before = await rows();
    for (const input of [
      null,
      [],
      {},
      { ...value, admissionYear: '2026' },
      { ...value, graduationYear: 2025 },
      { ...value, graduationYear: 2200 },
      { ...value, admissionYear: 1899 },
      { ...value, graduationYear: 2027.1 },
      { ...value, expectedVersion: -1 },
      { ...value, expectedVersion: 1.5 },
      { ...value, expectedVersion: Number.MAX_SAFE_INTEGER },
      { ...value, expectedVersion: '0' },
      { ...value, owner_account_id: 'account-0' },
      { ...value, email: 'private@example.invalid' },
      { ...value, participation: 'current' },
      { ...value, policyVersion: 1 },
    ])
      expect(await store('save', 4, input)).toBeNull();
    expect(await store('save', 4, value, {}, 'POST')).toBeNull();
    expect(await store('get', 4, undefined, {}, 'PUT')).toBeNull();
    expect(await rows()).toEqual(before);
    expect((await request('PUT', 4, { ...value, owner_account_id: 'account-0' })).status).toBe(400);
  });
  it('rolls back ABORT/IGNORE mutations and after-write authority changes without acknowledging replay', async () => {
    const db = await mf.getD1Database('DB');
    for (const mode of ['ABORT', 'IGNORE']) {
      const before = await rows();
      await db
        .prepare(
          `CREATE TRIGGER fixture_enrollment_failure BEFORE INSERT ON private_enrollment_periods BEGIN SELECT RAISE(${mode}${mode === 'ABORT' ? ",'fixture failure'" : ''}); END`,
        )
        .run();
      try {
        expect(await store('save', 5)).toBeNull();
        expect(await rows()).toEqual(before);
      } finally {
        await db.prepare('DROP TRIGGER fixture_enrollment_failure').run();
      }
    }
    await db
      .prepare(
        'CREATE TRIGGER fixture_enrollment_epoch AFTER INSERT ON private_enrollment_periods BEGIN UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id=NEW.owner_account_id; END',
      )
      .run();
    try {
      const before = await rows();
      expect(await store('save', 5)).toBeNull();
      expect(await rows()).toEqual(before);
      expect(
        await db.prepare("SELECT session_epoch FROM private_accounts WHERE id='account-5'").first(),
      ).toEqual({ session_epoch: 0 });
    } finally {
      await db.prepare('DROP TRIGGER fixture_enrollment_epoch').run();
    }
    expect(await store('save', 5)).not.toBeNull();
    await db
      .prepare(
        'CREATE TRIGGER fixture_enrollment_ignore BEFORE UPDATE ON private_enrollment_periods BEGIN SELECT RAISE(IGNORE); END',
      )
      .run();
    try {
      const before = await rows();
      expect(await store('save', 5, { ...value, expectedVersion: 1 })).toBeNull();
      expect(await rows()).toEqual(before);
    } finally {
      await db.prepare('DROP TRIGGER fixture_enrollment_ignore').run();
    }
  });
  it('resamples final session authority for both reads and writes after preflight', async () => {
    const db = await mf.getD1Database('DB');
    for (const race of ['revoke', 'status', 'epoch', 'context']) {
      users[6] = await session(6);
      const before = await rows();
      expect(await store('save', 6, value, { 'X-Test-Race': race })).toBeNull();
      expect(await rows()).toEqual(before);
      await db.prepare("UPDATE private_accounts SET status='active' WHERE id='account-6'").run();
    }
    users[6] = await session(6);
    expect(await store('save', 6)).not.toBeNull();
    users[6] = await session(6);
    expect(await store('get', 6, undefined, { 'X-Test-Race': 'context' })).toBeNull();
  });
  it('checks actual stored window consistency and cascades only its own private declaration on account deletion', async () => {
    const db = await mf.getD1Database('DB');
    expect(
      await store('save', 7, { ...value, admissionYear: 1900, graduationYear: 2199 }),
    ).not.toBeNull();
    for (const sql of [
      'starts_at_ms=starts_at_ms+1',
      'ends_at_ms=ends_at_ms-1',
      'policy_version=2',
      'admission_year=1900.5',
      'graduation_year=1899',
      'version=0',
      'updated_at_ms=-1',
    ])
      await expect(
        db
          .prepare(
            'UPDATE private_enrollment_periods SET ' + sql + " WHERE owner_account_id='account-7'",
          )
          .run(),
      ).rejects.toThrow();
    await db.prepare("DELETE FROM private_accounts WHERE id='account-7'").run();
    expect((await rows()).some((row) => row.owner_account_id === 'account-7')).toBe(false);
    expect((await rows()).some((row) => row.owner_account_id === 'account-0')).toBe(true);
  });
  it('authenticates before body parsing and requires cookies, same origin and real CSRF', async () => {
    const before = await rows();
    for (const extra of [
      { Cookie: '' },
      { Origin: 'https://evil.invalid' },
      { Authorization: 'Bearer csrf.' + users[0].csrfToken },
      { 'Sec-Fetch-Site': 'cross-site' },
    ])
      expect((await request('PUT', 8, value, extra)).status).toBe(401);
    const began = Date.now();
    expect((await request('PUT', 8, undefined, { Cookie: '', 'X-Test-Body': 'late' })).status).toBe(
      401,
    );
    expect(Date.now() - began).toBeLessThan(1000);
    expect(
      (await request('GET', 8, undefined, { 'X-Test-Now': String(NOW + 1800000) })).status,
    ).toBe(401);
    expect(await rows()).toEqual(before);
  });
  it('rejects malformed/bounded transport, query paths, unsupported methods and invalid origin', async () => {
    for (const extra of [
      { 'Content-Type': 'text/plain' },
      { 'Content-Type': 'application/json; charset=latin1' },
      { 'Content-Encoding': 'gzip' },
    ])
      expect((await request('PUT', 9, value, extra)).status).toBe(415);
    for (const extra of [
      { 'X-Test-Body': 'utf8' },
      { 'X-Test-Length': 'invalid' },
      { 'X-Test-Length': '1' },
    ])
      expect((await request('PUT', 9, value, extra)).status).toBe(400);
    for (const extra of [
      { 'X-Test-Length': '1025' },
      { 'X-Test-Body': 'oversize' },
      { 'X-Test-Body': 'empty' },
    ])
      expect((await request('PUT', 9, undefined, extra)).status).toBe(413);
    for (const path of [
      '/api/private/enrollment/',
      '/api/private/enrollment/other',
      '/api/private/enrollment?identity=PRIVATE',
    ]) {
      const response = await request('GET', 9, undefined, {}, path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('PRIVATE');
    }
    const method = await request('POST', 9, value);
    expect(method.status).toBe(405);
    expect(method.headers.get('Allow')).toBe('GET, PUT');
    expect(
      (await request('GET', 9, undefined, { 'X-Test-Origin': 'http://invalid.example' })).status,
    ).toBe(503);
    expect((await mf.dispatchFetch(ORIGIN + '/other')).status).toBe(418);
  });
  it('bounds stalled bodies without late persistence, then accepts small valid chunks', async () => {
    const before = await rows(),
      began = Date.now();
    expect((await request('PUT', 10, undefined, { 'X-Test-Body': 'late' })).status).toBe(408);
    expect(Date.now() - began).toBeGreaterThanOrEqual(4500);
    expect(Date.now() - began).toBeLessThan(6500);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await rows()).toEqual(before);
    expect((await request('PUT', 10, undefined, { 'X-Test-Body': 'small' })).status).toBe(200);
  }, 8000);
});
