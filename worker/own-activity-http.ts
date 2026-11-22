import { SessionStore } from './auth/sessions';
import { OwnReadingActivityStore } from './own-reading-activity';

const PATH = '/api/private/activity';
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

/** The signed-in student's own reading layer of the grass (counts per day only). Read-only. */
export function createOwnActivityHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock),
    store = new OwnReadingActivityStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== PATH && !url.pathname.startsWith(PATH + '/')) return null;
    const unavailable = () => json({ error: 'activity_unavailable' }, 404);
    try {
      if (new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)
        return json({ error: 'activity_unavailable' }, 503);
      if (url.origin !== origin || url.hash || url.search || url.pathname !== PATH)
        return unavailable();
      if (request.method !== 'GET')
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { ...headers, Allow: 'GET' },
        });
      if (!(await sessions.authenticate(request)))
        return json({ error: 'authentication_required' }, 401);
      const result = await store.readOwn(request);
      return result ? json(result) : unavailable();
    } catch {
      return unavailable();
    }
  };
}
