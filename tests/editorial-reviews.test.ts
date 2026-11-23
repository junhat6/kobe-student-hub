import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import {
  decodeEditorialReviewInput,
  decodeEditorialTasteSummary,
} from '../src/shared/editorial-review';
import { EDITORIAL_PRODUCT_NOTES, EDITORIAL_TASTE } from '../src/agent/editorial-taste';

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

// #244 (C22 condition 5): the operator's 好み screen reads the ledger and counts only.
it('summarises the operator ledger and own review counts without any note', async () => {
  const r = await http('/api/private/editorial-taste', { headers: browser(users.a) });
  expect(r!.status).toBe(200);
  expect(r!.headers['cache-control']).toBe('private, no-store');
  const summary = decodeEditorialTasteSummary(JSON.parse(r!.body));
  expect(summary).not.toBeNull();
  expect(summary!.ledger.taste).toEqual(EDITORIAL_TASTE.split('\n'));
  expect(summary!.ledger.product).toEqual(
    EDITORIAL_PRODUCT_NOTES.split('\n').filter((l) => l.trim()),
  );
  // Two records on one article count once, as the latest (ok + too_long).
  expect(summary!.reviews.total).toBe(1);
  expect(summary!.reviews.verdicts).toEqual({ good: 0, ok: 1, bad: 0 });
  expect(summary!.reviews.points.too_long).toBe(1);
  expect(summary!.reviews.points.experience).toBe(0);
  expect(summary!.aiDiff).toBeNull();
  // Never a note, an article, an author or a reviewer.
  for (const secret of [review.note, articleId, 'account-a', 'account-b', '公開名B'])
    expect(r!.body).not.toContain(secret);
});

it('leaves reviews older than 30 days out of the summary', async () => {
  const draft = await call<{ id: string; version: number }>({
    action: 'create',
    url: ORIGIN + '/private/drafts',
    method: 'POST',
    headers: browser(users.b, true),
    input: { title: '古いレビューの記事', body: '## 本文\n古い中身' },
  });
  const old = await call<{ contentId: string }>({
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
  const db = await mf.getD1Database('DB');
  const insert = (id: string, at: number) =>
    db
      .prepare(
        "INSERT INTO editorial_reviews(id,reviewer_account_id,content_id,revision,verdict,points_json,note,reviewed_at_ms) VALUES(?,'account-a',?,NULL,'bad','[\"thin\"]','',?)",
      )
      .bind(id, old.contentId, at)
      .run();
  await insert('00000000-0000-4000-8000-00000000a0a0', NOW - 31 * 24 * 60 * 60 * 1000);
  const before = JSON.parse(
    (await http('/api/private/editorial-taste', { headers: browser(users.a) }))!.body,
  );
  expect(before.reviews.total).toBe(1);
  expect(before.reviews.verdicts.bad).toBe(0);
  expect(before.reviews.points.thin).toBe(0);
  // Inside the window it counts.
  await insert('00000000-0000-4000-8000-00000000a0a1', NOW - 29 * 24 * 60 * 60 * 1000);
  const after = JSON.parse(
    (await http('/api/private/editorial-taste', { headers: browser(users.a) }))!.body,
  );
  expect(after.reviews.total).toBe(2);
  expect(after.reviews.verdicts.bad).toBe(1);
  expect(after.reviews.points.thin).toBe(1);
});

it('answers non-operators and bad requests on the summary with the same 404', async () => {
  for (const r of [
    await http('/api/private/editorial-taste'),
    await http('/api/private/editorial-taste', { headers: browser(users.b) }),
    await http('/api/private/editorial-taste?x=1', { headers: browser(users.a) }),
  ]) {
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.body)).toEqual({ error: 'editorial_review_unavailable' });
  }
  const put = await http('/api/private/editorial-taste', {
    method: 'PUT',
    headers: browser(users.a, true),
    body: '{}',
  });
  expect(put!.status).toBe(405);
  const closed = await http('/api/private/editorial-taste', {
    headers: browser(users.a),
    action: 'composed-closed',
  });
  expect(closed).toBeNull();
});
