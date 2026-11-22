import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { decodeEditorialReviewInput } from '../src/shared/editorial-review';

const ORIGIN = 'https://app.example.invalid';
const NOW = 1_800_000_000_000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
type Http = { status: number; headers: Record<string, string>; body: string } | null;
let users: Record<string, Session>;
let articleId: string;

async function call<T>(input: Record<string, unknown>): Promise<T> {
  return (await (
    await mf.dispatchFetch('https://fixture.test', {
      method: 'POST',
      body: JSON.stringify({ now: NOW, ...input }),
    })
  ).json()) as T;
}
const cookie = (s: Session) =>
  [s.setCookie, s.contextCookie].map((v) => v.split(';')[0]).join('; ');
const browser = (s: Session, write = false): Record<string, string> =>
  write
    ? {
        Cookie: cookie(s),
        Origin: ORIGIN,
        Authorization: 'Bearer csrf.' + s.csrfToken,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      }
    : { Cookie: cookie(s) };
const path = (id: string) => '/api/private/editorial-reviews/' + id;
const http = (
  p: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; action?: string } = {},
) => call<Http>({ action: init.action ?? 'http', url: ORIGIN + p, ...init });
const review = { verdict: 'good', points: ['experience', 'voice'], note: '店の人数の話が役に立つ' };

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        { type: 'ESModule', path: '.worker/editorial-reviews-test.js' },
        ...readdirSync('.worker')
          .filter((n) => n.endsWith('.wasm'))
          .map((n) => ({ type: 'CompiledWasm' as const, path: '.worker/' + n })),
      ],
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + file, 'utf8');
    const statements = (
      raw.includes('-- @statement') ? raw.split(/^-- @statement\s*$/m) : raw.split(/;\s*(?:\n|$)/)
    )
      .map((sql) => sql.replace(/^--.*$/gm, '').trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  for (const who of ['a', 'b'])
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + who, 'subject-' + who, who + '@st.kobedenshi.ac.jp', NOW)
      .run();
  await db
    .prepare(
      "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES('pub-b','公開名B','分野','学年','自己紹介','B',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES('account-b','pub-b')",
    )
    .run();
  users = {};
  for (const who of ['a', 'b']) users[who] = await call<Session>({ action: 'session', who });
  const draft = await call<{ id: string; version: number }>({
    action: 'create',
    url: ORIGIN + '/private/drafts',
    method: 'POST',
    headers: browser(users.b, true),
    input: { title: '公開した記事', body: '## 本文\n公開の中身' },
  });
  const published = await call<{ contentId: string }>({
    action: 'publish',
    url: ORIGIN + '/private/publication',
    method: 'POST',
    headers: browser(users.b, true),
    draft: draft.id,
    input: {
      expectedVersion: draft.version,
      confirmPublic: true,
      summary: '概要',
      tags: ['ごはん'],
      minutes: 3,
    },
  });
  articleId = published.contentId;
});
afterAll(async () => {
  await mf?.dispose();
});

it('lets the configured operator record reviews and read back the latest one', async () => {
  const empty = await http(path(articleId), { headers: browser(users.a) });
  expect(empty!.status).toBe(200);
  expect(JSON.parse(empty!.body)).toEqual({ review: null });
  expect(empty!.headers['cache-control']).toBe('private, no-store');
  const saved = await http(path(articleId), {
    method: 'PUT',
    headers: browser(users.a, true),
    body: JSON.stringify(review),
  });
  expect(saved!.status).toBe(200);
  expect(JSON.parse(saved!.body).review).toMatchObject(review);
  const second = { verdict: 'ok', points: ['too_long'], note: '' };
  const secondSaved = await http(path(articleId), {
    method: 'PUT',
    headers: browser(users.a, true),
    body: JSON.stringify(second),
  });
  expect(secondSaved!.body).toContain('too_long');
  const latest = JSON.parse((await http(path(articleId), { headers: browser(users.a) }))!.body);
  expect(latest.review).toMatchObject(second);
  // History is kept (append-only), and nothing identifies the reviewer in the response.
  const db = await mf.getD1Database('DB');
  const count = await db
    .prepare('SELECT count(*) n FROM editorial_reviews WHERE content_id=?')
    .bind(articleId)
    .first<{ n: number }>();
  expect(count!.n).toBe(2);
  expect(JSON.stringify(latest)).not.toContain('account-a');
});

it('answers everyone else with the same 404 and stores nothing', async () => {
  const db = await mf.getD1Database('DB');
  const before = (await db
    .prepare('SELECT count(*) n FROM editorial_reviews')
    .first<{ n: number }>())!.n;
  // Signed out, an ordinary student (also the author), and a write without CSRF.
  for (const r of [
    await http(path(articleId)),
    await http(path(articleId), { headers: browser(users.b) }),
    await http(path(articleId), {
      method: 'PUT',
      headers: browser(users.b, true),
      body: JSON.stringify(review),
    }),
    await http(path(articleId), {
      method: 'PUT',
      headers: { ...browser(users.a, true), Authorization: 'Bearer csrf.wrong' },
      body: JSON.stringify(review),
    }),
    await http(path(articleId), {
      method: 'PUT',
      headers: { ...browser(users.a, true), Origin: 'https://evil.invalid' },
      body: JSON.stringify(review),
    }),
  ]) {
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.body)).toEqual({ error: 'editorial_review_unavailable' });
  }
  const after = (await db
    .prepare('SELECT count(*) n FROM editorial_reviews')
    .first<{ n: number }>())!.n;
  expect(after).toBe(before);
});

it('only reviews real published articles and rejects malformed input', async () => {
  const missing = await http(path('11111111-1111-4111-8111-111111111111'), {
    method: 'PUT',
    headers: browser(users.a, true),
    body: JSON.stringify(review),
  });
  expect(missing!.status).toBe(404);
  const missingRead = await http(path('11111111-1111-4111-8111-111111111111'), {
    headers: browser(users.a),
  });
  expect(missingRead!.status).toBe(404);
  for (const bad of [
    { ...review, verdict: 'great' },
    { ...review, points: ['unknown'] },
    { ...review, points: ['voice', 'voice'] },
    { ...review, note: 'x'.repeat(501) },
    { ...review, extra: 1 },
  ]) {
    const r = await http(path(articleId), {
      method: 'PUT',
      headers: browser(users.a, true),
      body: JSON.stringify(bad),
    });
    expect(r!.status).toBe(404);
  }
  expect(
    (await http('/api/private/editorial-reviews/not-a-uuid', { headers: browser(users.a) }))!
      .status,
  ).toBe(404);
  expect((await http(path(articleId) + '?x=1', { headers: browser(users.a) }))!.status).toBe(404);
  const del = await http(path(articleId), { method: 'DELETE', headers: browser(users.a, true) });
  expect(del!.status).toBe(405);
});

it('stays closed in the composed handler while the release flag is off', async () => {
  const r = await http(path(articleId), { headers: browser(users.a), action: 'composed-closed' });
  expect(r).toBeNull();
});

it('decodes only the fixed shape', () => {
  expect(decodeEditorialReviewInput(review)).toEqual(review);
  expect(decodeEditorialReviewInput({ ...review, note: '  前後の空白  ' })!.note).toBe(
    '前後の空白',
  );
  expect(decodeEditorialReviewInput(null)).toBeNull();
  expect(decodeEditorialReviewInput([])).toBeNull();
  expect(decodeEditorialReviewInput({ ...review, note: 'a\u0000b' })).toBeNull();
});
