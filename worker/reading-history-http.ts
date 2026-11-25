import { SessionStore } from './auth/sessions';
import { ReadingHistoryStore } from './reading-history';
import { isReadingReference } from '../src/history/types';
import { readBoundedJson } from './http-boundary';
const PREFIX = '/api/private/reading-history';
const BODY_LIMIT = 1024;
const MAX_CHUNKS = 1024;
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
const input = (request: Request) =>
  readBoundedJson(request, { bytes: BODY_LIMIT, chunks: MAX_CHUNKS });
export function createReadingHistoryHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock),
    store = new ReadingHistoryStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return null;
    const unavailable = () => json({ error: 'history_unavailable' }, 404);
    try {
      if (new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)
        return json({ error: 'history_unavailable' }, 503);
      if (url.origin !== origin || url.hash || url.pathname !== PREFIX) return unavailable();
      const rawOffset = url.searchParams.get('offset');
      if (
        url.search &&
        (request.method !== 'GET' ||
          [...url.searchParams.keys()].join(',') !== 'offset' ||
          !/^(?:0|[1-9][0-9]{0,2})$/.test(rawOffset ?? '') ||
          Number(rawOffset) > 500)
      )
        return unavailable();
      if (!['GET', 'PUT', 'DELETE', 'PATCH'].includes(request.method))
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { ...headers, Allow: 'GET, PUT, DELETE, PATCH' },
        });
      const authorized =
        request.method === 'GET'
          ? await sessions.authenticate(request)
          : await sessions.authorizeMutation(request);
      if (!authorized) return json({ error: 'authentication_required' }, 401);
      if (request.method === 'GET') {
        const result = await store.list(request, Number(rawOffset ?? 0));
        return result ? json(result) : unavailable();
      }
      const body = await input(request);
      if (!body.ok) return json({ error: 'invalid_request' }, body.status);
      if (request.method === 'PUT') {
        if (!isReadingReference(body.value)) return unavailable();
        const result = await store.record(request, body.value);
        return result === null ? unavailable() : json({ recorded: result });
      }
      if (request.method === 'DELETE') {
        const value = body.value;
        const all =
          !!value &&
          typeof value === 'object' &&
          Object.keys(value).join(',') === 'all' &&
          (value as { all: unknown }).all === true;
        if (!all && !isReadingReference(value)) return unavailable();
        return (await store.remove(
          request,
          all ? undefined : (value as import('../src/history/types').ReadingReference),
        ))
          ? json({ deleted: true })
          : unavailable();
      }
      const value = body.value;
      if (
        !value ||
        typeof value !== 'object' ||
        Object.keys(value).join(',') !== 'enabled' ||
        typeof (value as { enabled: unknown }).enabled !== 'boolean'
      )
        return unavailable();
      const enabled = (value as { enabled: boolean }).enabled;
      return (await store.setEnabled(request, enabled)) ? json({ enabled }) : unavailable();
    } catch {
      return unavailable();
    }
  };
}
