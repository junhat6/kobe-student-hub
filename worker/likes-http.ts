import { SessionStore } from './auth/sessions';
import { ArticleLikeStore } from './likes';
import { canonicalOrigin, readBoundedJson } from './http-boundary';
const PREFIX = '/api/private/article-likes';
const LIMIT = 16 * 1024;
// Transport work bound, including zero-byte chunks; distinct from the content byte limit.
const MAX_CHUNKS = 4096;
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
const error = (status: number, code: string) => json({ error: code }, status);
const unavailable = () => error(404, 'like_unavailable');
const input = (request: Request) => readBoundedJson(request, { bytes: LIMIT, chunks: MAX_CHUNKS });
/** Unconnected HTTP boundary. Production must not mount this before the logging/auth gates. */
export function createPrivateLikeHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock);
  const likes = new ArticleLikeStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return null;
    if (!canonicalOrigin(origin)) return error(503, 'like_unavailable');
    const suffix = url.pathname.slice(PREFIX.length);
    if (
      url.search ||
      url.hash ||
      !/^\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(suffix)
    )
      return unavailable();
    const id = suffix.slice(1);
    const allowed = ['GET', 'PUT'];
    if (!allowed.includes(request.method)) {
      const response = error(405, 'method_not_allowed');
      response.headers.set('Allow', allowed.join(', '));
      return response;
    }
    try {
      const authorized =
        request.method === 'GET'
          ? await sessions.authenticate(request)
          : await sessions.authorizeMutation(request);
      if (!authorized) return error(401, 'authentication_required');
      if (request.method === 'GET') {
        const result = await likes.getOwn(request, id);
        return result === null ? unavailable() : json(result);
      }
      const body = await input(request);
      if (!body.ok) return error(body.status, 'invalid_request');
      const result = await likes.setOwn(request, id, body.value);
      return result === null ? unavailable() : json(result);
    } catch {
      return unavailable();
    }
  };
}
