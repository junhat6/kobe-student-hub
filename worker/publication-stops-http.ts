import { SessionStore } from './auth/sessions';
import { PublicationStopStore } from './publication-stops';
import { canonicalOrigin, readBoundedJson } from './http-boundary';
const PREFIX = '/api/private/publication-stops';
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
const unavailable = () => error(404, 'publication_stop_unavailable');
const input = (request: Request) => readBoundedJson(request, { bytes: LIMIT, chunks: MAX_CHUNKS });
/** Unconnected local owner-stop boundary. */
export function createPrivatePublicationStopHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock),
    store = new PublicationStopStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const u = new URL(request.url);
    if (!u.pathname.startsWith(PREFIX)) return null;
    if (!canonicalOrigin(origin)) return error(503, 'publication_stop_unavailable');
    const m =
      /^\/api\/private\/publication-stops\/(article|project)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(
        u.pathname,
      );
    if (!m || u.search || u.hash) return unavailable();
    if (!['GET', 'POST'].includes(request.method)) {
      const r = error(405, 'method_not_allowed');
      r.headers.set('Allow', 'GET, POST');
      return r;
    }
    try {
      const auth = await sessions.inspect(request);
      if (auth.kind === 'unavailable') return error(503, 'publication_stop_unavailable');
      if (
        auth.kind !== 'authenticated' ||
        (request.method === 'POST' && !(await sessions.authorizeMutation(request)))
      )
        return error(401, 'authentication_required');
      let result;
      if (request.method === 'GET') result = await store.getOwn(request, m[1], m[2]);
      else {
        const body = await input(request);
        if (!body.ok) return error(body.status, 'invalid_request');
        result = await store.stop(request, m[1], m[2], body.value);
      }
      return result === null ? unavailable() : json(result);
    } catch {
      return unavailable();
    }
  };
}
