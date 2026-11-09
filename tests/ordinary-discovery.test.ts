import { applyFixtureMigrations } from './helpers/migrations';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { OrdinaryDiscovery, RelatedDiscovery } from '../src/community/discovery-types';
const ORIGIN = 'https://app.example.invalid',
  NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let a: Session, b: Session, c: Session;
let source: string, other: string, unrelated: string, work: string;
const headers = (s: Session) => ({
  Cookie: [s.setCookie, s.contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + s.csrfToken,
});
async function call<T>(input: object): Promise<T> {
  return (await (
    await mf.dispatchFetch('https://fixture.test', { method: 'POST', body: JSON.stringify(input) })
  ).json()) as T;
}
async function article(title: string, tags = ['AI'], s = a) {
  const draft = await call<{ id: string }>({
    action: 'draft',
    headers: headers(s),
    input: { title, body: '# Public fictional body' },
  });
  return (
    await call<{ contentId: string }>({
      action: 'publish',
      headers: headers(s),
      draft: draft.id,
      input: {
        expectedVersion: 1,
        confirmPublic: true,
        summary: '比較した条件と結果',
        tags,
        audience: '',
        prerequisite: '',
        outcome: '',
        minutes: 2,
      },
    })
  ).contentId;
}
async function project(title: string, description: string) {
  const draft = await call<{ id: string }>({
    action: 'projectdraft',
    headers: headers(a),
    input: { title, description, githubUrl: '', demoUrl: '' },
  });
  return (
    await call<{ projectId: string }>({
      action: 'projectpublish',
      headers: headers(a),
      draft: draft.id,
      input: { expectedVersion: 1, confirmPublic: true },
    })
  ).projectId;
}
const home = (extra = {}) => call<OrdinaryDiscovery | null>({ action: 'home', ...extra });
const related = (target = source) => call<RelatedDiscovery | null>({ action: 'related', target });
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/ordinary-discovery-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  await applyFixtureMigrations(db);
  for (const who of ['a', 'b', 'c'])
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('private-' + who, 'subject-' + who, who + '@st.kobedenshi.ac.jp', NOW)
      .run();
  a = await call({ action: 'session', who: 'a' });
  b = await call({ action: 'session', who: 'b' });
  c = await call({ action: 'session', who: 'c' });
  for (const [s, name] of [
    [a, '架空投稿者A'],
    [b, '架空投稿者B'],
    [c, '架空投稿者C'],
  ] as const)
    expect(
      await call({
        action: 'profile',
        headers: headers(s),
        input: { displayName: name, confirmPublic: true },
      }),
    ).not.toBeNull();
});
afterAll(async () => {
  await mf?.dispose();
});
describe('ordinary anonymous new/popular/tag discovery', () => {
  it('starts empty without fabricated popularity', async () => {
    expect(await home()).toEqual({ recent: [], popular: [] });
  });
  it('returns only explicit minimal cards, newest publication first', async () => {
    source = await article('AI判断の記録');
    other = await article('AI比較の結果', ['AI'], b);
    unrelated = await article('デザインの記録', ['デザイン']);
    const db = await mf.getD1Database('DB');
    await db
      .prepare('UPDATE article_publications SET published_at_ms=? WHERE content_id=?')
      .bind(NOW + 2, other)
      .run();
    const value = (await home())!;
    expect(value.recent[0].entry.id).toBe(other);
    expect(value.popular).toEqual([]);
    expect(value.recent).toHaveLength(3);
    const wire = JSON.stringify(value);
    for (const denied of [
      'body',
      'bio',
      'email',
      'google_subject',
      'owner_account_id',
      'liked_at_ms',
      'private-a',
    ])
      expect(wire).not.toContain('"' + denied + '"');
  });
  it('ranks actual active-profile likes and reports exact counts', async () => {
    for (const [s, id] of [
      [a, other],
      [b, source],
      [c, source],
    ] as const)
      expect(
        await call({
          action: 'like',
          headers: headers(s),
          target: id,
          input: { liked: true, confirmPublic: true },
        }),
      ).toEqual({ liked: true });
    expect((await home())!.popular.map((value) => [value.entry.id, value.likeCount])).toEqual([
      [source, 2],
      [other, 1],
    ]);
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='private-c'").run();
    expect((await home())!.popular.map((value) => [value.entry.id, value.likeCount])).toEqual([
      [other, 1],
      [source, 1],
    ]);
    await db.prepare("UPDATE private_accounts SET status='active' WHERE id='private-c'").run();
  });
  it('relates exact article tags and honestly matches project title/description', async () => {
    work = await project('AIによる作品', '比較した制作の記録');
    await project('別の作品', '関係のない公開説明');
    const value = (await related())!;
    expect(value.articles.map((row) => row.entry.id)).toEqual([other]);
    expect(value.articles[0].matchingTag).toBe('AI');
    expect(value.projects.map((row) => row.project.id)).toEqual([work]);
    expect(value.projects[0].matchingTag).toBe('AI');
    expect(JSON.stringify(value)).not.toContain('Public fictional body');
  });
  it('does not recommend unpublished, hidden, deleted or inactive-owner articles and projects', async () => {
    const db = await mf.getD1Database('DB');
    for (const status of ['hidden', 'deleted']) {
      await db.prepare('UPDATE content SET status=? WHERE id=?').bind(status, other).run();
      await db
        .prepare('UPDATE project_publications SET status=? WHERE id=?')
        .bind(status, work)
        .run();
      const value = (await related())!;
      expect(value.articles).toEqual([]);
      expect(value.projects).toEqual([]);
      expect((await home())!.popular.some((row) => row.entry.id === other)).toBe(false);
    }
    await db.prepare("UPDATE content SET status='published' WHERE id=?").bind(other).run();
    await db
      .prepare("UPDATE project_publications SET status='published' WHERE id=?")
      .bind(work)
      .run();
    await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='private-b'").run();
    expect((await related())!.articles).toEqual([]);
    expect((await home())!.recent.some((row) => row.entry.id === other)).toBe(false);
    await db.prepare("UPDATE private_accounts SET status='active' WHERE id='private-b'").run();
  });
  it('rejects a nonpublic source and returns honest empty for no matching tags', async () => {
    const empty = await article('タグなし', []);
    expect(await related(empty)).toEqual({ articles: [], projects: [] });
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE content SET status='hidden' WHERE id=?").bind(source).run();
    expect(await related()).toBeNull();
    await db.prepare("UPDATE content SET status='published' WHERE id=?").bind(source).run();
  });
  it('fails closed on a final-read hide race or database error', async () => {
    expect(await home({ fault: true })).toBeNull();
    expect(await home({ hideAfterSelection: true })).toBeNull();
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE content SET status='published' WHERE is_sample=0").run();
  });
  it('keeps old liked articles discoverable beyond the recent twenty', async () => {
    for (let i = 0; i < 21; i++) {
      const id = await article('AI追加記事' + i);
      await (
        await mf.getD1Database('DB')
      )
        .prepare('UPDATE article_publications SET published_at_ms=? WHERE content_id=?')
        .bind(NOW + 100 + i, id)
        .run();
    }
    const value = (await home())!;
    expect(value.recent).toHaveLength(20);
    expect(value.recent.some((row) => row.entry.id === source)).toBe(false);
    expect(value.popular[0].entry.id).toBe(source);
    expect((await related())!.articles).toHaveLength(4);
  });
  it('rejects uncanonical HTTP variants and methods without setting identity cookies', async () => {
    const ok = await mf.dispatchFetch(ORIGIN + '/api/discovery');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(ok.headers.get('Set-Cookie')).toBeNull();
    for (const path of [
      '/api/discovery?x=1',
      '/api/discovery/',
      '/api/discovery/articles/not-an-id',
    ])
      expect((await mf.dispatchFetch(ORIGIN + path)).status).toBe(404);
    expect((await mf.dispatchFetch(ORIGIN + '/api/discovery', { method: 'POST' })).status).toBe(
      405,
    );
    expect((await mf.dispatchFetch('https://wrong.invalid/api/discovery')).status).toBe(404);
  });
});
