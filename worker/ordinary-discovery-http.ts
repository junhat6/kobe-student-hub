import { OrdinaryDiscoveryStore } from './ordinary-discovery';
import { canonicalOrigin } from './http-boundary';
import { CardImageStore } from './card-images';
import type { OrdinaryDiscovery, RelatedDiscovery } from '../src/community/discovery-types';
const related =
  /^\/api\/discovery\/articles\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
export function createOrdinaryDiscoveryHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const store = new OrdinaryDiscoveryStore(db, origin, clock);
  const images = new CardImageStore(db, origin, clock);
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
    if (!value) return json({ error: 'discovery_unavailable' }, home ? 503 : 404);
    try {
      await withImages(images, value);
    } catch {
      // Pictures are supplementary: without them every card still draws its own picture (#310).
    }
    return json(value, 200);
  };
}

/** #311: adds each card's public picture path in place, after the discovery snapshot was checked. */
async function withImages(images: CardImageStore, value: OrdinaryDiscovery | RelatedDiscovery) {
  const articles = 'recent' in value ? [...value.recent, ...value.popular] : [...value.articles];
  const projects = 'recent' in value ? [] : [...value.projects, ...value.linkedProjects];
  const paths = await images.readPublicPaths(
    articles.map((card) => card.entry.id),
    projects.map((card) => card.project.id),
  );
  for (const card of articles) {
    const image = paths.get(card.entry.id);
    if (image) card.entry = { ...card.entry, image };
  }
  for (const card of projects) {
    const image = paths.get(card.project.id);
    if (image) card.project = { ...card.project, image };
  }
}
