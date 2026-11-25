import { applyFixtureMigrations } from './helpers/migrations';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { ProjectJournal, PublicProjectPage } from '../src/project-types';
import { PROJECT_JOURNAL_LIMIT } from '../src/project-types';

// #273 1段目：公開済みの作品へ、本人の公開記事をあとから「制作日誌」として紐づけ・外す境界。
const ORIGIN = 'https://app.example.invalid',
  NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let a: Session, b: Session;
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
async function draftArticle(title: string, s = a) {
  return (
    await call<{ id: string }>({
      action: 'draft',
      headers: headers(s),
      input: { title, body: '# 架空の日誌本文' },
    })
  ).id;
}
async function article(title: string, s = a) {
  const draft = await draftArticle(title, s);
  return (
    await call<{ contentId: string }>({
      action: 'publish',
      headers: headers(s),
      draft,
      input: {
        expectedVersion: 1,
        confirmPublic: true,
        summary: '今日やったこと',
        tags: ['日誌'],
        audience: '',
        prerequisite: '',
        outcome: '',
        minutes: 2,
      },
    })
  ).contentId;
}
async function project(title: string, s = a, articleIds?: string[]) {
  const draft = await call<{ id: string }>({
    action: 'projectdraft',
    headers: headers(s),
    input: { title, description: '架空の作品説明', githubUrl: '', demoUrl: '' },
  });
  const published = await call<{ projectId: string }>({
    action: 'projectpublish',
    headers: headers(s),
    draft: draft.id,
    input: { expectedVersion: 1, confirmPublic: true, ...(articleIds ? { articleIds } : {}) },
  });
  return { draftId: draft.id, projectId: published.projectId };
}
const journal = (draft: string, s: Session | null = a) =>
  call<ProjectJournal | null>({ action: 'journal', headers: s ? headers(s) : {}, draft });
const link = (draft: string, articleId: unknown, linked = true, s: Session | null = a) =>
  call<ProjectJournal | null>({
    action: 'journalset',
    headers: s ? headers(s) : {},
    draft,
    input: { articleId, linked },
  });
const page = (projectId: string) =>
  call<PublicProjectPage | null>({ action: 'projectpage', target: projectId });
async function rows(projectId?: string) {
  const db = await mf.getD1Database('DB');
  return (
    await db
      .prepare(
        'SELECT project_id,article_id FROM project_journal_links WHERE ?1 IS NULL OR project_id=?1 ORDER BY linked_at_ms',
      )
      .bind(projectId ?? null)
      .all<{ project_id: string; article_id: string }>()
  ).results;
}
let work: { draftId: string; projectId: string },
  theirs: { draftId: string; projectId: string },
  fixed: string,
  first: string,
  second: string,
  others: string;
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
  for (const who of ['a', 'b'])
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('private-' + who, 'subject-' + who, who + '@st.kobedenshi.ac.jp', NOW)
      .run();
  a = await call({ action: 'session', who: 'a' });
  b = await call({ action: 'session', who: 'b' });
  for (const [s, name] of [
    [a, '架空投稿者A'],
    [b, '架空投稿者B'],
  ] as const)
    expect(
      await call({
        action: 'profile',
        headers: headers(s),
        input: { displayName: name, confirmPublic: true },
      }),
    ).not.toBeNull();
  fixed = await article('公開時に紐づけた記事');
  work = await project('日誌を積む作品', a, [fixed]);
  expect(work.projectId).toMatch(/^[0-9a-f-]{36}$/);
  // Published after the project: the case #273 opens up.
  second = await article('日誌 2 日目');
  first = await article('日誌 1 日目');
  others = await article('他人の記事', b);
  // Publication order is the journal order, not the link order.
  await db
    .prepare('UPDATE article_publications SET published_at_ms=? WHERE content_id=?')
    .bind(NOW + 60_000, second)
    .run();
});
afterAll(async () => {
  await mf?.dispose();
});

describe('project journal links (#273)', () => {
  it('starts empty and lists the article fixed at publish time separately', async () => {
    expect(await journal(work.draftId)).toEqual({
      projectId: work.projectId,
      fixedArticleIds: [fixed],
      articleIds: [],
    });
    const value = (await page(work.projectId))!;
    expect(value.articles.map((x) => x.id)).toEqual([fixed]);
    expect(value.journal).toEqual([]);
  });

  it('lets the owner add own public articles later; the page lists them by publication date', async () => {
    expect((await link(work.draftId, second))?.articleIds).toEqual([second]);
    expect((await link(work.draftId, first))?.articleIds.sort()).toEqual([second, first].sort());
    // Linking again is idempotent and writes nothing new.
    expect((await link(work.draftId, first))?.articleIds.sort()).toEqual([second, first].sort());
    expect(await rows()).toHaveLength(2);
    const value = (await page(work.projectId))!;
    expect(Object.keys(value).sort()).toEqual(['articles', 'author', 'journal', 'project']);
    expect(value.journal.map((x) => x.id)).toEqual([first, second]);
    expect(value.journal[0]).toEqual({
      id: first,
      title: '日誌 1 日目',
      publishedOn: '2027-01-15',
    });
    for (const entry of value.journal)
      expect(Object.keys(entry).sort()).toEqual(['id', 'publishedOn', 'title']);
    const wire = JSON.stringify(value);
    for (const denied of [
      'owner_account_id',
      'linked_at_ms',
      'private-a',
      'a@st.kobedenshi.ac.jp',
      'subject-a',
    ])
      expect(wire).not.toContain(denied);
  });

  it('refuses another person’s article, a draft, an unknown id and the fixed article with the same null and no write', async () => {
    const draft = await draftArticle('まだ下書きの日誌');
    for (const id of [others, draft, crypto.randomUUID(), fixed])
      expect(await link(work.draftId, id)).toBeNull();
    for (const bad of ['not-a-uuid', null, 1])
      expect(await link(work.draftId, bad as unknown)).toBeNull();
    expect(
      await call({
        action: 'journalset',
        headers: headers(a),
        draft: work.draftId,
        input: { articleId: first, linked: true, extra: 1 },
      }),
    ).toBeNull();
    expect(await rows()).toHaveLength(2);
  });

  it('refuses another person, an anonymous request and someone else’s project', async () => {
    expect(await journal(work.draftId, b)).toBeNull();
    expect(await journal(work.draftId, null)).toBeNull();
    expect(await link(work.draftId, others, true, b)).toBeNull();
    expect(await link(work.draftId, first, false, b)).toBeNull();
    expect(await link(work.draftId, first, false, null)).toBeNull();
    theirs = await project('他人の作品', b);
    expect(await link(theirs.draftId, first)).toBeNull();
    expect(await journal(theirs.draftId)).toBeNull();
    expect(await rows()).toHaveLength(2);
    expect((await journal(work.draftId))?.articleIds.sort()).toEqual([second, first].sort());
  });

  it('hides a linked article from the page once it stops being public', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE content SET status='hidden' WHERE id=?").bind(second).run();
    expect((await page(work.projectId))!.journal.map((x) => x.id)).toEqual([first]);
    // A stopped article cannot be linked again either.
    expect(await link(work.draftId, second, false)).not.toBeNull();
    expect(await link(work.draftId, second)).toBeNull();
    await db.prepare("UPDATE content SET status='published' WHERE id=?").bind(second).run();
    expect((await link(work.draftId, second))?.articleIds.sort()).toEqual([first, second].sort());
  });

  it('lets the owner remove a journal entry', async () => {
    expect((await link(work.draftId, first, false))?.articleIds).toEqual([second]);
    expect((await page(work.projectId))!.journal.map((x) => x.id)).toEqual([second]);
    expect(await rows()).toEqual([{ project_id: work.projectId, article_id: second }]);
  });

  // Verifier M1・L1 (#273): each trigger condition is checked on its own, below the limit.
  it('the insert trigger refuses a stopped or deleted project and a sample article on their own', async () => {
    const db = await mf.getD1Database('DB');
    const insert = (projectId: string, articleId: string) =>
      db
        .prepare(
          "INSERT INTO project_journal_links(project_id,article_id,owner_account_id,linked_at_ms) VALUES(?,?,'private-a',?)",
        )
        .bind(projectId, articleId, NOW)
        .run();
    const spare = await project('止める作品');
    for (const status of ['hidden', 'deleted']) {
      await db
        .prepare('UPDATE project_publications SET status=? WHERE id=?')
        .bind(status, spare.projectId)
        .run();
      await expect(insert(spare.projectId, first)).rejects.toThrow(/journal link unavailable/);
    }
    expect(await rows(spare.projectId)).toEqual([]);
    const sample = await article('見本扱いの記事');
    await db.prepare('UPDATE content SET is_sample=1 WHERE id=?').bind(sample).run();
    await expect(insert(work.projectId, sample)).rejects.toThrow(/journal link unavailable/);
    // Written straight to the table, the article fixed at publish time is still shown only once.
    await insert(work.projectId, fixed);
    const value = (await page(work.projectId))!;
    expect(value.articles.map((x) => x.id)).toEqual([fixed]);
    expect(value.journal.map((x) => x.id)).toEqual([second]);
    await db
      .prepare('DELETE FROM project_journal_links WHERE project_id=? AND article_id=?')
      .bind(work.projectId, fixed)
      .run();
  });

  it('the insert trigger re-checks ownership, account status, project status and the limit', async () => {
    const db = await mf.getD1Database('DB');
    const insert = (projectId: string, articleId: string, owner = 'private-a') =>
      db
        .prepare(
          'INSERT INTO project_journal_links(project_id,article_id,owner_account_id,linked_at_ms) VALUES(?,?,?,?)',
        )
        .bind(projectId, articleId, owner, NOW)
        .run();
    await expect(insert(work.projectId, others)).rejects.toThrow(/journal link unavailable/);
    await expect(insert(work.projectId, first, 'private-b')).rejects.toThrow(
      /journal link unavailable/,
    );
    await expect(
      db.prepare('UPDATE project_journal_links SET linked_at_ms=linked_at_ms+1').run(),
    ).rejects.toThrow(/immutable project journal link/);
    // A suspended owner cannot link even their own article to their own project (account b is
    // done with its sessions here; suspending a would end the session the later steps use).
    await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='private-b'").run();
    await expect(insert(theirs.projectId, others, 'private-b')).rejects.toThrow(
      /journal link unavailable/,
    );
    await db.prepare("UPDATE private_accounts SET status='active' WHERE id='private-b'").run();
    await insert(theirs.projectId, others, 'private-b');
    // The limit: fill up to PROJECT_JOURNAL_LIMIT links, then one more is refused.
    const extra: string[] = [];
    for (let n = (await rows(work.projectId)).length; n < PROJECT_JOURNAL_LIMIT; n++)
      extra.push(await article('追加の日誌 ' + n));
    for (const id of extra) await insert(work.projectId, id);
    expect(await rows(work.projectId)).toHaveLength(PROJECT_JOURNAL_LIMIT);
    expect(await link(work.draftId, first)).toBeNull();
    await expect(insert(work.projectId, first)).rejects.toThrow(/journal link unavailable/);
    expect((await page(work.projectId))!.journal).toHaveLength(PROJECT_JOURNAL_LIMIT);
    // Removing one makes room again.
    expect((await link(work.draftId, extra[0], false))?.articleIds).toHaveLength(
      PROJECT_JOURNAL_LIMIT - 1,
    );
    expect((await link(work.draftId, first))?.articleIds).toHaveLength(PROJECT_JOURNAL_LIMIT);
  });

  it('a stopped project neither reads nor changes its journal, and its page is gone', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare("UPDATE project_publications SET status='hidden' WHERE id=?")
      .bind(work.projectId)
      .run();
    expect(await journal(work.draftId)).toBeNull();
    expect(await link(work.draftId, first, false)).toBeNull();
    expect(await page(work.projectId)).toBeNull();
    await expect(
      db
        .prepare(
          'INSERT INTO project_journal_links(project_id,article_id,owner_account_id,linked_at_ms) VALUES(?,?,?,?)',
        )
        .bind(work.projectId, fixed, 'private-a', NOW)
        .run(),
    ).rejects.toThrow(/journal link unavailable/);
    await db
      .prepare("UPDATE project_publications SET status='published' WHERE id=?")
      .bind(work.projectId)
      .run();
  });

  it('keeps the project page readable on a database without migration 0046', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare('DROP TABLE project_journal_links').run();
    const value = (await page(work.projectId))!;
    expect(value.journal).toEqual([]);
    expect(value.articles.map((x) => x.id)).toEqual([fixed]);
    expect(await journal(work.draftId)).toBeNull();
  });
});
