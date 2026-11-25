import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import {
  decodeEditorialReviewInput,
  decodeEditorialTasteSummary,
} from '../src/shared/editorial-review';
import { EDITORIAL_PRODUCT_NOTES, EDITORIAL_TASTE } from '../src/agent/editorial-taste';
import { decodeEditorialMarkList, locateMark } from '../src/shared/editorial-draft-marks';
import { expectBoundedJsonRoute } from './helpers/bounded-json-route';

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
  // No AI-written draft yet: zero, not a placeholder.
  expect(summary!.aiDiff).toEqual({
    days: 30,
    drafts: 0,
    compared: 0,
    edited: 0,
    added: 0,
    removed: 0,
    published: 0,
    medianDaysToPublish: null,
    approximate: false,
  });
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

// C22 condition 5: how the operator changed their own AI agent's drafts, as numbers only.
it('counts how the operator changed their own AI drafts without any title, line or id', async () => {
  const db = await mf.getD1Database('DB');
  const DAY = 24 * 60 * 60 * 1000;
  await db.batch([
    db.prepare(
      "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES('pub-a','公開名A','分野','学年','自己紹介','A',0)",
    ),
    db.prepare(
      "INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES('account-a','pub-a')",
    ),
  ]);
  const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const draft = (id: string, owner: string, title: string, body: string) =>
    db
      .prepare(
        'INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms) VALUES(?,?,?,?,2,?)',
      )
      .bind(id, owner, title, body, NOW - DAY);
  const agent = (id: string, owner: string, title: string, body: string, at: number) =>
    db
      .prepare(
        'INSERT INTO agent_draft_versions(draft_id,account_id,title,body,draft_version,recorded_at_ms) VALUES(?,?,?,?,1,?)',
      )
      .bind(id, owner, title, body, at);
  const origin = (id: string, owner: string, at: number) =>
    db
      .prepare(
        'INSERT INTO agent_draft_origins(draft_id,account_id,grant_id,created_at_ms) VALUES(?,?,?,?)',
      )
      .bind(id, owner, uuid(999), at);
  // 1: unpublished, the operator rewrote one line and added one (+2 / -1).
  await db.batch([
    draft(uuid(1), 'account-a', 'カナリア題1', '前置き\nカナリア行の直し\n結び\n足した行'),
    agent(uuid(1), 'account-a', 'カナリア題1', '前置き\nカナリア行\n結び', NOW - DAY),
    origin(uuid(1), 'account-a', NOW - 3 * DAY),
  ]);
  // 2: published through the real flow; compared with the published body (+1 / -0), 2 days.
  const created = await call<{ id: string; version: number }>({
    action: 'create',
    url: ORIGIN + '/private/drafts',
    method: 'POST',
    headers: browser(users.a, true),
    input: { title: 'カナリア題2', body: 'AIの一行目\nAIの二行目\n本人の行' },
  });
  await db.batch([
    agent(created.id, 'account-a', 'カナリア題2', 'AIの一行目\nAIの二行目', NOW - 2 * DAY),
    origin(created.id, 'account-a', NOW - 2 * DAY),
  ]);
  const published = await call<{ contentId: string }>({
    action: 'publish',
    url: ORIGIN + '/private/publication',
    method: 'POST',
    headers: browser(users.a, true),
    draft: created.id,
    input: {
      expectedVersion: created.version,
      confirmPublic: true,
      summary: '概要',
      tags: ['ごはん'],
      minutes: 3,
    },
  });
  // Left out: older than 30 days, and another account's AI draft.
  await db.batch([
    draft(uuid(3), 'account-a', 'カナリア題3', '古い'),
    agent(uuid(3), 'account-a', 'カナリア題3', '古いAI', NOW - 31 * DAY),
    draft(uuid(4), 'account-b', 'カナリア題4', '他人'),
    agent(uuid(4), 'account-b', 'カナリア題4', '他人のAI', NOW - DAY),
  ]);
  const read = async () => {
    const r = await http('/api/private/editorial-taste', { headers: browser(users.a) });
    expect(r!.status).toBe(200);
    for (const secret of ['カナリア', 'AIの', '本人の行', uuid(1), created.id, published.contentId])
      expect(r!.body).not.toContain(secret);
    return decodeEditorialTasteSummary(JSON.parse(r!.body))!.aiDiff;
  };
  expect(await read()).toEqual({
    days: 30,
    drafts: 2,
    compared: 2,
    edited: 2,
    added: 3,
    removed: 1,
    published: 1,
    medianDaysToPublish: 2,
    approximate: false,
  });
  // More AI drafts than are compared: the total counts all 10, the lines only the newest 8
  // (eight unchanged ones, so the two edited drafts above fall out of the comparison).
  const extra = [];
  for (let n = 10; n < 18; n++)
    extra.push(
      draft(uuid(n), 'account-a', 'カナリア題' + n, '同じ'),
      agent(uuid(n), 'account-a', 'カナリア題' + n, '同じ', NOW - DAY / 2 + n),
    );
  await db.batch(extra);
  const many = await read();
  expect(many).toMatchObject({ drafts: 10, compared: 8, edited: 0, added: 0, removed: 0 });
  expect(many.published).toBe(0);
  expect(many.medianDaysToPublish).toBeNull();
  // A student who is not the operator still gets 404, even with AI drafts of their own.
  expect((await http('/api/private/editorial-taste', { headers: browser(users.b) }))!.status).toBe(
    404,
  );
});

it('decodes the AI difference only in its fixed shape', async () => {
  const r = JSON.parse(
    (await http('/api/private/editorial-taste', { headers: browser(users.a) }))!.body,
  );
  const ok = {
    days: 30,
    drafts: 3,
    compared: 3,
    edited: 1,
    added: 4,
    removed: 2,
    published: 1,
    medianDaysToPublish: 1.5,
    approximate: false,
  };
  expect(decodeEditorialTasteSummary({ ...r, aiDiff: ok })!.aiDiff).toEqual(ok);
  for (const bad of [
    null,
    { ...ok, title: 'x' },
    { ...ok, days: 7 },
    { ...ok, compared: 9, drafts: 9 },
    { ...ok, compared: 4 },
    { ...ok, edited: 4 },
    { ...ok, added: -1 },
    { ...ok, removed: 1.5 },
    { ...ok, medianDaysToPublish: -1 },
    { ...ok, medianDaysToPublish: 2, published: 0 },
    { ...ok, approximate: 'no' },
  ])
    expect(decodeEditorialTasteSummary({ ...r, aiDiff: bad })).toBeNull();
});

// Independent verification of 29b5960 (F1/F2): published drafts are compared with the latest
// published body; another owner's draft and a hidden article are not counted as the operator's.
it('compares a published AI draft with its latest published body and skips other owners', async () => {
  const db = await mf.getD1Database('DB');
  const DAY = 24 * 60 * 60 * 1000;
  const read = async () =>
    decodeEditorialTasteSummary(
      JSON.parse((await http('/api/private/editorial-taste', { headers: browser(users.a) }))!.body),
    )!.aiDiff;
  const base = await read();
  // A draft owned by someone else, with an AI row that claims the operator: not counted.
  const other = '00000000-0000-4000-8000-000000000500';
  await db.batch([
    db
      .prepare(
        'INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms) VALUES(?,?,?,?,2,?)',
      )
      .bind(other, 'account-b', '他人の題', '他人の本文\n二', NOW - DAY),
    db
      .prepare(
        'INSERT INTO agent_draft_versions(draft_id,account_id,title,body,draft_version,recorded_at_ms) VALUES(?,?,?,?,1,?)',
      )
      .bind(other, 'account-a', '他人の題', '他人のAI', NOW - 100),
  ]);
  expect((await read()).drafts).toBe(base.drafts);
  // The operator's own AI draft, published unchanged from the AI's text.
  const created = await call<{ id: string; version: number }>({
    action: 'create',
    url: ORIGIN + '/private/drafts',
    method: 'POST',
    headers: browser(users.a, true),
    input: { title: '比べる題', body: 'AI一\nAI二' },
  });
  await db
    .prepare(
      'INSERT INTO agent_draft_versions(draft_id,account_id,title,body,draft_version,recorded_at_ms) VALUES(?,?,?,?,1,?)',
    )
    .bind(created.id, 'account-a', '比べる題', 'AI一\nAI二', NOW - 10)
    .run();
  const pub = await call<{ contentId: string }>({
    action: 'publish',
    url: ORIGIN + '/private/publication',
    method: 'POST',
    headers: browser(users.a, true),
    draft: created.id,
    input: {
      expectedVersion: created.version,
      confirmPublic: true,
      summary: '概要',
      tags: ['ごはん'],
      minutes: 3,
    },
  });
  const published = await read();
  expect(published.drafts).toBe(base.drafts + 1);
  expect(published.published).toBe(base.published + 1);
  expect(published.added).toBe(base.added);
  expect(published.removed).toBe(base.removed);
  // Unpublished edits to the draft do not change the count of a published one.
  await db
    .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
    .bind('AI一\nAI二\n公開後の行\n公開後の行2', created.id)
    .run();
  expect(await read()).toEqual(published);
  // Republishing those edits does: compared with the latest published revision, not the first.
  const republished = await call<{ contentId: string }>({
    action: 'publish',
    url: ORIGIN + '/private/publication',
    method: 'POST',
    headers: browser(users.a, true),
    draft: created.id,
    input: {
      expectedVersion: created.version + 1,
      expectedPublicationVersion: created.version,
      confirmPublic: true,
      summary: '概要',
      tags: ['ごはん'],
      minutes: 3,
    },
  });
  expect(republished?.contentId).toBe(pub.contentId);
  const revised = await read();
  expect(revised.added).toBe(base.added + 2);
  expect(revised.edited).toBe(published.edited + 1);
  // Hidden after publication: no longer counted as published, compared with the draft instead.
  await db.prepare("UPDATE content SET status='hidden' WHERE id=?").bind(pub.contentId).run();
  const hidden = await read();
  expect(hidden.published).toBe(base.published);
  expect(hidden.added).toBe(base.added + 2);
  expect(hidden.edited).toBe(revised.edited);
});

// #271 (first stage): the operator reviews one of their own drafts from its preview.
describe('editorial draft reviews', () => {
  const draftPath = (id: string) => '/api/private/editorial-draft-reviews/' + id;
  const canary = 'カナリア下書きレビュー-271';
  const create = (who: Session, title: string) =>
    call<{ id: string; version: number }>({
      action: 'create',
      url: ORIGIN + '/private/drafts',
      method: 'POST',
      headers: browser(who, true),
      input: { title, body: '## 本文\n下書きの中身' },
    });
  const rows = async () =>
    (await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT count(*) n FROM editorial_draft_reviews')
      .first<{ n: number }>())!.n;

  it('lets the operator record reviews of their own draft and read back the latest one', async () => {
    const draft = await create(users.a, '運営者の下書き');
    const empty = await http(draftPath(draft.id), { headers: browser(users.a) });
    expect(empty!.status).toBe(200);
    expect(JSON.parse(empty!.body)).toEqual({ review: null });
    expect(empty!.headers['cache-control']).toBe('private, no-store');
    const first = { verdict: 'bad', points: ['thin', 'unclear_reader'], note: canary };
    const saved = await http(draftPath(draft.id), {
      method: 'PUT',
      headers: browser(users.a, true),
      body: JSON.stringify(first),
    });
    expect(saved!.status).toBe(200);
    expect(JSON.parse(saved!.body).review).toMatchObject(first);
    const second = { verdict: 'good', points: ['voice'], note: canary + '-2' };
    await http(draftPath(draft.id), {
      method: 'PUT',
      headers: browser(users.a, true),
      body: JSON.stringify(second),
    });
    const latest = JSON.parse(
      (await http(draftPath(draft.id), { headers: browser(users.a) }))!.body,
    );
    expect(latest.review).toMatchObject(second);
    expect(Object.keys(latest.review).sort()).toEqual(['note', 'points', 'reviewedAt', 'verdict']);
    // Append-only history tied to the saved draft version; nothing identifies the reviewer.
    const db = await mf.getD1Database('DB');
    const history = await db
      .prepare(
        'SELECT reviewer_account_id,draft_version FROM editorial_draft_reviews WHERE draft_id=?',
      )
      .bind(draft.id)
      .all<{ reviewer_account_id: string; draft_version: number }>();
    expect(history.results).toEqual([
      { reviewer_account_id: 'account-a', draft_version: draft.version },
      { reviewer_account_id: 'account-a', draft_version: draft.version },
    ]);
    expect(JSON.stringify(latest)).not.toContain('account-a');
    await expect(
      db
        .prepare("UPDATE editorial_draft_reviews SET note='x' WHERE draft_id=?")
        .bind(draft.id)
        .run(),
    ).rejects.toThrow(/append-only/);
    // The 好み summary counts the reviewed draft once, never its note, title or id.
    const summary = await http('/api/private/editorial-taste', { headers: browser(users.a) });
    expect(decodeEditorialTasteSummary(JSON.parse(summary!.body))!.reviews.drafts).toBe(1);
    for (const secret of [canary, '運営者の下書き', draft.id])
      expect(summary!.body).not.toContain(secret);
    // Published-article review counts are unchanged by draft reviews.
    expect(JSON.parse(summary!.body).reviews.verdicts.bad).toBe(1);
  });

  it('answers everyone else, other drafts and bad requests with the same 404 and stores nothing', async () => {
    const own = await create(users.a, '運営者の下書き2');
    const students = await create(users.b, '学生の下書き');
    const before = await rows();
    const body = JSON.stringify({ verdict: 'good', points: [], note: canary });
    for (const r of [
      // Signed out.
      await http(draftPath(own.id)),
      await http(draftPath(own.id), {
        method: 'PUT',
        body,
        headers: { 'Content-Type': 'application/json' },
      }),
      // A student (not an operator) on their own draft.
      await http(draftPath(students.id), { headers: browser(users.b) }),
      await http(draftPath(students.id), { method: 'PUT', headers: browser(users.b, true), body }),
      // The operator on someone else's draft, and on a draft that does not exist.
      await http(draftPath(students.id), { headers: browser(users.a) }),
      await http(draftPath(students.id), { method: 'PUT', headers: browser(users.a, true), body }),
      await http(draftPath('11111111-1111-4111-8111-111111111111'), { headers: browser(users.a) }),
      await http(draftPath('11111111-1111-4111-8111-111111111111'), {
        method: 'PUT',
        headers: browser(users.a, true),
        body,
      }),
      // A query string, a bad id, a wrong CSRF token, a foreign origin and malformed input.
      await http(draftPath(own.id) + '?x=1', { headers: browser(users.a) }),
      await http(draftPath(own.id) + '?x=1', {
        method: 'PUT',
        headers: browser(users.a, true),
        body,
      }),
      await http(draftPath('not-a-uuid'), { headers: browser(users.a) }),
      await http(draftPath(own.id), {
        method: 'PUT',
        headers: { ...browser(users.a, true), Authorization: 'Bearer csrf.wrong' },
        body,
      }),
      await http(draftPath(own.id), {
        method: 'PUT',
        headers: { ...browser(users.a, true), Origin: 'https://evil.invalid' },
        body,
      }),
      await http(draftPath(own.id), {
        method: 'PUT',
        headers: browser(users.a, true),
        body: JSON.stringify({ verdict: 'good', points: [], note: canary, extra: 1 }),
      }),
    ]) {
      expect(r!.status).toBe(404);
      expect(JSON.parse(r!.body)).toEqual({ error: 'editorial_review_unavailable' });
    }
    expect(await rows()).toBe(before);
    expect(
      (await http(draftPath(own.id), { method: 'DELETE', headers: browser(users.a, true) }))!
        .status,
    ).toBe(405);
    // Closed with the release flag off, like the article reviews.
    expect(
      await http(draftPath(own.id), { headers: browser(users.a), action: 'composed-closed' }),
    ).toBeNull();
    // The trigger refuses a row for another owner's draft even when written directly.
    const db = await mf.getD1Database('DB');
    await expect(
      db
        .prepare(
          "INSERT INTO editorial_draft_reviews(id,reviewer_account_id,draft_id,draft_version,verdict,points_json,note,reviewed_at_ms) VALUES(?,'account-a',?,1,'good','[]','',?)",
        )
        .bind(crypto.randomUUID(), students.id, NOW)
        .run(),
    ).rejects.toThrow(/editorial draft review unavailable/);
    expect(await rows()).toBe(before);
  });

  // Independent verification of 0aaa77a: the count is the operator's own, an inactive account is
  // refused by the trigger, and an expired session gets the same 404.
  it("counts only the operator's own draft reviews and refuses inactive or expired access", async () => {
    const db = await mf.getD1Database('DB');
    const drafts = async () =>
      decodeEditorialTasteSummary(
        JSON.parse(
          (await http('/api/private/editorial-taste', { headers: browser(users.a) }))!.body,
        ),
      )!.reviews.drafts;
    const base = await drafts();
    // Another account's row on its own draft (allowed by the trigger) never joins the count.
    const students = await create(users.b, '学生の下書き2');
    await db
      .prepare(
        "INSERT INTO editorial_draft_reviews(id,reviewer_account_id,draft_id,draft_version,verdict,points_json,note,reviewed_at_ms) VALUES(?,'account-b',?,1,'good','[]','',?)",
      )
      .bind(crypto.randomUUID(), students.id, NOW)
      .run();
    expect(await drafts()).toBe(base);
    // A suspended owner cannot get a row in, even directly.
    await db.batch([
      db
        .prepare(
          "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('account-s','subject-s','s@st.kobedenshi.ac.jp','suspended',?)",
        )
        .bind(NOW),
      db
        .prepare(
          "INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms) VALUES('00000000-0000-4000-8000-0000000271aa','account-s','停止','本文',1,?)",
        )
        .bind(NOW),
    ]);
    await expect(
      db
        .prepare(
          "INSERT INTO editorial_draft_reviews(id,reviewer_account_id,draft_id,draft_version,verdict,points_json,note,reviewed_at_ms) VALUES(?,'account-s','00000000-0000-4000-8000-0000000271aa',1,'good','[]','',?)",
        )
        .bind(crypto.randomUUID(), NOW)
        .run(),
    ).rejects.toThrow(/editorial draft review unavailable/);
    // The operator's session long expired: the same 404 for reading and writing, nothing stored.
    const own = await create(users.a, '期限切れの下書き');
    const before = await rows();
    const later = NOW + 2 * 365 * 24 * 60 * 60 * 1000;
    for (const r of [
      await call<Http>({
        action: 'http',
        now: later,
        url: ORIGIN + draftPath(own.id),
        headers: browser(users.a),
      }),
      await call<Http>({
        action: 'http',
        now: later,
        url: ORIGIN + draftPath(own.id),
        method: 'PUT',
        headers: browser(users.a, true),
        body: JSON.stringify({ verdict: 'good', points: [], note: canary }),
      }),
    ]) {
      expect(r!.status).toBe(404);
      expect(JSON.parse(r!.body)).toEqual({ error: 'editorial_review_unavailable' });
    }
    expect(await rows()).toBe(before);
  });

  it('removes the reviews with the draft', async () => {
    const draft = await create(users.a, '消す下書き');
    await http(draftPath(draft.id), {
      method: 'PUT',
      headers: browser(users.a, true),
      body: JSON.stringify({ verdict: 'ok', points: [], note: '' }),
    });
    const db = await mf.getD1Database('DB');
    const count = () =>
      db
        .prepare('SELECT count(*) n FROM editorial_draft_reviews WHERE draft_id=?')
        .bind(draft.id)
        .first<{ n: number }>();
    expect((await count())!.n).toBe(1);
    await db.prepare('DELETE FROM private_article_drafts WHERE id=?').bind(draft.id).run();
    expect((await count())!.n).toBe(0);
  });

  it('is read by no public or MCP code path (only the operator handler names the table)', () => {
    const names = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? names(dir + '/' + e.name)
          : /\.(ts|tsx|mjs|js)$/.test(e.name)
            ? [dir + '/' + e.name]
            : [],
      );
    const readers = [...names('worker'), ...names('src')].filter((file) =>
      readFileSync(file, 'utf8').includes('editorial_draft_reviews'),
    );
    expect(readers).toEqual(['worker/editorial-reviews-http.ts']);
  });
});

// #274 (second stage of #271): the operator comments on selected passages of their own draft.
describe('editorial draft marks', () => {
  const marksPath = (id: string) => '/api/private/editorial-draft-marks/' + id;
  const canary = 'カナリア箇所コメント-274';
  const mark = { quote: '下書きの中身', prefix: '本文\n', suffix: '', note: canary };
  const create = (who: Session, title: string) =>
    call<{ id: string; version: number }>({
      action: 'create',
      url: ORIGIN + '/private/drafts',
      method: 'POST',
      headers: browser(who, true),
      input: { title, body: '## 本文\n下書きの中身' },
    });
  const rows = async () =>
    (await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT count(*) n FROM editorial_draft_marks')
      .first<{ n: number }>())!.n;
  const add = (who: Session, id: string, body: unknown = mark) =>
    http(marksPath(id), {
      method: 'POST',
      headers: browser(who, true),
      body: JSON.stringify(body),
    });

  it('lets the operator add, list and delete marks on their own draft', async () => {
    const draft = await create(users.a, '箇所コメントの下書き');
    const empty = await http(marksPath(draft.id), { headers: browser(users.a) });
    expect(empty!.status).toBe(200);
    expect(JSON.parse(empty!.body)).toEqual({ marks: [] });
    expect(empty!.headers['cache-control']).toBe('private, no-store');
    const saved = await add(users.a, draft.id);
    expect(saved!.status).toBe(201);
    const first = JSON.parse(saved!.body).mark;
    expect(first).toMatchObject({ ...mark, draftVersion: draft.version });
    expect(Object.keys(first).sort()).toEqual(
      ['createdAt', 'draftVersion', 'id', 'note', 'prefix', 'quote', 'suffix'].sort(),
    );
    const second = JSON.parse(
      (await add(users.a, draft.id, { ...mark, quote: '本文', prefix: '## ', note: canary + '2' }))!
        .body,
    ).mark;
    const listed = await http(marksPath(draft.id), { headers: browser(users.a) });
    expect(decodeEditorialMarkList(JSON.parse(listed!.body))!.map((m) => m.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(listed!.body).not.toContain('account-a');
    // Marks are never edited in place.
    const db = await mf.getD1Database('DB');
    await expect(
      db.prepare("UPDATE editorial_draft_marks SET note='x' WHERE id=?").bind(first.id).run(),
    ).rejects.toThrow(/not edited/);
    // Delete one; deleting it again, or through another draft's path, is the same 404.
    const removed = await http(marksPath(draft.id) + '/' + first.id, {
      method: 'DELETE',
      headers: browser(users.a, true),
    });
    expect(removed!.status).toBe(204);
    const other = await create(users.a, '別の下書き');
    for (const r of [
      await http(marksPath(draft.id) + '/' + first.id, {
        method: 'DELETE',
        headers: browser(users.a, true),
      }),
      await http(marksPath(other.id) + '/' + second.id, {
        method: 'DELETE',
        headers: browser(users.a, true),
      }),
    ])
      expect(r!.status).toBe(404);
    const after = JSON.parse(
      (await http(marksPath(draft.id), { headers: browser(users.a) }))!.body,
    );
    expect(after.marks.map((m: { id: string }) => m.id)).toEqual([second.id]);
  });

  it('answers everyone else, other drafts and bad requests with the same 404 and stores or deletes nothing', async () => {
    const own = await create(users.a, '運営者の箇所下書き');
    const students = await create(users.b, '学生の箇所下書き');
    const kept = JSON.parse((await add(users.a, own.id))!.body).mark as { id: string };
    const before = await rows();
    const body = JSON.stringify(mark);
    const write = (who: Session) => browser(who, true);
    for (const r of [
      // Signed out.
      await http(marksPath(own.id)),
      await http(marksPath(own.id), {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
      }),
      await http(marksPath(own.id) + '/' + kept.id, { method: 'DELETE' }),
      // A student (not an operator) on their own draft.
      await http(marksPath(students.id), { headers: browser(users.b) }),
      await add(users.b, students.id),
      // A student deleting the operator's mark.
      await http(marksPath(own.id) + '/' + kept.id, { method: 'DELETE', headers: write(users.b) }),
      // The operator on someone else's draft, and on a draft that does not exist.
      await http(marksPath(students.id), { headers: browser(users.a) }),
      await add(users.a, students.id),
      await http(marksPath('11111111-1111-4111-8111-111111111111'), { headers: browser(users.a) }),
      await add(users.a, '11111111-1111-4111-8111-111111111111'),
      // A query string, a bad id, an extra path segment, a wrong CSRF token, a foreign origin.
      await http(marksPath(own.id) + '?x=1', { headers: browser(users.a) }),
      await http(marksPath(own.id) + '?x=1', { method: 'POST', headers: write(users.a), body }),
      await http(marksPath(own.id) + '/' + kept.id + '?x=1', {
        method: 'DELETE',
        headers: write(users.a),
      }),
      await http(marksPath('not-a-uuid'), { headers: browser(users.a) }),
      await http(marksPath(own.id) + '/not-a-uuid', { method: 'DELETE', headers: write(users.a) }),
      await http(marksPath(own.id) + '/' + kept.id + '/x', {
        method: 'DELETE',
        headers: write(users.a),
      }),
      await http(marksPath(own.id), {
        method: 'POST',
        headers: { ...write(users.a), Authorization: 'Bearer csrf.wrong' },
        body,
      }),
      await http(marksPath(own.id) + '/' + kept.id, {
        method: 'DELETE',
        headers: { ...write(users.a), Authorization: 'Bearer csrf.wrong' },
      }),
      await http(marksPath(own.id), {
        method: 'POST',
        headers: { ...write(users.a), Origin: 'https://evil.invalid' },
        body,
      }),
      // Malformed input: extra key, empty note, empty quote, too long quote / context / note.
      await add(users.a, own.id, { ...mark, extra: 1 }),
      await add(users.a, own.id, { ...mark, note: '  ' }),
      await add(users.a, own.id, { ...mark, quote: ' ' }),
      await add(users.a, own.id, { ...mark, quote: 'あ'.repeat(201) }),
      await add(users.a, own.id, { ...mark, prefix: 'あ'.repeat(33) }),
      await add(users.a, own.id, { ...mark, note: 'あ'.repeat(501) }),
      await add(users.a, own.id, { ...mark, note: 'a\u0000b' }),
    ]) {
      expect(r!.status).toBe(404);
      expect(JSON.parse(r!.body)).toEqual({ error: 'editorial_review_unavailable' });
    }
    expect(await rows()).toBe(before);
    for (const [p, method, allow] of [
      [marksPath(own.id), 'PUT', 'GET, POST'],
      [marksPath(own.id) + '/' + kept.id, 'GET', 'DELETE'],
    ] as const) {
      const r = await http(p, { method, headers: write(users.a) });
      expect(r!.status).toBe(405);
      expect(r!.headers.allow).toBe(allow);
    }
    // Closed with the release flag off, like the reviews.
    expect(
      await http(marksPath(own.id), { headers: browser(users.a), action: 'composed-closed' }),
    ).toBeNull();
    // The trigger refuses a row for another owner's draft even when written directly.
    const db = await mf.getD1Database('DB');
    await expect(
      db
        .prepare(
          "INSERT INTO editorial_draft_marks(id,reviewer_account_id,draft_id,draft_version,quote,prefix,suffix,note,created_at_ms) VALUES(?,'account-a',?,1,'q','','','n',?)",
        )
        .bind(crypto.randomUUID(), students.id, NOW)
        .run(),
    ).rejects.toThrow(/editorial draft mark unavailable/);
    expect(await rows()).toBe(before);
  });

  it('stops at 100 marks per draft and refuses an expired session', async () => {
    const draft = await create(users.a, '上限の下書き');
    const db = await mf.getD1Database('DB');
    const insert = db.prepare(
      "INSERT INTO editorial_draft_marks(id,reviewer_account_id,draft_id,draft_version,quote,prefix,suffix,note,created_at_ms) VALUES(?,'account-a',?,1,'q','','','n',?)",
    );
    await db.batch(
      Array.from({ length: 99 }, () => insert.bind(crypto.randomUUID(), draft.id, NOW)),
    );
    expect((await add(users.a, draft.id))!.status).toBe(201);
    const full = await add(users.a, draft.id);
    expect(full!.status).toBe(404);
    await expect(insert.bind(crypto.randomUUID(), draft.id, NOW).run()).rejects.toThrow(
      /editorial draft mark unavailable/,
    );
    const listed = JSON.parse(
      (await http(marksPath(draft.id), { headers: browser(users.a) }))!.body,
    );
    expect(listed.marks).toHaveLength(100);
    // Long expired: the same 404 for reading, adding and deleting.
    const own = await create(users.a, '期限切れの箇所下書き');
    const kept = JSON.parse((await add(users.a, own.id))!.body).mark as { id: string };
    const before = await rows();
    const later = NOW + 2 * 365 * 24 * 60 * 60 * 1000;
    for (const [p, method] of [
      [marksPath(own.id), 'GET'],
      [marksPath(own.id), 'POST'],
      [marksPath(own.id) + '/' + kept.id, 'DELETE'],
    ] as const) {
      const r = await call<Http>({
        action: 'http',
        now: later,
        url: ORIGIN + p,
        method,
        headers: method === 'GET' ? browser(users.a) : browser(users.a, true),
        body: method === 'POST' ? JSON.stringify(mark) : undefined,
      });
      expect(r!.status).toBe(404);
    }
    expect(await rows()).toBe(before);
  });

  it('removes the marks with the draft', async () => {
    const draft = await create(users.a, '消す箇所下書き');
    await add(users.a, draft.id);
    const db = await mf.getD1Database('DB');
    const count = () =>
      db
        .prepare('SELECT count(*) n FROM editorial_draft_marks WHERE draft_id=?')
        .bind(draft.id)
        .first<{ n: number }>();
    expect((await count())!.n).toBe(1);
    await db.prepare('DELETE FROM private_article_drafts WHERE id=?').bind(draft.id).run();
    expect((await count())!.n).toBe(0);
  });

  it('is read by no public or MCP code path (only the operator handler names the table)', () => {
    const names = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? names(dir + '/' + e.name)
          : /\.(ts|tsx|mjs|js)$/.test(e.name)
            ? [dir + '/' + e.name]
            : [],
      );
    const readers = [...names('worker'), ...names('src')].filter((file) =>
      readFileSync(file, 'utf8').includes('editorial_draft_marks'),
    );
    expect(readers).toEqual(['worker/editorial-reviews-http.ts']);
  });
});

describe('locateMark', () => {
  it('prefers the occurrence whose context matches and reports a lost passage', () => {
    const text = 'Aの店は安い。Bの店は安い。';
    expect(locateMark(text, { quote: '安い', prefix: 'Bの店は', suffix: '。' })).toEqual({
      start: 11,
      end: 13,
    });
    expect(locateMark(text, { quote: '安い', prefix: '', suffix: '' })).toEqual({
      start: 4,
      end: 6,
    });
    expect(locateMark(text, { quote: '高い', prefix: '', suffix: '' })).toBeNull();
  });
});

describe('bounded JSON body through this route (#287)', () => {
  it('answers 415/400/413 and an empty body as before, at its 16 KiB limit', async () => {
    // A non-operator's valid review passes the reader and gets the route's usual 404.
    await expectBoundedJsonRoute(
      async (body, extra = {}) =>
        (await http(path(articleId), {
          method: 'PUT',
          headers: { ...browser(users.b, true), ...extra },
          ...(body === undefined ? {} : { body }),
        }))!.status,
      { bytes: 16 * 1024, valid: review, accepted: 404 },
    );
  });
});
