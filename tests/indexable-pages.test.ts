// G03（growth.json）：検索エンジンに載せてよいページの列挙。公開の有無を実 D1 で確かめる部分は
// tests/publication-stops.test.ts（公開 → 公開停止 → 非表示）にある。
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { INDEXABLE_ROUTES, STATIC_PAGE_HEADERS } from '../worker/indexable-pages';

const ORIGIN = 'https://hub.example.test';
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const INDEX_HTML = readFileSync('index.html', 'utf8');
const META = /<meta\s+name="robots"\s+content="noindex,nofollow"/;

function environment(origin: string | undefined = ORIGIN) {
  const assetRequests: Request[] = [];
  const prepare = vi.fn(() => {
    throw new Error('fixture: no published content');
  });
  const env = {
    AUTH_ORIGIN: origin,
    DB: { prepare } as unknown as D1Database,
    ASSETS: {
      async fetch(input: Request) {
        assetRequests.push(input);
        return new Response(INDEX_HTML, {
          headers: {
            'Content-Type': 'text/html',
            ETag: '"fixture"',
            'X-Robots-Tag': 'noindex, nofollow',
          },
        });
      },
    } as unknown as Fetcher,
  } as unknown as Env;
  return { env, assetRequests, prepare };
}

async function page(path: string, init: RequestInit = {}, origin?: string) {
  const fixture = environment(origin);
  const response = await worker.fetch(new Request(ORIGIN + path, init), fixture.env);
  return { response, html: await response.text(), ...fixture };
}

function expectStaticHeaders(response: Response) {
  for (const [key, value] of Object.entries(STATIC_PAGE_HEADERS))
    expect(response.headers.get(key), key).toBe(value);
  expect(response.headers.has('ETag')).toBe(false);
  expect(response.headers.has('Set-Cookie')).toBe(false);
}

describe('listed public pages', () => {
  it('/ and /works are indexable on the canonical origin, with the static security headers', async () => {
    for (const path of ['/', '/works', '/?utm_source=x&utm_medium=social']) {
      const { response, html, prepare } = await page(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('X-Robots-Tag'), path).toBeNull();
      expect(html, path).not.toMatch(META);
      expect(html, path).toContain('<div id="root">');
      expectStaticHeaders(response);
      expect(prepare).not.toHaveBeenCalled();
    }
  });
  it('search results, other hosts and unreadable articles/projects stay noindex', async () => {
    const cases: [string, string | undefined][] = [
      ['/?q=unity', ORIGIN],
      ['/?tag=web&utm_source=x', ORIGIN],
      ['/works?kind=project', ORIGIN],
      ['/', 'https://kobe-student-hub.example.workers.dev'],
      ['/', ''],
      ['/', 'http://hub.example.test'],
      [`/articles/${ID}`, ORIGIN],
      [`/projects/${ID}`, ORIGIN],
      [`/articles/${ID.toUpperCase()}`, ORIGIN],
      ['/articles/not-a-uuid', ORIGIN],
      [`/articles/${ID}/extra`, ORIGIN],
      ['/projects/', ORIGIN],
    ];
    for (const [path, origin] of cases) {
      const { response, html } = await page(path, {}, origin);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('X-Robots-Tag'), `${path} ${origin}`).toBe('noindex, nofollow');
      expect(html, path).toMatch(META);
      expectStaticHeaders(response);
    }
  });
  it('HEAD answers the same headers without a body and never forwards conditional headers', async () => {
    const { response, html, assetRequests } = await page('/works', {
      method: 'HEAD',
      headers: { 'If-None-Match': '"fixture"', Cookie: 'a=b' },
    });
    expect(response.status).toBe(200);
    expect(html).toBe('');
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
    expect(assetRequests).toHaveLength(1);
    expect(assetRequests[0].method).toBe('GET');
    expect(assetRequests[0].headers.has('If-None-Match')).toBe(false);
    expect(assetRequests[0].headers.has('Cookie')).toBe(false);
  });
});

describe('the list itself', () => {
  it('index.html and public/_headers keep noindex as the default for every other page', () => {
    expect(INDEX_HTML).toMatch(META);
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toMatch(/^\/\*$/m);
    expect(headers).toContain('X-Robots-Tag: noindex, nofollow');
    // worker が付ける security headers は静的配信と同じ値。
    for (const [key, value] of Object.entries(STATIC_PAGE_HEADERS))
      expect(headers).toContain(`  ${key}: ${value}\n`);
    expect(headers.match(/^ {2}[A-Za-z-]+:/gm)).toHaveLength(
      Object.keys(STATIC_PAGE_HEADERS).length + 1,
    );
  });
  it('only the listed pages reach the worker before the static assets', () => {
    const local = JSON.parse(readFileSync('wrangler.jsonc', 'utf8')) as {
      assets: { run_worker_first: string[] };
    };
    const pages = local.assets.run_worker_first.filter(
      (p) =>
        !p.startsWith('/api/') &&
        !p.startsWith('/.well-known/') &&
        !/^\/(mcp|trial-assets)/.test(p),
    );
    expect(pages).toEqual([...INDEXABLE_ROUTES]);
    // 本番の設定が同じ列を使うことは tests/production-wrangler.test.ts が確かめる。
  });
  it('robots.txt still lets crawlers read the noindex pages and keeps /api/ out', () => {
    const robots = readFileSync('public/robots.txt', 'utf8');
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
    expect(robots.match(/^Disallow:/gm)).toHaveLength(1);
  });
});
