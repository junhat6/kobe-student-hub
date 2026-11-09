import { OrdinaryDiscoveryStore } from './ordinary-discovery';
const related =
  /^\/api\/discovery\/articles\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
function canonicalOrigin(origin: string) {
  try {
    return new URL(origin).protocol === 'https:' && new URL(origin).origin === origin;
  } catch {
    return false;
  }
}
export function createOrdinaryDiscoveryHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const store = new OrdinaryDiscoveryStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== '/api/discovery' && !url.pathname.startsWith('/api/discovery/'))
      return null;
    const json = (value: unknown, status: number) =>
      new Response(JSON.stringify(value), { status, headers });
    const match = related.exec(url.pathname),
      home = url.pathname === '/api/discovery';
    if (
      url.origin !== origin ||
      !canonicalOrigin(origin) ||
      url.search ||
      url.hash ||
      (!home && !match)
    )
      return json({ error: 'discovery_unavailable' }, 404);
    if (request.method !== 'GET') {
      const response = json({ error: 'method_not_allowed' }, 405);
      response.headers.set('Allow', 'GET');
      return response;
    }
    const value = home ? await store.home() : await store.related(match![1]);
    return value ? json(value, 200) : json({ error: 'discovery_unavailable' }, home ? 503 : 404);
  };
}
