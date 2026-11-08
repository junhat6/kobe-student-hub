import { workerModules } from './helpers/worker-modules';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createPublicArticleHandler } from '../worker/public-articles-http';
import { ArticlePublicationStore } from '../worker/publication';
import { sampleCatalog } from '../src/sample';
import type { Entry, Profile, PublicDiscovery, PublicLikedArticles } from '../src/types';

const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
const metadata = {
  expectedVersion: 1,
  confirmPublic: true,
  summary: 'Public summary',
  tags: [],
  minutes: 3,
};
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare;
let users: Session[];
let draftId: string;
let articleId: string;
let authorId: string;

function credentials(session: Session) {
  return {
    Cookie: [session.setCookie, session.contextCookie]
      .map((value) => value.split(';')[0])
      .join('; '),
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
      ...(who === undefined ? {} : credentials(users[who])),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function publicHeaders(response: { headers: Pick<Headers, 'get' | 'has'> }) {
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  for (const name of ['Set-Cookie', 'Location', 'Access-Control-Allow-Origin', 'Vary']) {
    expect(response.headers.has(name)).toBe(false);
  }
}

function noPrivateFields(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /account-[0-9]|subject-[0-9]|st\.kobedenshi|token_hash|csrfToken|session_epoch|owner_account_id|google_subject|reporter_account_id|claim_owner|private-enrollment-marker/,
  );
}

async function publish(title: string, body = '# Saved public body') {
  const created = await request('/api/private/drafts', 'POST', 0, { title, body });
  expect(created.status).toBe(201);
  const draft = (await created.json()) as { id: string };
  const published = await request('/api/private/publications/' + draft.id, 'POST', 0, metadata);
  expect(published.status).toBe(201);
  return {
    draftId: draft.id,
    articleId: ((await published.json()) as { contentId: string }).contentId,
  };
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
    .filter((value) => value.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + name, 'utf8');
    const statements = raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/);
    for (const statement of statements
      .map((value) => value.replace(/^--.*$/gm, '').trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  users = [];
  for (let index = 0; index < 4; index++) {
    await db
      .prepare("INSERT INTO private_accounts VALUES(?,?,?,'active',0,?)")
      .bind('account-' + index, 'subject-' + index, index + '@st.kobedenshi.ac.jp', NOW)
      .run();
    const response = await mf.dispatchFetch(ORIGIN + '/fixture/session', {
      headers: { 'X-Test-Who': String(index) },
    });
    users.push((await response.json()) as Session);
  }
  const profile = await request('/api/private/profile', 'POST', 0, {
    displayName: 'Explicit public author',
    department: 'Manual department',
    yearLabel: 'Manual year',
    bio: 'Explicit public biography',
    confirmPublic: true,
  });
  expect(profile.status).toBe(201);
  authorId = ((await profile.json()) as { profile: { id: string } }).profile.id;
  ({ draftId, articleId } = await publish('Saved publication'));
});

afterAll(async () => mf?.dispose());

describe('ordinary publication composition with actual local Workers/D1', () => {
  it('does not open routes or query storage while disabled or behind the production source gates', async () => {
    const paths = [
      '/api/articles',
      '/api/articles/' + articleId,
      '/api/authors/' + authorId,
      '/api/authors/' + authorId + '/likes',
      '/api/private/profile',
      '/api/private/publications/' + draftId,
      '/api/private/own-publications',
      '/api/private/publication-stops/article/' + articleId,
      '/api/private/reports/' + articleId,
      '/api/private/article-likes/' + articleId,
      '/api/private/drafts',
      '/api/private/moderation/cases',
      '/api/private/moderation/cases/' + articleId + '/decision',
    ];
    for (const path of paths) {
      for (const method of ['GET', 'POST']) {
        const disabled = await request(path, method, undefined, undefined, {
          'X-Test-Ordinary': 'disabled',
          'X-Test-Forbid-Db': '1',
        });
        expect(disabled.status, path).toBe(418);
        expect(disabled.headers.get('X-Fixture-Db-Calls')).toBe('0');
        const production = await request(path, method, undefined, undefined, {
          'X-Test-Production': '1',
          'X-Test-Forbid-Db': '1',
        });
        expect(production.status, path).toBe(405);
        expect(production.headers.get('X-Fixture-Db-Calls')).toBe('0');
        expect(production.headers.has('Set-Cookie')).toBe(false);
      }
    }
    const catalog = await request('/api/catalog', 'GET', undefined, undefined, {
      'X-Test-Production': '1',
    });
    const value = (await catalog.json()) as { entries: Entry[]; profiles: Profile[] };
    expect(value.entries).toHaveLength(4);
    expect(value.profiles).toHaveLength(2);
    expect(value.entries.some((entry) => entry.id === articleId)).toBe(false);
  });

  it('delivers the saved snapshot, bounded discovery and author DTO without session or private identity', async () => {
    const receipt = await request('/api/private/publications/' + draftId, 'GET', 0);
    const saved = (await receipt.json()) as { publication: { entry: Entry; author: Profile } };
    const db = await mf.getD1Database('DB');
    const before = (
      await db
        .prepare('SELECT token_hash,last_seen_ms FROM auth_sessions ORDER BY token_hash')
        .all()
    ).results;
    for (const path of [
      '/api/articles/' + articleId,
      '/api/articles',
      '/api/authors/' + authorId,
    ]) {
      const response = await request(path, 'GET', undefined, undefined, {
        Cookie: 'invalid-untrusted-cookie',
        Authorization: 'Bearer untrusted',
        'X-Test-Now': String(NOW + 1000),
      });
      expect(response.status).toBe(200);
      publicHeaders(response);
      const value = await response.json();
      noPrivateFields(value);
      if (path === '/api/articles/' + articleId)
        expect(value).toEqual(
          saved.publication && {
            entry: saved.publication.entry,
            author: saved.publication.author,
          },
        );
      else if (path === '/api/articles')
        expect((value as PublicDiscovery).cards.map((card) => card.entry.id)).toEqual([articleId]);
      else expect((value as { author: Profile }).author.id).toBe(authorId);
    }
    expect(
      (
        await db
          .prepare('SELECT token_hash,last_seen_ms FROM auth_sessions ORDER BY token_hash')
          .all()
      ).results,
    ).toEqual(before);
    expect((await request('/api/private/publications/' + draftId, 'GET', 1)).status).toBe(404);
    expect((await request('/api/private/profile')).status).toBe(401);
    expect(
      (await request('/api/private/publications/' + draftId, 'POST', undefined, metadata)).status,
    ).toBe(401);
  });

  it('reuses owner records, stopping and likes while keeping operator case reads unmounted', async () => {
    for (const path of [
      '/api/private/own-publications',
      '/api/private/publication-stops/article/' + articleId,
    ]) {
      const response = await request(path, 'GET', 0);
      expect(response.status).toBe(200);
      noPrivateFields(await response.json());
    }
    const like = await request('/api/private/article-likes/' + articleId, 'PUT', 0, {
      liked: true,
      confirmPublic: true,
    });
    expect(like.status).toBe(200);
    const response = await request('/api/authors/' + authorId + '/likes');
    publicHeaders(response);
    const liked = (await response.json()) as PublicLikedArticles;
    expect(liked.profile.id).toBe(authorId);
    expect(liked.entries.map((entry) => entry.id)).toEqual([articleId]);
    noPrivateFields(liked);
    const session = await request('/api/private/moderation/session', 'GET', 0);
    expect(await session.json()).toEqual({ csrfToken: users[0].csrfToken });
    for (const path of [
      '/api/private/moderation/cases',
      '/api/private/moderation/cases/' + articleId,
    ]) {
      const operator = await request(path, 'GET', 0, undefined, { 'X-Test-Forbid-Db': '1' });
      expect(operator.status).toBe(418);
      expect(operator.headers.get('X-Fixture-Db-Calls')).toBe('0');
    }
  });

  it('rejects malformed paths, query, unsupported methods and origins before public storage work', async () => {
    const invalid = [
      '/api/articles/',
      '/api/articles/not-a-uuid',
      '/api/articles/' + articleId + '/likes',
      '/api/authors',
      '/api/authors/',
      '/api/authors/%61',
      '/api/authors/' + 'a'.repeat(129),
      '/api/articles?code=PRIVATE_CANARY',
      '/api/authors/' + authorId + '?state=PRIVATE_CANARY',
    ];
    for (const path of invalid) {
      const response = await request(path, 'GET', undefined, undefined, {
        'X-Test-Forbid-Db': '1',
      });
      expect(response.status, path).toBe(404);
      publicHeaders(response);
      expect(response.headers.get('X-Fixture-Db-Calls')).toBe('0');
      expect(await response.text()).not.toContain('PRIVATE_CANARY');
    }
    for (const path of [
      '/api/articles',
      '/api/articles/' + articleId,
      '/api/authors/' + authorId,
      '/api/authors/' + authorId + '/likes',
    ]) {
      for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
        const response = await request(path, method, undefined, undefined, {
          'X-Test-Forbid-Db': '1',
        });
        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe('GET');
        expect(response.headers.get('X-Fixture-Db-Calls')).toBe('0');
      }
    }
    const badOrigin = await request('/api/articles', 'GET', undefined, undefined, {
      'X-Test-Origin': 'http://invalid.example',
      'X-Test-Forbid-Db': '1',
    });
    expect(badOrigin.status).toBe(503);
    expect(badOrigin.headers.get('X-Fixture-Db-Calls')).toBe('0');
  });

  it('refuses oversized or hidden stored content without reflecting it or claiming an empty feed', async () => {
    const db = await mf.getD1Database('DB');
    try {
      await db
        .prepare('UPDATE content SET body=? WHERE id=?')
        .bind('x'.repeat(262145), articleId)
        .run();
      for (const [path, status] of [
        ['/api/articles/' + articleId, 404],
        ['/api/articles', 503],
        ['/api/authors/' + authorId, 404],
      ] as const) {
        const response = await request(path);
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error: 'publication_unavailable' });
      }
    } finally {
      await db
        .prepare('UPDATE content SET body=? WHERE id=?')
        .bind('# Saved public body', articleId)
        .run();
    }
    try {
      await db.prepare("UPDATE content SET status='hidden' WHERE id=?").bind(articleId).run();
      expect((await request('/api/articles/' + articleId)).status).toBe(404);
      const response = await request('/api/articles');
      expect(response.status).toBe(200);
      expect(((await response.json()) as PublicDiscovery).cards).toEqual([]);
    } finally {
      await db.prepare("UPDATE content SET status='published' WHERE id=?").bind(articleId).run();
    }
  });

  it('connects reports through the existing three-reporter hide rule and owner stop through existing guards', async () => {
    const reported = await publish('Report target');
    for (let reporter = 1; reporter <= 3; reporter++) {
      const response = await request(
        '/api/private/reports/' + reported.articleId,
        'POST',
        reporter,
        { reason: 'Public article issue', detail: '' },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
    }
    expect((await request('/api/articles/' + reported.articleId)).status).toBe(404);
    const feed = (await (await request('/api/articles')).json()) as PublicDiscovery;
    expect(feed.cards.some((card) => card.entry.id === reported.articleId)).toBe(false);
    const stopped = await publish('Owner stop target');
    const receipt = await request(
      '/api/private/publication-stops/article/' + stopped.articleId,
      'GET',
      0,
    );
    const value = (await receipt.json()) as Record<string, unknown>;
    expect(receipt.status).toBe(200);
    noPrivateFields(value);
    const path = '/api/private/publication-stops/article/' + stopped.articleId;
    const input = { expectedSourceVersion: 1, confirmStop: true };
    expect((await request(path, 'POST', 1, input)).status).toBe(404);
    const stop = await request(path, 'POST', 0, input);
    expect(stop.status).toBe(200);
    expect((await stop.json()) as { stopped: boolean }).toMatchObject({ stopped: true });
    expect((await request('/api/articles/' + stopped.articleId)).status).toBe(404);
  });
  it('mounts configured operator routes only for the server-selected authenticated actor', async () => {
    const config = { 'X-Test-Operators': '["account-0"]' };
    expect(
      (
        await request('/api/private/reports/' + articleId, 'POST', 1, {
          reason: 'Configured operator case',
          detail: '',
        })
      ).status,
    ).toBe(200);
    const response = await request('/api/private/moderation/cases', 'GET', 0, undefined, config);
    expect(response.status).toBe(200);
    noPrivateFields(await response.json());
    const path = '/api/private/moderation/cases/' + articleId + '/decision';
    expect((await request(path, 'GET', 0, undefined, config)).status).toBe(200);
    expect((await request(path, 'GET', 1, undefined, config)).status).toBe(404);
    const absent = await request(path, 'GET', 0, undefined, { 'X-Test-Forbid-Db': '1' });
    expect(absent.status).toBe(418);
    expect(absent.headers.get('X-Fixture-Db-Calls')).toBe('0');
  });
});

describe('public reader transport edge cases', () => {
  it('rejects a fragment-bearing synthetic Request without any database access', async () => {
    let calls = 0;
    const db = new Proxy({} as D1Database, {
      get() {
        calls++;
        throw Error('Unexpected DB access');
      },
    });
    const response = await createPublicArticleHandler(
      db,
      ORIGIN,
    )(new Request(ORIGIN + '/api/articles#PRIVATE_CANARY'));
    expect(response?.status).toBe(404);
    expect(calls).toBe(0);
    expect(await response!.text()).not.toContain('PRIVATE_CANARY');
  });

  it('bounds the HTTP body even if an unexpected oversized repository result reaches it', async () => {
    const spy = vi.spyOn(ArticlePublicationStore.prototype, 'readPublished').mockResolvedValue({
      entry: { ...sampleCatalog.entries[0], body: 'x'.repeat(3 * 1024 * 1024) },
      author: sampleCatalog.profiles[0],
    });
    try {
      const response = await createPublicArticleHandler(
        {} as D1Database,
        ORIGIN,
      )(new Request(ORIGIN + '/api/articles/11111111-1111-4111-8111-111111111111'));
      expect(response?.status).toBe(404);
      expect(await response!.json()).toEqual({ error: 'publication_unavailable' });
    } finally {
      spy.mockRestore();
    }
  });
});
