// G05（growth.json）：検索エンジン向けの robots.txt と sitemap.xml を worker が返す。
// sitemap に載せるのは G03 の列挙（worker/indexable-pages.ts）と同じ /・/works・公開記事・公開作品だけ。
// 公開かどうかは公開 API と同じ SQL の境界（publicArticleSqlBounds・publicProjectSqlBounds）で決め、
// 取得のたびに読む（公開停止した記事は次の取得から出ない）。
import { canonicalOrigin } from './http-boundary';
import { STATIC_PAGE_HEADERS, isIndexableId } from './indexable-pages';
import { publicArticleSqlBounds } from './publication';
import { publicProjectSqlBounds } from './projects';

/** wrangler の run_worker_first に足すパス（wrangler.jsonc・scripts/production-wrangler.mjs）。 */
export const SITE_FILE_ROUTES = ['/robots.txt', '/sitemap.xml'] as const;
/** sitemap の URL の上限（/ と /works を含む）。sitemaps.org の上限 50,000 よりずっと小さく保つ。 */
export const SITEMAP_LIMIT = 1000;
const ITEM_LIMIT = SITEMAP_LIMIT - 2;

type Bindings = { DB: D1Database; ASSETS: Fetcher; AUTH_ORIGIN?: string };
type Item = { path: string; at: number | null };

function headers(type: string): Headers {
  const h = new Headers(STATIC_PAGE_HEADERS);
  h.set('Content-Type', type);
  // 公開停止を次の取得に映すため、毎回確かめさせる。sitemap 自体は検索結果に出さない。
  h.set('Cache-Control', 'no-cache');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  return h;
}

/** robots.txt：/api/ だけを止める。Sitemap の行は正規の https origin のときだけ（別名の host は載せない）。 */
export function robotsTxt(origin: string): string {
  const lines = [
    '# Kobe Student Hub — 検索エンジンに載せるのは /・/works・公開記事・公開作品だけ（ほかのページは noindex を返す）。',
    '# クロール自体は止めない：止めると noindex を読めず、URL だけが検索結果に残ることがあるため。',
    'User-agent: *',
    'Disallow: /api/',
  ];
  if (canonicalOrigin(origin)) lines.push(`Sitemap: ${origin}/sitemap.xml`);
  return lines.join('\n') + '\n';
}

const lastmod = (at: number | null) =>
  at !== null && Number.isSafeInteger(at) && at > 0 && at < 8.64e15
    ? `<lastmod>${new Date(at).toISOString()}</lastmod>`
    : '';
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function publicItems(db: D1Database): Promise<{ articles: Item[]; projects: Item[] }> {
  // 記事と作品の境界は1つの文に並べない（D1 の式の深さの上限を超える。#312）。
  const [articles, projects] = await db.batch([
    db.prepare(
      `SELECT c.id id,COALESCE((SELECT MAX(revision.published_at_ms) FROM article_publication_revisions revision WHERE revision.content_id=c.id),publication.published_at_ms) at FROM content c JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id WHERE ${publicArticleSqlBounds} ORDER BY at DESC,c.id ASC LIMIT ${ITEM_LIMIT}`,
    ),
    db.prepare(
      `SELECT r.id id,r.published_at_ms at FROM project_publications r JOIN public_profiles p ON p.id=r.public_profile_id WHERE ${publicProjectSqlBounds} ORDER BY at DESC,r.id ASC LIMIT ${ITEM_LIMIT}`,
    ),
  ]);
  const read = (result: D1Result, prefix: string): Item[] =>
    (result.results as { id: unknown; at: unknown }[])
      // G03 の判定と同じ形の ID だけ（index されない URL を sitemap に載せない）。
      .filter((r) => isIndexableId(r.id))
      .map((r) => ({
        path: prefix + (r.id as string),
        at: typeof r.at === 'number' ? r.at : null,
      }));
  return { articles: read(articles, '/articles/'), projects: read(projects, '/projects/') };
}

const newest = (items: Item[]) =>
  items.reduce<number | null>(
    (max, i) => (i.at !== null && (max === null || i.at > max) ? i.at : max),
    null,
  );

export async function sitemapXml(db: D1Database, origin: string): Promise<string> {
  const { articles, projects } = await publicItems(db);
  const items = [...articles, ...projects]
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || (a.path < b.path ? -1 : 1))
    .slice(0, ITEM_LIMIT);
  const all: Item[] = [
    { path: '/', at: newest(items) },
    { path: '/works', at: newest(projects) ?? newest(items) },
    ...items,
  ];
  const base = escapeXml(origin);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    all.map((i) => `<url><loc>${base}${i.path}</loc>${lastmod(i.at)}</url>`).join('\n') +
    '\n</urlset>\n'
  );
}

/** /robots.txt と /sitemap.xml を返す。対象外のパスは null。 */
export async function siteFile(request: Request, env: Bindings): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/robots.txt' && url.pathname !== '/sitemap.xml') return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);
  const origin = env.AUTH_ORIGIN ?? '';
  const head = request.method === 'HEAD';
  if (url.pathname === '/robots.txt')
    return new Response(head ? null : robotsTxt(origin), {
      headers: headers('text/plain; charset=utf-8'),
    });
  // 正規の origin 以外（workers.dev などの別名）には sitemap を出さない。G03 と同じ。
  if (!canonicalOrigin(origin) || url.origin !== origin)
    return new Response(head ? null : 'Not Found', {
      status: 404,
      headers: headers('text/plain; charset=utf-8'),
    });
  let xml: string;
  try {
    xml = await sitemapXml(env.DB, origin);
  } catch {
    // 読めないときは空の sitemap を返さない（空だと「載せるページが無い」と読まれる）。
    return new Response(head ? null : 'Service Unavailable', {
      status: 503,
      headers: headers('text/plain; charset=utf-8'),
    });
  }
  return new Response(head ? null : xml, { headers: headers('application/xml; charset=utf-8') });
}
