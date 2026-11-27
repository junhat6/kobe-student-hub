// G03（docs/DECISIONS.md 2026-11-28）：検索エンジンに載せてよいページだけを worker が返す。
// 列挙するのは /、/works、公開記事 /articles/:id、公開作品 /projects/:id。ほかの画面は静的配信
// （public/_headers の X-Robots-Tag と index.html の meta）で従来どおり noindex のまま。
// 公開かどうかは公開 API と同じ読み取り（記事 readPublished・作品 readPublishedPage）で決め、読めなければ noindex に倒す。
// G04：載せる記事・作品のページは、同じ読み取りの値で head のメタ情報（題・概要・canonical・OGP・X カード）も書き換える。
// 停止・存在しないページは既定のメタ情報（index.html のサイト全体の1種類）のまま。
import { canonicalOrigin } from './http-boundary';
import { ArticlePublicationStore } from './publication';
import { ProjectStore } from './projects';
import { CardImageStore } from './card-images';
import { projectDescriptionPreview } from './project-preview';
import { DESCRIPTION_CHARS, metaText, withPageMeta, type PageMeta } from './page-meta';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const articlePath = new RegExp('^/articles/(' + UUID + ')$');
const projectPath = new RegExp('^/projects/(' + UUID + ')$');
const idPattern = new RegExp('^' + UUID + '$');
/** 記事・作品のページとして index しうる ID の形（sitemap も同じ形だけを載せる）。 */
export const isIndexableId = (id: unknown): id is string =>
  typeof id === 'string' && idPattern.test(id);
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

type Listing = { meta?: PageMeta } | null;

/** 載せるなら、記事・作品ページはそのメタ情報（G04）も返す。載せないなら null。 */
async function indexable(url: URL, env: Bindings): Promise<Listing> {
  const origin = env.AUTH_ORIGIN ?? '';
  // 本番の正規の origin だけ。workers.dev などの別名は重複として載せない。
  if (!canonicalOrigin(origin) || url.origin !== origin || !onlyCampaignQuery(url)) return null;
  if (url.pathname === '/' || url.pathname === '/works') return {};
  const page = origin + url.pathname;
  const article = articlePath.exec(url.pathname);
  if (article) {
    const value = await new ArticlePublicationStore(env.DB, origin).readPublished(article[1]);
    if (!value) return null;
    const image = await cardImage(env.DB, origin, [value.entry.id], []);
    return { meta: listingMeta(value.entry.title, value.entry.summary, page, image) };
  }
  const project = projectPath.exec(url.pathname);
  if (project) {
    const value = await new ProjectStore(env.DB, origin).readPublishedPage(project[1]);
    if (!value) return null;
    const image = await cardImage(env.DB, origin, [], [value.project.id]);
    const description = projectDescriptionPreview(value.project.description);
    return { meta: listingMeta(value.project.title, description, page, image) };
  }
  return null;
}

function listingMeta(title: string, summary: string, url: string, image?: string): PageMeta {
  const description = metaText(summary, DESCRIPTION_CHARS);
  return {
    title,
    // 要約が空なら既定の説明文を残すより、題を説明に使う（ページごとに違う説明にする）。
    description: description || metaText(title, DESCRIPTION_CHARS),
    url,
    ...(image ? { image } : {}),
  };
}

/** 一覧のカードと同じ選び方・同じ公開 media の grant で選んだ画像の絶対 URL。読めなければ画像なし。 */
async function cardImage(db: D1Database, origin: string, articles: string[], projects: string[]) {
  try {
    const paths = await new CardImageStore(db, origin).readPublicPaths(articles, projects);
    const path = paths.get(articles[0] ?? projects[0]!);
    return path ? origin + path : undefined;
  } catch {
    return undefined;
  }
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
  const listing = await indexable(url, env);
  if (listing) {
    html = html.replace(ROBOTS_META, '');
    if (listing.meta) html = withPageMeta(html, listing.meta);
  } else headers.set('X-Robots-Tag', NOINDEX);
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
}
