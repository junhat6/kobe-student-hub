// G03（growth.json）：検索エンジンに載せてよいページの列挙。公開の有無を実 D1 で確かめる部分は
// tests/publication-stops.test.ts（公開 → 公開停止 → 非表示）にある。
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { INDEXABLE_ROUTES, STATIC_PAGE_HEADERS } from '../worker/indexable-pages';
import { SITE_FILE_ROUTES } from '../worker/site-files';
import { withPageMeta, metaText } from '../worker/page-meta';
import { SITE_TITLE } from '../src/useServedHead';

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
      // G04 条件4：読めない記事・作品は既定のメタ情報（サイト全体の1種類）のまま。
      expect(html, path).toBe(INDEX_HTML);
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
    const all = headers.slice(headers.indexOf('/*\n')).split(/\n(?=\/)/)[0];
    expect(all.match(/^ {2}[A-Za-z-]+:/gm)).toHaveLength(
      Object.keys(STATIC_PAGE_HEADERS).length + 1,
    );
    // The writing kit is shown as text, never downloaded by the browser (Safe Browsing, 2026-11-28).
    expect(headers).toMatch(
      /^\/agent-kit\/\*\.py\n {2}Content-Type: text\/plain; charset=utf-8\n {2}Content-Disposition: inline$/m,
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
    expect(pages).toEqual([...INDEXABLE_ROUTES, ...SITE_FILE_ROUTES]);
    // 本番の設定が同じ列を使うことは tests/production-wrangler.test.ts が確かめる。
  });
  it('robots.txt is written by the worker, not a static file that would shadow it', () => {
    expect(existsSync('public/robots.txt')).toBe(false);
  });
});

// G04：記事・作品ページの head。公開 DTO から値を選ぶ部分は tests/publication-stops.test.ts（実 D1）。
describe('page meta', () => {
  const head = (html: string) => html.slice(0, html.indexOf('</head>'));
  const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
  it('replaces the site-wide title, description, OGP and card with the page values', () => {
    const html = withPageMeta(INDEX_HTML, {
      title: 'Unity で作る 2D アクション',
      description: '当たり判定の作り方',
      url: ORIGIN + '/articles/' + ID,
    });
    const h = head(html);
    expect(h).toContain('<title>Unity で作る 2D アクション | Kobe Student Hub</title>');
    expect(h).toContain('<meta name="description" content="当たり判定の作り方" />');
    expect(h).toContain(`<link rel="canonical" href="${ORIGIN}/articles/${ID}" />`);
    expect(h).toContain('<meta property="og:title" content="Unity で作る 2D アクション" />');
    expect(h).toContain('<meta property="og:description" content="当たり判定の作り方" />');
    expect(h).toContain(`<meta property="og:url" content="${ORIGIN}/articles/${ID}" />`);
    expect(h).toContain('<meta property="og:type" content="article" />');
    expect(h).toContain('<meta name="twitter:card" content="summary" />');
    expect(h).not.toContain('og:image');
    // 既定の1種類は残らず、各タグは1つだけ。サイト名・ロケール・robots などは index.html のまま。
    for (const key of ['description', 'og:title', 'og:description', 'og:type', 'twitter:card'])
      expect(count(h, new RegExp(`(?:name|property)="${key}"`, 'g')), key).toBe(1);
    expect(count(h, /<title>/g)).toBe(1);
    expect(h).not.toContain('学生の知恵と、つくる日々');
    expect(h).toContain('og:site_name');
    expect(h).toMatch(META);
    expect(html.slice(html.indexOf('</head>'))).toBe(
      INDEX_HTML.slice(INDEX_HTML.indexOf('</head>')),
    );
  });
  it('the client resets to the same site-wide title as index.html', () => {
    expect(INDEX_HTML).toContain(`<title>${SITE_TITLE}</title>`);
  });
  it('a card picture becomes og:image with the large card', () => {
    const h = head(
      withPageMeta(INDEX_HTML, {
        title: 't',
        description: 'd',
        url: ORIGIN + '/projects/' + ID,
        image: ORIGIN + '/api/media/' + ID,
      }),
    );
    expect(h).toContain(`<meta property="og:image" content="${ORIGIN}/api/media/${ID}" />`);
    expect(h).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });
  it('escapes every value and never reads them as replacement patterns', () => {
    const evil = `</title><script>alert("x")</script> & 'q' $' $& $\``;
    const h = head(
      withPageMeta(INDEX_HTML, { title: evil, description: evil, url: ORIGIN + '/articles/' + ID }),
    );
    expect(h).not.toContain('<script>');
    expect(h).not.toContain('"x"');
    expect(h).toContain(
      '&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39; $&#39; $&amp; $`',
    );
    expect(count(h, /<title>/g)).toBe(1);
    expect(count(h, /<\/head>/g)).toBe(0);
  });
  it('cuts long text to one line by characters', () => {
    expect(metaText('  a\n\tb  ', 10)).toBe('a b');
    expect(metaText('あ'.repeat(130), 120)).toBe('あ'.repeat(119) + '…');
    expect(Array.from(metaText('😀'.repeat(200), 120))).toHaveLength(120);
  });
});
