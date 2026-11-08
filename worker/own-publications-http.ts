import { SessionStore } from './auth/sessions';
import { OwnPublicationStore } from './own-publications';
const PATH = '/api/private/own-publications';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers });
const unavailable = () => json({ error: 'own_publications_unavailable' }, 503);
function canonical(origin: string) {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.origin === origin;
  } catch {
    return false;
  }
}
/** Unconnected private list. No publication writes, decisions or account creation. */
export function createPrivateOwnPublicationsHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock),
    store = new OwnPublicationStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const u = new URL(request.url);
    if (!u.pathname.startsWith(PATH)) return null;
    if (!canonical(origin)) return unavailable();
    if (u.pathname !== PATH || u.search || u.hash) return json({ error: 'not_found' }, 404);
    if (request.method !== 'GET') {
      const r = json({ error: 'method_not_allowed' }, 405);
      r.headers.set('Allow', 'GET');
      return r;
    }
    try {
      const auth = await sessions.inspect(request);
      if (auth.kind === 'unavailable') return unavailable();
      if (auth.kind !== 'authenticated') return json({ error: 'authentication_required' }, 401);
      const result = await store.list(request);
      return result && new TextEncoder().encode(JSON.stringify(result)).length <= 65536
        ? json(result)
        : unavailable();
    } catch {
      return unavailable();
    }
  };
}
