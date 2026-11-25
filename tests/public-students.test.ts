import { workerModules } from './helpers/worker-modules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { ArticlePublicationStore } from '../worker/publication';
import { ProjectStore } from '../worker/projects';
import type { PublicStudent, PublicStudentActivity } from '../src/public-student-types';
import { withProjectSnapshotUnlocked } from './helpers/project-snapshot';
import { readPublicStudent } from '../worker/public-students-http';

const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare;
const users: Session[] = [];
const authors: string[] = [];
const articles: string[] = [];
const projects: string[] = [];
function credentials(index: number) {
  const session = users[index];
  return {
    Cookie: [session.setCookie, session.contextCookie].map((v) => v.split(';')[0]).join('; '),
    Origin: ORIGIN,
    Authorization: 'Bearer csrf.' + session.csrfToken,
    'Content-Type': 'application/json',
  };
}
async function request(path: string, method = 'GET', who?: number, body?: unknown, extra = {}) {
  return mf.dispatchFetch(ORIGIN + path, {
    method,
    headers: {
      'X-Test-Ordinary': 'enabled',
      ...(who === undefined ? {} : credentials(who)),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function article(who: number) {
  const draft = await request('/api/private/drafts', 'POST', who, {
    title: 'Public article',
    body: '# Public saved body',
  });
  expect(draft.status).toBe(201);
  const { id } = (await draft.json()) as { id: string };
  const published = await request('/api/private/publications/' + id, 'POST', who, {
    expectedVersion: 1,
    confirmPublic: true,
    summary: 'Public summary',
    tags: [],
    minutes: 1,
  });
  expect(published.status).toBe(201);
  return ((await published.json()) as { contentId: string }).contentId;
}
async function project(who: number) {
  const draft = await request('/api/private/project-drafts', 'POST', who, {
    title: 'Public project',
    description: 'Published project explanation',
    githubUrl: 'https://github.com/example/project',
    demoUrl: '',
  });
  expect(draft.status).toBe(201);
  const { id } = (await draft.json()) as { id: string };
  const published = await request('/api/private/project-publications/' + id, 'POST', who, {
    expectedVersion: 1,
    confirmPublic: true,
  });
  expect(published.status).toBe(201);
  return ((await published.json()) as { projectId: string }).projectId;
}
async function student(index: number) {
  const response = await request('/api/students/' + authors[index]);
  expect(response.status).toBe(200);
  for (const [key, value] of Object.entries({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  }))
    expect(response.headers.get(key)).toBe(value);
  expect(response.headers.has('Set-Cookie')).toBe(false);
  const value = (await response.json()) as PublicStudent;
  expect(Object.keys(value).sort()).toEqual(['author', 'avatar', 'entries', 'projects']);
  expect(value.avatar).toBeNull();
  expect(Object.keys(value.author).sort()).toEqual([
    'bio',
    'department',
    'id',
    'initials',
    'name',
    'year',
  ]);
  expect(JSON.stringify(value)).not.toMatch(
    /private-account|private-subject|st\.kobedenshi|csrfToken|owner_account_id|google_subject|session_epoch|sourceVersion|Public saved body/,
  );
  expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThanOrEqual(262144);
  return value;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/publication-http-test.js'),
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: () => {
        throw Error('Unexpected provider call');
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const name of readdirSync('migrations')
    .filter((v) => v.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + name, 'utf8');
    const statements = raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/);
    for (const statement of statements.map((v) => v.replace(/^--.*$/gm, '').trim()).filter(Boolean))
      await db.prepare(statement).run();
  }
  for (let index = 0; index < 5; index++) {
    await db
      .prepare("INSERT INTO private_accounts VALUES(?,?,?,'active',0,?)")
      .bind('private-account-' + index, 'subject-' + index, index + '@st.kobedenshi.ac.jp', NOW)
      .run();
    const session = await mf.dispatchFetch(ORIGIN + '/fixture/session', {
      headers: { 'X-Test-Who': String(index) },
    });
    users.push((await session.json()) as Session);
    const profile = await request('/api/private/profile', 'POST', index, {
      displayName: 'Public student ' + index,
      bio: 'Explicit public biography',
      confirmPublic: true,
    });
    expect(profile.status).toBe(201);
    authors.push(((await profile.json()) as { profile: { id: string } }).profile.id);
  }
  articles[0] = await article(0);
  projects[1] = await project(1);
  articles[2] = await article(2);
  projects[2] = await project(2);
});
afterAll(async () => mf?.dispose());

describe('ordinary shared public student with actual Workers/D1', () => {
  it('reads article-only and project-only authors while legacy single-kind empty stays null', async () => {
    const a = await student(0),
      p = await student(1);
    expect(a.entries.map((v) => v.id)).toEqual([articles[0]]);
    expect(a.projects).toEqual([]);
    expect(p.entries).toEqual([]);
    expect(p.projects.map((v) => v.id)).toEqual([projects[1]]);
    const db = await mf.getD1Database('DB');
    expect(
      await new ArticlePublicationStore(db, ORIGIN, () => NOW).readPublishedAuthor(authors[1]),
    ).toBeNull();
    expect(await new ProjectStore(db, ORIGIN, () => NOW).readAuthor(authors[0])).toBeNull();
  });
  it('joins both public activities without touching a session or exposing the private draft continuation', async () => {
    const db = await mf.getD1Database('DB');
    const before = (
      await db
        .prepare('SELECT token_hash,last_seen_ms FROM auth_sessions ORDER BY token_hash')
        .all()
    ).results;
    const value = await student(2);
    expect(value.entries.map((v) => v.id)).toEqual([articles[2]]);
    expect(value.projects.map((v) => v.id)).toEqual([projects[2]]);
    expect(
      (
        await db
          .prepare('SELECT token_hash,last_seen_ms FROM auth_sessions ORDER BY token_hash')
          .all()
      ).results,
    ).toEqual(before);
  });
  it('reads the public grass: public publications per Japan day only, nothing private', async () => {
    const response = await request('/api/students/' + authors[2] + '/activity');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('Set-Cookie')).toBe(false);
    const value = (await response.json()) as PublicStudentActivity;
    expect(Object.keys(value).sort()).toEqual(['days', 'from', 'to']);
    const today = new Date(NOW + 9 * 3600000).toISOString().slice(0, 10);
    expect(value.to).toBe(today);
    expect(value.days).toEqual([{ date: today, count: 2 }]);
    expect((Date.parse(value.to) - Date.parse(value.from)) / 86400000 + 1).toBe(182);
    for (const id of [authors[3], 'shun', 'private-account-0', 'subject-0']) {
      const missing = await request('/api/students/' + id + '/activity');
      expect(missing.status).toBe(404);
    }
    const wrong = await request(
      '/api/students/' + authors[2] + '/activity',
      'POST',
      undefined,
      {},
      { 'X-Test-Forbid-Db': '1' },
    );
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('X-Fixture-Db-Calls')).toBe('0');
  });
  it('returns likes received per public article, counted like 人気, with no likers or private ids', async () => {
    const db = await mf.getD1Database('DB');
    // Accounts 1 and 2 have confirmed public profiles; an account without one is not counted.
    await db
      .prepare(
        "INSERT INTO private_accounts VALUES('private-account-noprofile','subject-np','np@st.kobedenshi.ac.jp','active',0,?)",
      )
      .bind(NOW)
      .run();
    for (const owner of ['private-account-1', 'private-account-2', 'private-account-noprofile'])
      await db
        .prepare('INSERT INTO article_likes(owner_account_id,content_id,liked_at_ms) VALUES(?,?,?)')
        .bind(owner, articles[0], NOW)
        .run();
    try {
      const response = await request('/api/students/' + authors[0] + '/received-likes');
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Set-Cookie')).toBe(false);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        articles: [{ id: articles[0], title: 'Public article', likes: 2 }],
      });
      expect(text).not.toMatch(/private-account|subject-|st\.kobedenshi|liked_at|Public student/);
      // A public student with no likes gets an empty list; a non-public id is missing.
      expect(
        await (await request('/api/students/' + authors[2] + '/received-likes')).json(),
      ).toEqual({ articles: [] });
      for (const id of [authors[3], 'shun', 'private-account-0'])
        expect((await request('/api/students/' + id + '/received-likes')).status).toBe(404);
      const wrong = await request(
        '/api/students/' + authors[0] + '/received-likes',
        'POST',
        undefined,
        {},
        { 'X-Test-Forbid-Db': '1' },
      );
      expect(wrong.status).toBe(405);
      expect(wrong.headers.get('X-Fixture-Db-Calls')).toBe('0');
    } finally {
      await db.prepare('DELETE FROM article_likes WHERE content_id=?').bind(articles[0]).run();
    }
  });
  it('adds the owner-only reading layer: counts per day for the signed-in reader, never on public reads', async () => {
    const today = new Date(NOW + 9 * 3600000).toISOString().slice(0, 10);
    expect((await request('/api/private/activity')).status).toBe(401);
    for (const path of ['/api/private/activity?x=1', '/api/private/activity/extra'])
      expect((await request(path, 'GET', 0)).status).toBe(404);
    expect((await request('/api/private/activity', 'POST', 0, {})).status).toBe(405);
    const before = await request('/api/private/activity', 'GET', 0);
    expect(before.status).toBe(200);
    expect(before.headers.get('Cache-Control')).toBe('private, no-store');
    expect(before.headers.get('Vary')).toBe('Cookie');
    expect(((await before.json()) as PublicStudentActivity).days).toEqual([]);
    for (const [kind, contentId] of [
      ['article', articles[2]],
      ['project', projects[2]],
    ]) {
      const viewed = await request('/api/private/reading-history', 'PUT', 0, { kind, contentId });
      expect(viewed.status).toBe(200);
    }
    const own = (await (
      await request('/api/private/activity', 'GET', 0)
    ).json()) as PublicStudentActivity;
    expect(Object.keys(own).sort()).toEqual(['days', 'from', 'to']);
    expect(own.to).toBe(today);
    expect(own.days).toEqual([{ date: today, count: 2 }]);
    // Another account sees only its own (empty) reading, and the public grass is unchanged.
    expect(
      ((await (await request('/api/private/activity', 'GET', 1)).json()) as PublicStudentActivity)
        .days,
    ).toEqual([]);
    expect(
      (
        (await (
          await request('/api/students/' + authors[0] + '/activity')
        ).json()) as PublicStudentActivity
      ).days,
    ).toEqual([{ date: today, count: 1 }]);
    // Deleting the reading history removes the layer.
    expect((await request('/api/private/reading-history', 'DELETE', 0, { all: true })).status).toBe(
      200,
    );
    expect(
      ((await (await request('/api/private/activity', 'GET', 0)).json()) as PublicStudentActivity)
        .days,
    ).toEqual([]);
  });
  it('fails the whole profile for an invalid selected article or project, instead of returning the other side', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare('UPDATE content SET body=? WHERE id=?').bind('\0', articles[2]).run();
    try {
      expect((await request('/api/students/' + authors[2])).status).toBe(503);
    } finally {
      await db
        .prepare('UPDATE content SET body=? WHERE id=?')
        .bind('# Public saved body', articles[2])
        .run();
    }
    await withProjectSnapshotUnlocked(db, () =>
      db
        .prepare('UPDATE project_publications SET github_url=? WHERE id=?')
        .bind('javascript:bad', projects[2])
        .run(),
    );
    try {
      expect((await request('/api/students/' + authors[2])).status).toBe(503);
    } finally {
      await withProjectSnapshotUnlocked(db, () =>
        db
          .prepare('UPDATE project_publications SET github_url=? WHERE id=?')
          .bind('https://github.com/example/project', projects[2])
          .run(),
      );
    }
    expect((await student(2)).entries).toHaveLength(1);
  });
  it('does not publish orphan/sample/private identities and removes an author once both activities stop', async () => {
    expect((await request('/api/students/' + authors[3])).status).toBe(404);
    for (const id of ['shun', 'private-account-0', 'subject-0'])
      expect((await request('/api/students/' + id)).status).toBe(404);
    for (const [kind, id] of [
      ['article', articles[2]],
      ['project', projects[2]],
    ]) {
      const stopped = await request(
        '/api/private/publication-stops/' + kind + '/' + id,
        'POST',
        2,
        { expectedSourceVersion: 1, confirmStop: true },
      );
      expect(stopped.status).toBe(200);
    }
    expect((await request('/api/students/' + authors[2])).status).toBe(404);
    expect((await request('/api/students/' + authors[2] + '/activity')).status).toBe(404);
  });
  it('bounds the selected snapshots at twenty per kind and the combined DTO at262144bytes', async () => {
    for (let i = 0; i < 21; i++) {
      await article(4);
      await project(4);
    }
    const value = await student(4);
    expect(value.entries).toHaveLength(20);
    expect(value.projects).toHaveLength(20);
    expect(new Set(value.entries.map((v) => v.id)).size).toBe(20);
    expect(new Set(value.projects.map((v) => v.id)).size).toBe(20);
  });
  it('keeps disabled, unconfigured and malformed/method/origin paths closed without storage access', async () => {
    const good = '/api/students/' + authors[0];
    for (const extra of [{ 'X-Test-Ordinary': 'disabled' }, { 'X-Test-Production': '1' }]) {
      const r = await request(good, 'GET', undefined, undefined, {
        ...extra,
        'X-Test-Forbid-Db': '1',
      });
      expect(r.status).toBe('X-Test-Production' in extra ? 503 : 418);
      expect(r.headers.get('X-Fixture-Db-Calls')).toBe('0');
    }
    for (const path of [
      '/api/students',
      '/api/students/',
      '/api/students/%2Fbad',
      good + '/extra',
      good + '?q=x',
    ]) {
      const r = await request(path, 'GET', undefined, undefined, { 'X-Test-Forbid-Db': '1' });
      expect(r.status).toBe(404);
      expect(r.headers.get('X-Fixture-Db-Calls')).toBe('0');
    }
    const wrong = await request(good, 'POST', undefined, {}, { 'X-Test-Forbid-Db': '1' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('Allow')).toBe('GET');
    expect(wrong.headers.get('X-Fixture-Db-Calls')).toBe('0');
    const origin = await request(good, 'GET', undefined, undefined, {
      'X-Test-Origin': 'https://other.invalid',
      'X-Test-Forbid-Db': '1',
    });
    expect(origin.status).toBe(404);
    expect(origin.headers.get('X-Fixture-Db-Calls')).toBe('0');
  });
});

// Shared by /api/students and the MCP get_student tool (#294). Both selections read the same
// public_profiles row, so a mismatch only happens when the profile changes between the two reads.
describe('readPublicStudent keeps failed and absent apart', () => {
  const author = (name: string) => ({
    id: 'pub-x',
    name,
    department: '',
    year: '',
    bio: '',
    initials: 'X',
  });
  const entry = { id: 'a', title: 't' } as never;
  const project = { id: 'p', title: 't' } as never;
  const stores = (a: unknown, p: unknown) =>
    [
      { readPublishedAuthorSelection: async () => a } as unknown as ArticlePublicationStore,
      { readAuthorSelection: async () => p } as unknown as ProjectStore,
    ] as const;
  it('fails (null) on a changed author or a failed selection, and is missing only when nothing is public', async () => {
    const both = (an: string, pn: string) =>
      stores({ author: author(an), entries: [entry] }, { author: author(pn), projects: [project] });
    expect(await readPublicStudent(...both('A', 'B'), 'pub-x')).toBeNull();
    expect(await readPublicStudent(...both('A', 'A'), 'pub-x')).toMatchObject({
      author: { name: 'A' },
      entries: [entry],
      projects: [project],
    });
    expect(
      await readPublicStudent(...stores(null, { author: null, projects: [] }), 'pub-x'),
    ).toBeNull();
    expect(
      await readPublicStudent(
        ...stores({ author: null, entries: [] }, { author: null, projects: [] }),
        'pub-x',
      ),
    ).toBe('missing');
  });
});
