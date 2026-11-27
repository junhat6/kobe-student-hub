// G03（docs/DECISIONS.md 2026-11-28）：検索エンジンに載せてよいページだけを worker が返す。
// 列挙するのは /、/works、公開記事 /articles/:id、公開作品 /projects/:id。ほかの画面は静的配信
// （public/_headers の X-Robots-Tag と index.html の meta）で従来どおり noindex のまま。
// 公開かどうかは公開 API と同じ読み取り（記事 readPublished・作品 readPublishedPage）で決め、読めなければ noindex に倒す。
import { canonicalOrigin } from './http-boundary';
import { ArticlePublicationStore } from './publication';
import { ProjectStore } from './projects';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const articlePath = new RegExp('^/articles/(' + UUID + ')$');
const projectPath = new RegExp('^/projects/(' + UUID + ')$');
const NOINDEX = 'noindex, nofollow';
const ROBOTS_META = /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>\s*/;

/**
 * public/_headers の `/*` と同じ値（tests/indexable-pages.test.ts が突き合わせる）。
 * worker が返す HTML にも静的配信と同じ security headers を付ける。X-Robots-Tag はページごとに決める。
 */
export const STATIC_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.google.com/maps/embed https://www.instagram.com/p/; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** wrangler の run_worker_first に足すパス（wrangler.jsonc・scripts/production-wrangler.mjs）。 */
export const INDEXABLE_ROUTES = ['/', '/works', '/articles/*', '/projects/*'] as const;

export function isIndexableRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/works' ||
    pathname.startsWith('/articles/') ||
    pathname.startsWith('/projects/')
  );
}

/** 計測の utm_ だけは同じページとして扱う。検索語（q・tag・kind）など他のクエリは noindex。 */
function onlyCampaignQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) if (!key.startsWith('utm_')) return false;
  return true;
}

type Bindings = { DB: D1Database; ASSETS: Fetcher; AUTH_ORIGIN?: string };

async function indexable(url: URL, env: Bindings): Promise<boolean> {
  const origin = env.AUTH_ORIGIN ?? '';
  // 本番の正規の origin だけ。workers.dev などの別名は重複として載せない。
  if (!canonicalOrigin(origin) || url.origin !== origin || !onlyCampaignQuery(url)) return false;
  if (url.pathname === '/' || url.pathname === '/works') return true;
  const article = articlePath.exec(url.pathname);
  if (article)
    return (await new ArticlePublicationStore(env.DB, origin).readPublished(article[1])) !== null;
  const project = projectPath.exec(url.pathname);
  if (project)
    return (await new ProjectStore(env.DB, origin).readPublishedPage(project[1])) !== null;
  return false;
}

/** 列挙したページの HTML（index.html）を返す。対象外のパスは null。 */
export async function indexablePage(request: Request, env: Bindings): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isIndexableRoute(url.pathname)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);
  // 条件つき取得（If-None-Match）を渡さない：載せるかどうかが変わっても 304 で古い判定が残らないように。
  const asset = await env.ASSETS.fetch(new Request(new URL('/', url)));
  const headers = new Headers(STATIC_PAGE_HEADERS);
  headers.set('Content-Type', asset.headers.get('Content-Type') ?? 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-cache');
  if (!asset.ok) {
    headers.set('X-Robots-Tag', NOINDEX);
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      status: asset.status,
      headers,
    });
  }
  let html = await asset.text();
  if (await indexable(url, env)) html = html.replace(ROBOTS_META, '');
  else headers.set('X-Robots-Tag', NOINDEX);
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
}
