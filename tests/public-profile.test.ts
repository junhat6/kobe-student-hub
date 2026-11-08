import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import type { OwnProfileResult } from '../worker/public-profile';
const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let users: Session[];
const value = {
  displayName: ' 明示した名前 ',
  department: '本人が入力した分野',
  yearLabel: '本人が入力した学年',
  bio: '自分で確認した公開文',
  confirmPublic: true,
};
const headers = (s: Session) => ({
  Cookie: [s.setCookie, s.contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + s.csrfToken,
  'Content-Type': 'application/json',
});
async function session(who: number) {
  return (await (
    await mf.dispatchFetch(ORIGIN + '/fixture/session', { headers: { 'X-Test-Who': String(who) } })
  ).json()) as Session;
}
async function store(
  action: string,
  n = 0,
  input: unknown = value,
  extra: Record<string, string> = {},
) {
  return (await (
    await mf.dispatchFetch(ORIGIN + '/fixture/store', {
      method: 'POST',
      headers: extra,
      body: JSON.stringify({ action, input, headers: headers(users[n]) }),
    })
  ).json()) as OwnProfileResult | null;
}
async function request(
  method = 'GET',
  n = 0,
  input?: unknown,
  extra: Record<string, string | undefined> = {},
  path = '/api/private/profile',
) {
  const r = await mf.dispatchFetch(ORIGIN + path, {
    method,
    headers: { ...headers(users[n]), ...extra } as Record<string, string>,
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  for (const [k, v] of Object.entries({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Type': 'application/json; charset=utf-8',
  }))
    expect(r.headers.get(k)).toBe(v);
  for (const k of ['Set-Cookie', 'Location', 'Access-Control-Allow-Origin'])
    expect(r.headers.has(k)).toBe(false);
  return r;
}
async function counts() {
  const db = await mf.getD1Database('DB');
  return {
    profiles: (await db
      .prepare('SELECT count(*) n FROM public_profiles WHERE is_sample=0')
      .first<{ n: number }>())!.n,
    mappings: (await db
      .prepare('SELECT count(*) n FROM account_public_profiles')
      .first<{ n: number }>())!.n,
  };
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/profile-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of [
    '0001_discovery.sql',
    '0002_sample_content.sql',
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0005_private_article_drafts.sql',
    '0006_article_reports.sql',
    '0007_article_publications.sql',
  ])
    for (const sql of readFileSync('migrations/' + file, 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?:\n|$)/)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  for (let n = 0; n < 20; n++)
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
  users = await Promise.all(Array.from({ length: 20 }, (_, n) => session(n)));
});
afterAll(async () => {
  await mf?.dispose();
});
describe('explicit first public profile creation with private HTTP boundary', () => {
  it('starts absent, creates only explicitly entered fields, and privately reads own DTO', async () => {
    expect(await store('get')).toEqual({ profile: null });
    expect(await (await request()).json()).toEqual({ profile: null });
    const r = await request('POST', 0, value);
    expect(r.status).toBe(201);
    const created = (await r.json()) as OwnProfileResult;
    expect(created).toEqual({
      profile: {
        id: expect.stringMatching(/^profile-[0-9a-f-]{36}$/),
        displayName: value.displayName,
        department: value.department,
        yearLabel: value.yearLabel,
        bio: value.bio,
        initials: '明',
      },
    });
    expect(await store('get')).toEqual(created);
    expect(await store('get', 1)).toEqual({ profile: null });
    for (const marker of ['subject-0', 'account-0', 'st.kobedenshi', 'tokenHash'])
      expect(JSON.stringify(created)).not.toContain(marker);
    expect(await store('create')).toEqual(created);
    expect(await store('create', 0, { ...value, bio: 'different' })).toBeNull();
    expect(await store('get')).toEqual(created);
  });
  it('has one atomic winner for12 concurrent requests and accepts identical retries only', async () => {
    const before = await counts();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        store('create', 1, { displayName: '😀 first', confirmPublic: true }),
      ),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(new Set(results.map((r) => r!.profile!.id)).size).toBe(1);
    expect(results[0]!.profile).toMatchObject({
      displayName: '😀 first',
      department: '',
      yearLabel: '',
      bio: '',
      initials: '😀',
    });
    expect(await counts()).toEqual({
      profiles: before.profiles + 1,
      mappings: before.mappings + 1,
    });
    expect(
      await store('create', 1, {
        displayName: '😀 first',
        department: '',
        yearLabel: '',
        bio: '',
        confirmPublic: true,
      }),
    ).toEqual(results[0]);
    expect(await store('create', 1, { displayName: 'other', confirmPublic: true })).toBeNull();
  });
  it('rolls back both rows for profile or mapping ABORT/IGNORE failures', async () => {
    const db = await mf.getD1Database('DB');
    let user = 2;
    for (const table of ['public_profiles', 'account_public_profiles'])
      for (const mode of ['ABORT', 'IGNORE']) {
        const before = await counts();
        await db
          .prepare(
            `CREATE TRIGGER fixture_profile_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(${mode}${mode === 'ABORT' ? ",'fixture failure'" : ''}); END`,
          )
          .run();
        try {
          expect(await store('create', user)).toBeNull();
          expect(await counts()).toEqual(before);
          expect(await store('get', user)).toEqual({ profile: null });
        } finally {
          await db.prepare('DROP TRIGGER fixture_profile_failure').run();
        }
        user++;
      }
  });
  it('rolls back mutated profile metadata and after-mapping epoch changes in the batch', async () => {
    const db = await mf.getD1Database('DB');
    for (const mutation of [
      "UPDATE public_profiles SET bio='mutated' WHERE id=NEW.public_profile_id",
      'UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id=NEW.owner_account_id',
    ]) {
      const before = await counts();
      await db
        .prepare(
          `CREATE TRIGGER fixture_profile_mutation AFTER INSERT ON account_public_profiles BEGIN ${mutation}; END`,
        )
        .run();
      try {
        expect(await store('create', 6)).toBeNull();
        expect(await counts()).toEqual(before);
      } finally {
        await db.prepare('DROP TRIGGER fixture_profile_mutation').run();
      }
    }
  });
  it('rejects client identity/privilege, malformed input, Unicode overflow and invalid UTF16', async () => {
    for (const input of [
      null,
      [],
      {},
      { displayName: '', confirmPublic: true },
      { displayName: '　', confirmPublic: true },
      { ...value, confirmPublic: false },
      { ...value, displayName: '😀'.repeat(81) },
      { ...value, department: 'x'.repeat(81) },
      { ...value, yearLabel: 'x'.repeat(33) },
      { ...value, bio: '😀'.repeat(801) },
      { ...value, bio: 'bad\u0000text' },
      { ...value, displayName: '\ud800' },
      { ...value, owner_account_id: 'account-0' },
      { ...value, id: 'profile-client' },
      { ...value, is_sample: 0 },
      { ...value, initials: 'X' },
      { ...value, email: 'x@example.invalid' },
      { ...value, photo: 'https://example.invalid/private' },
    ])
      expect(await store('create', 7, input)).toBeNull();
    expect(await store('get', 7)).toEqual({ profile: null });
    expect(
      await store('create', 7, {
        displayName: '😀'.repeat(80),
        department: '界'.repeat(80),
        yearLabel: '学'.repeat(32),
        bio: '😀'.repeat(800),
        confirmPublic: true,
      }),
    ).not.toBeNull();
  });
  it('never exposes private IDs or malformed legacy mapped profiles and enforces unique ownership', async () => {
    const db = await mf.getD1Database('DB');
    const own = (await store('get', 0))!.profile!;
    await expect(
      db.prepare('INSERT INTO account_public_profiles VALUES(?,?)').bind('account-8', own.id).run(),
    ).rejects.toThrow();
    for (const id of ['account-8', 'subject-8', 'invalid\u0000suffix', 'bad.profile']) {
      await db
        .prepare("INSERT INTO public_profiles VALUES(?,'manual','','','','',0)")
        .bind(id)
        .run();
      await db
        .prepare('INSERT INTO account_public_profiles VALUES(?,?)')
        .bind('account-8', id)
        .run();
      expect(await store('get', 8)).toBeNull();
      expect(await store('create', 8)).toBeNull();
      await db
        .prepare("DELETE FROM account_public_profiles WHERE owner_account_id='account-8'")
        .run();
    }
    expect(await store('get', 8)).toEqual({ profile: null });
  });
  it('authenticates before HTTP parsing and requires real cookies, CSRF and Origin', async () => {
    for (const h of [
      { Cookie: '' },
      { Origin: 'https://evil.invalid' },
      { Authorization: 'Bearer csrf.' + users[0].csrfToken },
      { 'Sec-Fetch-Site': 'cross-site' },
    ])
      expect((await request('POST', 9, value, h)).status).toBe(401);
    const began = Date.now();
    expect(
      (await request('POST', 9, undefined, { Cookie: '', 'X-Test-Body': 'late' })).status,
    ).toBe(401);
    expect(Date.now() - began).toBeLessThan(1000);
    expect(
      (await request('GET', 9, undefined, { 'X-Test-Now': String(NOW + 1800000) })).status,
    ).toBe(401);
  });
  it('emits private errors for invalid transport, paths, methods and configuration', async () => {
    for (const extra of [
      { 'Content-Type': 'text/plain' },
      { 'Content-Type': 'application/json; charset=latin1' },
      { 'Content-Encoding': 'gzip' },
    ])
      expect((await request('POST', 9, {}, extra)).status).toBe(415);
    for (const extra of [
      { 'X-Test-Body': 'utf8' },
      { 'X-Test-Length': 'invalid' },
      { 'X-Test-Length': '1' },
    ])
      expect((await request('POST', 9, {}, extra)).status).toBe(400);
    for (const extra of [
      { 'X-Test-Length': '16385' },
      { 'X-Test-Body': 'oversize' },
      { 'X-Test-Body': 'empty' },
    ])
      expect((await request('POST', 9, undefined, extra)).status).toBe(413);
    for (const path of [
      '/api/private/profile/',
      '/api/private/profile/other',
      '/api/private/profile?secret=PRIVATE',
    ]) {
      const r = await request('GET', 9, undefined, {}, path);
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain('PRIVATE');
    }
    const method = await request('PUT', 9);
    expect(method.status).toBe(405);
    expect(method.headers.get('Allow')).toBe('GET, POST');
    expect(
      (await request('GET', 9, undefined, { 'X-Test-Origin': 'http://invalid.example' })).status,
    ).toBe(503);
    expect((await mf.dispatchFetch(ORIGIN + '/other')).status).toBe(418);
  });
  it('bounds stalled bodies without late profile creation and permits valid small chunks', async () => {
    const before = await counts();
    const began = Date.now();
    const r = await request('POST', 10, undefined, { 'X-Test-Body': 'late' });
    expect(r.status).toBe(408);
    expect(Date.now() - began).toBeGreaterThanOrEqual(4500);
    expect(Date.now() - began).toBeLessThan(6500);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await counts()).toEqual(before);
    expect((await request('POST', 10, undefined, { 'X-Test-Body': 'small' })).status).toBe(201);
  }, 8000);
  it('connects explicitly created profiles to actual draft publication and anonymous projection', async () => {
    async function action<T>(input: Record<string, unknown>): Promise<T> {
      return (await (
        await mf.dispatchFetch(ORIGIN + '/fixture/store', {
          method: 'POST',
          body: JSON.stringify({ headers: headers(users[0]), method: 'POST', ...input }),
        })
      ).json()) as T;
    }
    const draft = await action<{ id: string }>({
      action: 'draft',
      input: { title: 'Saved explicit title', body: 'Saved article body' },
    });
    const receipt = await action<{ contentId: string }>({
      action: 'publish',
      id: draft.id,
      input: {
        expectedVersion: 1,
        confirmPublic: true,
        summary: 'Confirmed summary',
        tags: [],
        minutes: 1,
      },
    });
    expect(receipt.contentId).toMatch(/^[0-9a-f-]{36}$/);
    const result = await action<{
      entry: { title: string; body: string; authorId: string };
      author: { id: string; name: string; department: string; year: string; bio: string };
    }>({ action: 'read-public', id: receipt.contentId, headers: {}, method: 'GET' });
    const profile = (await store('get', 0))!.profile!;
    expect(result.entry).toMatchObject({
      title: 'Saved explicit title',
      body: 'Saved article body',
      authorId: profile.id,
    });
    expect(result.author).toEqual({
      id: profile.id,
      name: value.displayName,
      department: value.department,
      year: value.yearLabel,
      bio: value.bio,
      initials: '明',
    });
  });
  it('rejects changed browser generation before private profile read releases data', async () => {
    users[0] = await session(0);
    const expected = await store('get');
    expect(expected?.profile).not.toBeNull();
    expect(await store('get', 0, undefined, { 'X-Test-Race': 'context' })).toBeNull();
    users[0] = await session(0);
    expect(await store('get')).toEqual(expected);
  });
  it('rechecks revocation, suspension and epoch after authentication without orphan rows', async () => {
    const db = await mf.getD1Database('DB');
    for (const race of ['revoke', 'status', 'epoch', 'context']) {
      users[11] = await session(11);
      const before = await counts();
      expect(await store('create', 11, value, { 'X-Test-Race': race })).toBeNull();
      expect(await counts()).toEqual(before);
      await db.prepare("UPDATE private_accounts SET status='active'").run();
    }
    users[11] = await session(11);
    expect(await store('get', 11, undefined, { 'X-Test-Race': 'revoke' })).toBeNull();
    users[11] = await session(11);
    expect(await store('create', 11, value, { 'X-Test-Now': String(NOW - 1) })).toBeNull();
  });
});
