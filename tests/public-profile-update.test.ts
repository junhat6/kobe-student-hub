import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyFixtureMigrations } from './helpers/migrations';
import type { OwnPublicProfile } from '../worker/public-profile';

const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare;
let users: Session[];
const input = {
  displayName: '架空の書き手',
  department: 'IT',
  yearLabel: '本人の表示',
  bio: '初回の公開文',
  confirmPublic: true,
};
const headers = (s: Session) => ({
  Cookie: [s.setCookie, s.contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + s.csrfToken,
  'Content-Type': 'application/json',
});
async function session(n: number) {
  return (await (
    await mf.dispatchFetch(ORIGIN + '/fixture/session', { headers: { 'X-Test-Who': String(n) } })
  ).json()) as Session;
}
async function request(
  n: number,
  method: string,
  body?: unknown,
  extra: Record<string, string | undefined> = {},
) {
  const r = await mf.dispatchFetch(ORIGIN + '/api/private/profile', {
    method,
    headers: { ...headers(users[n]), ...extra } as Record<string, string>,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(r.headers.get('Vary')).toBe('Cookie');
  expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
  for (const key of ['Set-Cookie', 'Access-Control-Allow-Origin', 'Location'])
    expect(r.headers.has(key)).toBe(false);
  return r;
}
async function create(n: number) {
  expect((await request(n, 'POST', input)).status).toBe(201);
  return ((await (await request(n, 'GET')).json()) as { profile: OwnPublicProfile }).profile;
}
const next = (expected: OwnPublicProfile, bio = '変更した公開文') => ({
  ...input,
  displayName: '😀 更新した書き手',
  bio,
  expectedProfile: expected,
});
const read = async (n: number) =>
  ((await (await request(n, 'GET')).json()) as { profile: OwnPublicProfile }).profile;
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
  await applyFixtureMigrations(db);
  for (let n = 0; n < 10; n++)
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
  users = await Promise.all(Array.from({ length: 10 }, (_, n) => session(n)));
});
afterAll(async () => {
  await mf?.dispose();
});
describe('explicit owner public-profile updates', () => {
  it('keeps the public ID and ownership, changes only confirmed public fields and acknowledges an identical desired state', async () => {
    const old = await create(0),
      data = next(old);
    const r = await request(0, 'PATCH', data);
    expect(r.status).toBe(200);
    const updated = ((await r.json()) as { profile: OwnPublicProfile }).profile;
    expect(updated).toEqual({
      ...old,
      displayName: data.displayName,
      bio: data.bio,
      initials: '😀',
    });
    expect(await read(0)).toEqual(updated);
    expect((await request(0, 'PATCH', data)).status).toBe(200);
    const db = await mf.getD1Database('DB');
    expect(
      await db
        .prepare('SELECT public_profile_id FROM account_public_profiles WHERE owner_account_id=?')
        .bind('account-0')
        .first('public_profile_id'),
    ).toBe(old.id);
    expect(JSON.stringify(updated)).not.toMatch(/account-|subject-|st.kobedenshi|email|session/);
  });
  it('rejects stale edits and cross-owner expected profiles without modifying either owner', async () => {
    const old = await create(1),
      other = await create(2);
    expect((await request(1, 'PATCH', next(old, 'first update'))).status).toBe(200);
    expect((await request(1, 'PATCH', next(old, 'stale overwrite'))).status).toBe(409);
    expect((await request(2, 'PATCH', next(old, 'foreign overwrite'))).status).toBe(404);
    expect((await read(1)).bio).toBe('first update');
    expect(await read(2)).toEqual(other);
  });
  it('allows at most one differing edit against a shared prior public snapshot', async () => {
    const old = await create(3);
    const responses = await Promise.all(
      ['A', 'B'].map((bio) => request(3, 'PATCH', next(old, bio))),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(['A', 'B']).toContain((await read(3)).bio);
  });
  it('requires exact bounded confirmation/expected DTOs and rejects client authority', async () => {
    const old = await create(4),
      data = next(old);
    for (const bad of [
      null,
      {},
      { ...data, confirmPublic: false },
      { ...data, email: 'PRIVATE' },
      { ...data, bio: 'x'.repeat(801) },
      { ...data, expectedProfile: { ...old, email: 'PRIVATE' } },
      { ...data, expectedProfile: { ...old, id: '../private' } },
      { ...data, expectedProfile: { ...old, bio: '\ud800' } },
      { ...data, owner_account_id: 'account-4' },
    ]) {
      expect((await request(4, 'PATCH', bad)).status).toBe(404);
      expect(await read(4)).toEqual(old);
    }
    for (const extra of [
      { Cookie: '' },
      { Origin: 'https://evil.invalid' },
      { Authorization: '' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ])
      expect((await request(4, 'PATCH', data, extra)).status).toBe(401);
    expect((await request(4, 'PATCH', data, { 'Content-Type': 'text/plain' })).status).toBe(415);
  });
  it('rolls back failed/ignored writes and in-transaction mutation without acknowledging a partial update', async () => {
    const old = await create(5),
      db = await mf.getD1Database('DB');
    for (const operation of [
      "BEFORE UPDATE ON public_profiles BEGIN SELECT RAISE(ABORT,'fixture'); END",
      'BEFORE UPDATE ON public_profiles BEGIN SELECT RAISE(IGNORE); END',
      "AFTER UPDATE ON public_profiles BEGIN UPDATE public_profiles SET bio='injected mutation' WHERE id=NEW.id; END",
    ]) {
      await db.prepare('CREATE TRIGGER fixture_update_failure ' + operation).run();
      try {
        expect((await request(5, 'PATCH', next(old))).status).toBe(404);
        expect(await read(5)).toEqual(old);
      } finally {
        await db.prepare('DROP TRIGGER fixture_update_failure').run();
      }
    }
  });
  it('rechecks session revocation, browser generation, epoch, status and enrollment after authentication', async () => {
    const old = await create(6),
      db = await mf.getD1Database('DB');
    for (const race of ['revoke', 'context', 'epoch', 'status', 'enrollment']) {
      users[6] = await session(6);
      expect((await request(6, 'PATCH', next(old), { 'X-Test-Race': race })).status).toBe(404);
      expect(
        await db.prepare('SELECT bio FROM public_profiles WHERE id=?').bind(old.id).first('bio'),
      ).toBe(old.bio);
      await db.prepare("UPDATE private_accounts SET status='active'").run();
    }
  });
});
