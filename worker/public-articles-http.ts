import { ArticlePublicationStore } from './publication';
import { ArticleLikeStore } from './likes';

const ARTICLES = '/api/articles';
const AUTHORS = '/api/authors';
const ARTICLE_BYTES = 2 * 1024 * 1024;
const LIST_BYTES = 256 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const articlePath = new RegExp('^/api/articles/(' + UUID + ')$');
const authorPath = /^\/api\/authors\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})(\/likes)?$/;
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers });
}

function canonicalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin;
  } catch {
    return false;
  }
}

/** Anonymous HTTP delivery of the existing record-backed public projections. */
export function createPublicArticleHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const publications = new ArticlePublicationStore(db, origin, clock);
  const likes = new ArticleLikeStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    const articleRoute = url.pathname === ARTICLES || url.pathname.startsWith(ARTICLES + '/');
    const authorRoute = url.pathname === AUTHORS || url.pathname.startsWith(AUTHORS + '/');
    if (!articleRoute && !authorRoute) return null;

    const unavailable = () => json({ error: 'publication_unavailable' }, 404);
    if (!canonicalOrigin(origin)) return json({ error: 'publication_unavailable' }, 503);
    if (url.origin !== origin || url.search || url.hash) return unavailable();

    const recent = url.pathname === ARTICLES;
    const article = articlePath.exec(url.pathname);
    const author = authorPath.exec(url.pathname);
    if (!recent && !article && !author) return unavailable();
    if (request.method !== 'GET') {
      const response = json({ error: 'method_not_allowed' }, 405);
      response.headers.set('Allow', 'GET');
      return response;
    }

    try {
      const result = recent
        ? await publications.readRecentPublished()
        : article
          ? await publications.readPublished(article[1])
          : author![2]
            ? await likes.readPublic(author![1])
            : await publications.readPublishedAuthor(author![1]);
      if (result === null) {
        return recent ? json({ error: 'publication_unavailable' }, 503) : unavailable();
      }
      const body = JSON.stringify(result);
      const limit = article ? ARTICLE_BYTES : LIST_BYTES;
      if (new TextEncoder().encode(body).byteLength > limit) {
        return recent ? json({ error: 'publication_unavailable' }, 503) : unavailable();
      }
      return new Response(body, { headers });
    } catch {
      return recent ? json({ error: 'publication_unavailable' }, 503) : unavailable();
    }
  };
}
