import { applyFixtureMigrations } from './helpers/migrations';
import { workerModules } from './helpers/worker-modules';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { encode as pngEncode } from 'fast-png';
import jpeg from 'jpeg-js';
import { AVATAR_MAX_BYTES } from '../src/shared/avatar';
const O = 'https://app.example.invalid',
  NOW = 1800000000000;
let mf: Miniflare, db: D1Database;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let users: Session[], author: string;
const square = (edge: number) =>
  pngEncode({
    width: edge,
    height: edge,
    data: new Uint8Array(edge * edge * 4).fill(200),
    channels: 4,
  });
const wide = pngEncode({
  width: 64,
  height: 48,
  data: new Uint8Array(64 * 48 * 4).fill(9),
  channels: 4,
});
const jpg = jpeg.encode(
  { width: 96, height: 96, data: new Uint8Array(96 * 96 * 4).fill(120) },
  80,
).data;
const h = (n = 0) => ({
  Cookie: [users[n].setCookie, users[n].contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: O,
  Authorization: 'Bearer csrf.' + users[n].csrfToken,
});
const own = '/api/private/profile-avatar';
const get = (path: string, n: number | null = 0) =>
  mf.dispatchFetch(O + path, { headers: n === null ? {} : h(n) });
const put = (bytes: Uint8Array, n = 0, type = 'image/png', extra: Record<string, string> = {}) =>
  mf.dispatchFetch(O + own, {
    method: 'PUT',
    headers: { ...h(n), 'Content-Type': type, ...extra },
    body: bytes,
  });
const post = (path: string, input: unknown, n = 0) =>
  mf.dispatchFetch(O + path, {
    method: 'POST',
    headers: { ...h(n), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
const removal = (id = author) => `/api/private/profile-moderation/cases/${id}/avatar-removal`;
async function version(n = 0) {
  return ((await (await get(own, n)).json()) as { avatar: string | null }).avatar;
}
function security(r: { headers: Pick<Headers, 'get' | 'has'> }) {
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(r.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
  for (const k of ['Set-Cookie', 'Location', 'Access-Control-Allow-Origin'])
    expect(r.headers.has(k)).toBe(false);
}
async function profileFor(n: number, displayName: string) {
  const r = (await (
    await post(
      '/fixture/profile',
      { displayName, department: 'IT', yearLabel: '2年', bio: 'bio', confirmPublic: true },
      n,
    )
  ).json()) as { profile: { id: string } };
  return r.profile.id;
}
async function publishProject(n: number) {
  const d = (await (
    await post(
      '/api/private/project-drafts',
      { title: 'Visible work', description: 'Saved', githubUrl: '', demoUrl: '' },
      n,
    )
  ).json()) as { id: string };
  const r = await post(
    '/api/private/project-publications/' + d.id,
    { expectedVersion: 1, confirmPublic: true },
    n,
  );
  expect([200, 201]).toContain(r.status);
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/profile-avatars-test.js'),
      compatibilityDate: '2026-11-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
    }),
  );
  db = await mf.getD1Database('DB');
  await applyFixtureMigrations(db);
  users = [];
  for (let n = 0; n < 4; n++) {
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
    const r = await mf.dispatchFetch(O + '/fixture/session', {
      headers: { 'X-Test-Who': String(n) },
    });
    users.push((await r.json()) as Session);
  }
  author = await profileFor(0, 'Icon author');
  await profileFor(2, 'Reporter');
});
afterAll(async () => {
  await mf?.dispose();
});

it('needs a session and an own profile; starts without an icon', async () => {
  expect((await get(own, null)).status).toBe(401);
  // account-3 has no profile: there is nothing to attach an icon to.
  expect((await get(own, 3)).status).toBe(404);
  expect((await put(square(64), 3)).status).toBe(404);
  const r = await get(own, 0);
  security(r);
  expect(await r.json()).toEqual({ avatar: null });
});

it('validates the image on the server: square, bounded, decodable PNG/JPEG only', async () => {
  expect((await put(wide)).status).toBe(422);
  expect((await put(square(16))).status).toBe(422);
  expect((await put(square(300))).status).toBe(422);
  expect((await put(new TextEncoder().encode('<svg/>'), 0, 'image/svg+xml')).status).toBe(415);
  expect((await put(new Uint8Array([137, 80, 78, 71, 1, 2, 3]))).status).toBe(422);
  expect((await put(new Uint8Array(70000).fill(1))).status).toBe(413);
  // The shared upload reader's codes on this route (#295): one byte over the limit, empty, encoded.
  expect((await put(new Uint8Array(AVATAR_MAX_BYTES + 1).fill(1))).status).toBe(413);
  expect((await put(new Uint8Array(0))).status).toBe(400);
  expect((await put(square(64), 0, 'image/png', { 'Content-Encoding': 'gzip' })).status).toBe(415);
  expect((await put(square(64), 0, 'image/gif')).status).toBe(415);
  // The body is read only after authorization (#295 verifier): account-3 has no profile, so an
  // over-limit, refused-type or empty body still gets the unauthorized 404, never 413/415/400.
  expect((await put(new Uint8Array(AVATAR_MAX_BYTES + 1).fill(1), 3)).status).toBe(404);
  expect((await put(square(64), 3, 'image/gif')).status).toBe(404);
  expect((await put(new Uint8Array(0), 3)).status).toBe(404);
  expect(await version()).toBeNull();
  const jpegResult = await put(jpg, 0, 'image/jpeg');
  expect(jpegResult.status).toBe(201);
});

it('stores the own icon privately until the profile is public, then serves only the path', async () => {
  const r = await put(square(128));
  expect(r.status).toBe(201);
  const { avatar } = (await r.json()) as { avatar: string };
  expect(avatar).toMatch(/^[0-9a-f]{16}$/);
  expect(await version()).toBe(avatar);
  const mine = await get(own + '/' + avatar);
  security(mine);
  expect(mine.headers.get('Content-Type')).toBe('image/png');
  // Another student cannot read it through the private path, even knowing the version.
  expect((await get(own + '/' + avatar, 2)).status).toBe(404);
  // Not public yet: the profile has no published work.
  expect((await get(`/api/profile-avatars/${author}/${avatar}`, null)).status).toBe(404);
  await publishProject(0);
  const pub = await get(`/api/profile-avatars/${author}/${avatar}`, null);
  security(pub);
  expect(pub.status).toBe(200);
  expect((await get(`/api/profile-avatars/${author}/${'0'.repeat(16)}`, null)).status).toBe(404);
  const student = await get('/api/students/' + author, null);
  const text = await student.text();
  expect(JSON.parse(text).avatar).toBe(`/api/profile-avatars/${author}/${avatar}`);
  expect(text).not.toMatch(/account-|subject-|@st\.kobedenshi/);
});

it('lets the owner delete it, after which readers see the initial again', async () => {
  const before = await version();
  const r = await mf.dispatchFetch(O + own, { method: 'DELETE', headers: h(0) });
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ avatar: null });
  expect((await get(`/api/profile-avatars/${author}/${before}`, null)).status).toBe(404);
  expect(JSON.parse(await (await get('/api/students/' + author, null)).text()).avatar).toBeNull();
  // A repeated delete still reports the settled state.
  expect((await mf.dispatchFetch(O + own, { method: 'DELETE', headers: h(0) })).status).toBe(200);
});

it('lets only an operator remove a reported icon they saw, and tells the owner why', async () => {
  expect((await put(square(64))).status).toBe(201);
  const current = (await version())!;
  // No report yet: nothing to decide on.
  expect((await post(removal(), { avatar: current, reason: 'Not allowed' }, 1)).status).toBe(404);
  expect(
    (await post('/api/private/profile-reports/' + author, { reason: 'Offensive icon' }, 2)).status,
  ).toBe(201);
  const report = (await (
    await get('/api/private/profile-moderation/cases/' + author, 1)
  ).json()) as {
    avatar: string;
  };
  // The operator reviews through an operator-only, uncached path, not the public one (#205).
  const reviewPath = `/api/private/profile-moderation/cases/${author}/avatar/${current}`;
  expect(report.avatar).toBe(reviewPath);
  const seen = await get(reviewPath, 1);
  expect(seen.status).toBe(200);
  expect(seen.headers.get('Content-Type')).toBe('image/png');
  security(seen);
  for (const n of [null, 0, 2]) expect((await get(reviewPath, n)).status).not.toBe(200);
  expect(
    (await get(`/api/private/profile-moderation/cases/${author}/avatar/${'0'.repeat(16)}`, 1))
      .status,
  ).toBe(404);
  expect((await get(reviewPath + '?x=1', 1)).status).toBe(404);
  // Once the profile is no longer public the public path is gone, but the operator still
  // sees the exact icon before deciding (verifier finding 1 of #198).
  await db
    .prepare("UPDATE project_publications SET status='hidden' WHERE public_profile_id=?")
    .bind(author)
    .run();
  expect((await get(`/api/profile-avatars/${author}/${current}`, null)).status).toBe(404);
  expect((await get(reviewPath, 1)).status).toBe(200);
  expect(
    (
      (await (await get('/api/private/profile-moderation/cases/' + author, 1)).json()) as {
        avatar: string;
      }
    ).avatar,
  ).toBe(reviewPath);
  // Non-operators, stale versions and malformed input are refused.
  expect((await post(removal(), { avatar: current, reason: 'x' }, 2)).status).toBe(404);
  expect((await post(removal(), { avatar: 'f'.repeat(16), reason: 'x' }, 1)).status).toBe(404);
  expect((await post(removal(), { avatar: current, reason: ' ' }, 1)).status).toBe(404);
  expect((await post(removal(), { avatar: current, reason: 'x', extra: 1 }, 1)).status).toBe(404);
  const done = await post(removal(), { avatar: current, reason: '他の人の写真に見えるため' }, 1);
  expect(done.status).toBe(201);
  expect(await done.json()).toEqual({ removed: true });
  expect(await version()).toBeNull();
  expect((await get(`/api/profile-avatars/${author}/${current}`, null)).status).toBe(404);
  const notices = (await (await get('/api/private/notifications', 0)).json()) as {
    id: string;
    kind: string;
    reason: string;
    title: string;
  }[];
  const notice = notices.find((n) => n.kind === 'avatar_removed');
  expect(notice).toMatchObject({ reason: '他の人の写真に見えるため', title: 'Icon author' });
  expect(notice!.id).toMatch(/^avatar\.[0-9a-f-]{36}$/);
  const others = (await (await get('/api/private/notifications', 2)).json()) as { kind: string }[];
  expect(others.some((n) => n.kind === 'avatar_removed')).toBe(false);
  // The owner can set a new icon afterwards.
  expect((await put(square(96))).status).toBe(201);
});

it('keeps removal records and report authors immutable in the table', async () => {
  await expect(
    db.prepare("UPDATE profile_avatar_removals SET reason='changed'").run(),
  ).rejects.toThrow(/immutable/);
  await expect(
    db.prepare("UPDATE profile_avatar_removals SET owner_account_id='account-3'").run(),
  ).rejects.toThrow(/immutable/);
  await expect(
    db.prepare("UPDATE profile_reports SET reporter_account_id='account-3'").run(),
  ).rejects.toThrow(/immutable/);
  // Samples never get an icon, even by a direct write.
  await expect(
    db
      .prepare("INSERT INTO profile_avatars VALUES('sample-a','image/png',64,64,x'00',?,1)")
      .bind('a'.repeat(64))
      .run(),
  ).rejects.toThrow(/avatar unavailable/);
});

it('answers a batched public icon lookup with versioned paths only (#205)', async () => {
  // Re-publish a work so the author is public again, then look up several ids at once.
  await publishProject(0);
  const current = (await version())!;
  const r = await get(`/api/profile-avatars?ids=${author},sample-a,nobody`, null);
  expect(r.status).toBe(200);
  security(r);
  const text = await r.text();
  expect(JSON.parse(text)).toEqual({
    avatars: {
      [author]: `/api/profile-avatars/${author}/${current}`,
      'sample-a': null,
      nobody: null,
    },
  });
  expect(text).not.toMatch(/account-|subject-|@st\.kobedenshi|sha256|payload/);
  // Malformed, duplicated, oversized or extra-parameter requests are refused.
  for (const q of [
    '',
    '?ids=',
    `?ids=${author},${author}`,
    '?ids=bad%20id',
    `?ids=${author}&x=1`,
    '?id=' + author,
    '?ids=' + Array.from({ length: 49 }, (_, n) => 'p' + n).join(','),
  ])
    expect((await get('/api/profile-avatars' + q, null)).status).toBe(404);
  expect(
    (await mf.dispatchFetch(O + '/api/profile-avatars?ids=' + author, { method: 'POST' })).status,
  ).toBe(405);
  // A profile without any published work shows no icon even when one is stored.
  await db
    .prepare("UPDATE project_publications SET status='hidden' WHERE public_profile_id=?")
    .bind(author)
    .run();
  expect(await (await get(`/api/profile-avatars?ids=${author}`, null)).json()).toEqual({
    avatars: { [author]: null },
  });
});
