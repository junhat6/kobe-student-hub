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
async function project(title: string, description: string, session = a, articleIds?: string[]) {
  const draft = await call<{ id: string }>({
    action: 'projectdraft',
    headers: headers(session),
    input: { title, description, githubUrl: '', demoUrl: '' },
  });
  return (
    await call<{ projectId: string }>({
      action: 'projectpublish',
      headers: headers(session),
      draft: draft.id,
      input: { expectedVersion: 1, confirmPublic: true, ...(articleIds ? { articleIds } : {}) },
    })
  )?.projectId;
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
  it('excludes hidden/deleted content while keeping existing published snapshots independent of target-account participation', async () => {
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
    const inactiveWork = await project('AIで作った別の作品', '公開された作品の説明', b);
    const mapping = await db
      .prepare('SELECT public_profile_id FROM account_public_profiles WHERE owner_account_id=?')
      .bind('private-b')
      .first<{ public_profile_id: string }>();
    try {
      await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='private-b'").run();
      const check = async () => {
        expect(await call({ action: 'read', target: other })).not.toBeNull();
        expect((await related())!.articles.some((row) => row.entry.id === other)).toBe(true);
        expect((await related())!.projects.some((row) => row.project.id === inactiveWork)).toBe(
          true,
        );
        expect((await home())!.recent.some((row) => row.entry.id === other)).toBe(true);
        expect((await related(other))!.articles.some((row) => row.entry.id === source)).toBe(true);
      };
      await check();
      await db
        .prepare('DELETE FROM account_public_profiles WHERE owner_account_id=?')
        .bind('private-b')
        .run();
      await check();
    } finally {
      await db.prepare("UPDATE private_accounts SET status='active' WHERE id='private-b'").run();
      await db
        .prepare(
          'INSERT OR IGNORE INTO account_public_profiles(owner_account_id,public_profile_id) VALUES(?,?)',
        )
        .bind('private-b', mapping!.public_profile_id)
        .run();
    }
  });
  it('rejects a nonpublic source and returns honest empty for no matching tags', async () => {
    const empty = await article('タグなし', []);
    expect(await related(empty)).toEqual({ articles: [], projects: [], linkedProjects: [] });
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
  it('rejects a popular-only article hidden immediately before the final snapshot', async () => {
    const before = (await home())!;
    expect(before.recent.some((row) => row.entry.id === source)).toBe(false);
    expect(before.popular.some((row) => row.entry.id === source)).toBe(true);
    const db = await mf.getD1Database('DB');
    try {
      const result = await call<{ value: OrdinaryDiscovery | null; mutationApplied: boolean }>({
        action: 'home',
        finalMutation: { kind: 'hide', target: source },
      });
      expect(result.mutationApplied).toBe(true);
      expect(result.value).toBeNull();
    } finally {
      await db.prepare("UPDATE content SET status='published' WHERE id=?").bind(source).run();
    }
  });
  it('validates popular card fields, public author fields and like counts in the final snapshot', async () => {
    const db = await mf.getD1Database('DB');
    const before = (await home())!;
    const selected = before.popular.find((row) => row.entry.id === source)!;
    const originalLike = (await db
      .prepare(
        "SELECT owner_account_id,content_id,liked_at_ms FROM article_likes WHERE owner_account_id='private-c' AND content_id=?",
      )
      .bind(source)
      .first<{ owner_account_id: string; content_id: string; liked_at_ms: number }>())!;
    expect(originalLike).not.toBeNull();
    for (const kind of ['title', 'profile-name', 'unlike'] as const) {
      try {
        const result = await call<{ value: OrdinaryDiscovery | null; mutationApplied: boolean }>({
          action: 'home',
          finalMutation: { kind, target: kind === 'profile-name' ? selected.author.id : source },
        });
        expect(result.mutationApplied, kind).toBe(true);
        expect(result.value, kind).toBeNull();
      } finally {
        if (kind === 'title')
          await db
            .prepare('UPDATE content SET title=? WHERE id=?')
            .bind(selected.entry.title, source)
            .run();
        else if (kind === 'profile-name')
          await db
            .prepare('UPDATE public_profiles SET display_name=? WHERE id=?')
            .bind(selected.author.name, selected.author.id)
            .run();
        else
          await db
            .prepare(
              'INSERT INTO article_likes(owner_account_id,content_id,liked_at_ms) VALUES(?,?,?) ON CONFLICT(owner_account_id,content_id) DO UPDATE SET liked_at_ms=excluded.liked_at_ms',
            )
            .bind(originalLike.owner_account_id, originalLike.content_id, originalLike.liked_at_ms)
            .run();
      }
    }
  });
  it('checks related target tags and both source publication revisions at the final snapshot', async () => {
    const raceSource = await article('Snapshot source', ['SnapshotTag']);
    const raceTarget = await article('Snapshot target', ['SnapshotTag']);
    const db = await mf.getD1Database('DB');
    const before = (await related(raceSource))!;
    expect(before.articles.map((row) => row.entry.id)).toEqual([raceTarget]);
    const versions = await db
      .prepare(
        'SELECT content_id,source_version FROM article_publications WHERE content_id IN (?,?)',
      )
      .bind(raceSource, raceTarget)
      .all<{ content_id: string; source_version: number }>();
    for (const [kind, target] of [
      ['tags', raceTarget],
      ['source-version', raceTarget],
      ['source-version', raceSource],
    ] as const) {
      try {
        const result = await call<{ value: RelatedDiscovery | null; mutationApplied: boolean }>({
          action: 'related',
          target: raceSource,
          finalMutation: { kind, target },
        });
        expect(result.mutationApplied, kind + target).toBe(true);
        expect(result.value, kind + target).toBeNull();
      } finally {
        await db
          .prepare('UPDATE content SET tags_json=? WHERE id=?')
          .bind('["SnapshotTag"]', raceTarget)
          .run();
        for (const row of versions.results)
          await db
            .prepare('UPDATE article_publications SET source_version=? WHERE content_id=?')
            .bind(row.source_version, row.content_id)
            .run();
      }
    }
  });
  it('rejects related project text changed after its public projection', async () => {
    const raceSource = await article('Project snapshot source', ['ProjectSnapshotTag']);
    const description = 'ProjectSnapshotTagを使う公開作品の説明';
    const raceWork = await project('Snapshot project', description);
    const db = await mf.getD1Database('DB');
    expect((await related(raceSource))!.projects.map((row) => row.project.id)).toEqual([raceWork]);
    try {
      const result = await call<{ value: RelatedDiscovery | null; mutationApplied: boolean }>({
        action: 'related',
        target: raceSource,
        finalMutation: { kind: 'project-description', target: raceWork },
      });
      expect(result.mutationApplied).toBe(true);
      expect(result.value).toBeNull();
    } finally {
      await db
        .prepare('UPDATE project_publications SET description=? WHERE id=?')
        .bind(description, raceWork)
        .run();
    }
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
describe('owner-linked project ↔ article', () => {
  type Page = { project: { id: string }; articles: { id: string; title: string }[] } | null;
  const page = (target: string) => call<Page>({ action: 'projectpage', target });
  it('links only own published articles and shows the link in both directions', async () => {
    const own = await article('作品の設計記録', ['リンク専用タグ']);
    const second = await article('作品のふりかえり', []);
    expect(own).toMatch(/^[0-9a-f-]{36}$/);
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('private-d','subject-d','d@st.kobedenshi.ac.jp','active',?)",
      )
      .bind(NOW)
      .run();
    const d = await call<Session>({ action: 'session', who: 'd' });
    expect(
      await call({
        action: 'profile',
        headers: headers(d),
        input: { displayName: '架空投稿者D', confirmPublic: true },
      }),
    ).not.toBeNull();
    const foreign = await article('別の人の記事', ['リンク専用タグ'], d);
    // Another author's article, duplicates, more than three and malformed IDs are refused.
    expect(await project('他人の記事を紐づけた作品', '説明', a, [foreign])).toBeUndefined();
    expect(await project('重複', '説明', a, [own, own])).toBeUndefined();
    expect(await project('多すぎ', '説明', a, [own, second, own, second])).toBeUndefined();
    expect(await project('不正', '説明', a, ['not-a-uuid'])).toBeUndefined();
    expect(await project('空配列', '説明', a, [])).toBeUndefined();
    const linkedWork = await project('記事とつながる作品', 'タグとは無関係の説明', a, [
      own,
      second,
    ]);
    expect(linkedWork).toMatch(/^[0-9a-f-]{36}$/);
    expect((await page(linkedWork!))!.articles).toEqual([
      { id: own, title: '作品の設計記録' },
      { id: second, title: '作品のふりかえり' },
    ]);
    const plain = await project('記事なしの作品', '説明');
    expect((await page(plain!))!.articles).toEqual([]);
    const fromOwn = (await related(own))!;
    expect(fromOwn.linkedProjects.map((row) => row.project.id)).toEqual([linkedWork]);
    expect(fromOwn.projects.some((row) => row.project.id === linkedWork)).toBe(false);
    expect(fromOwn.linkedProjects[0]).not.toHaveProperty('matchingTag');
    // An untagged article still shows the owner link.
    expect((await related(second))!.linkedProjects.map((row) => row.project.id)).toEqual([
      linkedWork,
    ]);
    // The other author's article never lists this project.
    expect((await related(foreign))!.linkedProjects).toEqual([]);
    // A stopped (hidden) article disappears from the project page; the project stays public.
    await db.prepare("UPDATE content SET status='hidden' WHERE id=?").bind(second).run();
    expect((await page(linkedWork!))!.articles.map((row) => row.id)).toEqual([own]);
    // A hidden project disappears from the article side.
    await db
      .prepare("UPDATE project_publications SET status='hidden' WHERE id=?")
      .bind(linkedWork)
      .run();
    expect((await related(own))!.linkedProjects).toEqual([]);
    expect(await page(linkedWork!)).toBeNull();
    // The snapshot's links are immutable.
    await expect(
      db
        .prepare("UPDATE project_publications SET article_ids_json='[]' WHERE id=?")
        .bind(linkedWork)
        .run(),
    ).rejects.toThrow();
  });
});

describe('ordinary recent order follows the latest public revision', () => {
  const meta = {
    summary: '改稿の順序',
    tags: ['改稿'],
    audience: '',
    prerequisite: '',
    outcome: '',
    minutes: 2,
  };
  async function publishAt(title: string, at: number) {
    const draft = await call<{ id: string }>({
      action: 'draft',
      headers: headers(a),
      at,
      input: { title, body: '# Fictional body' },
    });
    const published = await call<{ contentId: string }>({
      action: 'publish',
      headers: headers(a),
      draft: draft.id,
      at,
      input: { expectedVersion: 1, confirmPublic: true, ...meta },
    });
    return { draft: draft.id, id: published.contentId };
  }
  it('moves a revised article above newer first publications', async () => {
    const older = await publishAt('先に公開した記事', 1000);
    const newer = await publishAt('後に公開した記事', 2000);
    const ids = () => home().then((value) => value!.recent.map((card) => card.entry.id));
    expect((await ids()).slice(0, 2)).toEqual([newer.id, older.id]);
    expect(
      await call({
        action: 'draftupdate',
        headers: headers(a),
        draft: older.draft,
        at: 3000,
        input: { title: '先に公開した記事（改稿）', body: '# Revised', expectedVersion: 1 },
      }),
    ).not.toBeNull();
    expect(
      await call({
        action: 'publish',
        headers: headers(a),
        draft: older.draft,
        at: 3000,
        input: {
          expectedVersion: 2,
          expectedPublicationVersion: 1,
          confirmPublic: true,
          ...meta,
        },
      }),
    ).toEqual({ contentId: older.id });
    const recent = (await home())!.recent;
    expect(recent.slice(0, 2).map((card) => card.entry.id)).toEqual([older.id, newer.id]);
    expect(recent[0].entry.title).toBe('先に公開した記事（改稿）');
    // The visible card dates never go up while reading down the list.
    const dates = recent.map((card) => card.entry.updatedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
