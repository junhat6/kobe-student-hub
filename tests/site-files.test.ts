// G05（growth.json）：robots.txt と sitemap.xml。公開の境界を実 D1 で確かめる部分は
// tests/publication-stops.test.ts（公開 → 公開停止 → 非表示で sitemap から消える）にある。
import { describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { STATIC_PAGE_HEADERS } from '../worker/indexable-pages';
import { SITEMAP_LIMIT } from '../worker/site-files';

const ORIGIN = 'https://hub.example.test';
const uuid = (n: number) => `0f8fad5b-d9cb-469f-a165-${n.toString(16).padStart(12, '0')}`;
type Row = { id: unknown; at: unknown };

function environment(
  origin: string | undefined,
  rows: { articles: Row[]; projects: Row[] } | 'fail' = { articles: [], projects: [] },
) {
  const sql: string[] = [];
  const prepare = vi.fn((text: string) => {
    sql.push(text);
    return { text };
  });
  const batch = vi.fn(async (statements: { text: string }[]) => {
    if (rows === 'fail') throw new Error('fixture: D1 down');
    return statements.map((s) => ({
      results: s.text.includes('FROM content c') ? rows.articles : rows.projects,
    }));
  });
  const env = {
    AUTH_ORIGIN: origin,
    DB: { prepare, batch } as unknown as D1Database,
    ASSETS: {
      fetch: async () => new Response('asset', { status: 405 }),
    } as unknown as Fetcher,
  } as unknown as Env;
  return { env, sql, batch };
}

async function get(path: string, fixture: ReturnType<typeof environment>, init: RequestInit = {}) {
  const response = await worker.fetch(new Request(ORIGIN + path, init), fixture.env);
  return { response, text: await response.text() };
}

function expectHeaders(response: Response, type: string) {
  for (const [key, value] of Object.entries(STATIC_PAGE_HEADERS))
    expect(response.headers.get(key), key).toBe(value);
  expect(response.headers.get('Content-Type')).toBe(type);
  expect(response.headers.get('Cache-Control')).toBe('no-cache');
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  expect(response.headers.has('Set-Cookie')).toBe(false);
}

describe('robots.txt', () => {
  it('blocks only /api/ and names the sitemap on the canonical origin', async () => {
    const fixture = environment(ORIGIN);
    const { response, text } = await get('/robots.txt', fixture);
    expect(response.status).toBe(200);
    expectHeaders(response, 'text/plain; charset=utf-8');
    expect(text.match(/^Disallow:.*$/gm)).toEqual(['Disallow: /api/']);
    expect(text).toMatch(/^User-agent: \*$/m);
    expect(text.match(/^Sitemap:.*$/gm)).toEqual([`Sitemap: ${ORIGIN}/sitemap.xml`]);
    expect(fixture.batch).not.toHaveBeenCalled();
  });
  it('names no sitemap on another host or a non-https origin', async () => {
    for (const origin of [undefined, '', 'http://hub.example.test', 'https://hub.example.test/x']) {
      const { response, text } = await get('/robots.txt', environment(origin));
      expect(response.status, String(origin)).toBe(200);
      expect(text).toContain('Disallow: /api/');
      expect(text).not.toContain('Sitemap:');
    }
  });
  it('HEAD has no body and other methods fall through to the static assets', async () => {
    const head = await get('/robots.txt', environment(ORIGIN), { method: 'HEAD' });
    expect(head.response.status).toBe(200);
    expect(head.text).toBe('');
    const post = await get('/robots.txt', environment(ORIGIN), { method: 'POST' });
    expect(post.response.status).toBe(405);
  });
});

describe('sitemap.xml', () => {
  it('lists /, /works, then public articles and projects newest first with lastmod', async () => {
    const fixture = environment(ORIGIN, {
      articles: [
        { id: uuid(1), at: Date.UTC(2026, 10, 20) },
        { id: uuid(2), at: Date.UTC(2026, 10, 25) },
      ],
      projects: [{ id: uuid(3), at: Date.UTC(2026, 10, 22) }],
    });
    const { response, text } = await get('/sitemap.xml', fixture);
    expect(response.status).toBe(200);
    expectHeaders(response, 'application/xml; charset=utf-8');
    expect(text).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `<url><loc>${ORIGIN}/</loc><lastmod>2026-11-25T00:00:00.000Z</lastmod></url>`,
        `<url><loc>${ORIGIN}/works</loc><lastmod>2026-11-22T00:00:00.000Z</lastmod></url>`,
        `<url><loc>${ORIGIN}/articles/${uuid(2)}</loc><lastmod>2026-11-25T00:00:00.000Z</lastmod></url>`,
        `<url><loc>${ORIGIN}/projects/${uuid(3)}</loc><lastmod>2026-11-22T00:00:00.000Z</lastmod></url>`,
        `<url><loc>${ORIGIN}/articles/${uuid(1)}</loc><lastmod>2026-11-20T00:00:00.000Z</lastmod></url>`,
        '</urlset>',
        '',
      ].join('\n'),
    );
    // 記事と作品の境界は別の文で読む（1つの文だと D1 の式の深さの上限を超える。#312）。
    expect(fixture.sql).toHaveLength(2);
    expect(fixture.sql[0]).toContain("c.kind='article' AND c.status='published' AND c.is_sample=0");
    expect(fixture.sql[1]).toContain("r.status='published'");
    for (const text of fixture.sql) expect(text).toMatch(/LIMIT 998$/);
  });
  it('stops at 1000 URLs including / and /works', async () => {
    const rows = (offset: number) =>
      Array.from({ length: 998 }, (_, i) => ({ id: uuid(offset + i), at: 1e12 + offset + i }));
    const { text } = await get(
      '/sitemap.xml',
      environment(ORIGIN, { articles: rows(0), projects: rows(5000) }),
    );
    expect(text.match(/<url>/g)).toHaveLength(SITEMAP_LIMIT);
    // 新しい順に残る：作品（新しい方）が全部入り、古い記事が落ちる。
    expect(text).toContain(`/projects/${uuid(5997)}`);
    expect(text).not.toContain(`/articles/${uuid(0)}<`);
  });
  it('drops ids that the page itself would not index and escapes nothing unsafe into the XML', async () => {
    const { text } = await get(
      '/sitemap.xml',
      environment(ORIGIN, {
        articles: [
          { id: 'sample-article', at: 1 },
          { id: uuid(1).toUpperCase(), at: 1 },
          { id: '<x>&', at: 1 },
          { id: uuid(7), at: 'not a number' },
        ],
        projects: [{ id: null, at: 1 }],
      }),
    );
    expect(text.match(/<url>/g)).toHaveLength(3);
    expect(text).toContain(`<url><loc>${ORIGIN}/articles/${uuid(7)}</loc></url>`);
    expect(text).not.toMatch(/sample|<x>|&(?!#)/);
  });
  it('is not served on another host, and a D1 failure is a 503 rather than an empty sitemap', async () => {
    for (const origin of ['https://kobe-student-hub.example.workers.dev', '', undefined]) {
      const fixture = environment(origin);
      const { response } = await get('/sitemap.xml', fixture);
      expect(response.status, String(origin)).toBe(404);
      expect(fixture.batch).not.toHaveBeenCalled();
    }
    const { response, text } = await get('/sitemap.xml', environment(ORIGIN, 'fail'));
    expect(response.status).toBe(503);
    expect(text).not.toContain('<urlset');
  });
});
