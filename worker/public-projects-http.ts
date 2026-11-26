import { ProjectStore } from './projects';
import { CardImageStore } from './card-images';
import type { PublicProjectDiscovery, PublicProjectPage } from '../src/project-types';

const projectPath =
  /^\/api\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const authorPath = /^\/api\/project-authors\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/;
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'application/json; charset=utf-8',
};

/** Publish only the existing, validated public snapshots; never private project drafts. */
export function createPublicProjectHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const store = new ProjectStore(db, origin, clock);
  const images = new CardImageStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (
      url.pathname !== '/api/projects' &&
      !url.pathname.startsWith('/api/projects/') &&
      url.pathname !== '/api/project-authors' &&
      !url.pathname.startsWith('/api/project-authors/')
    )
      return null;
    const error = (status: number) =>
      new Response(JSON.stringify({ error: 'project_unavailable' }), { status, headers });
    try {
      if (new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)
        return error(503);
    } catch {
      return error(503);
    }
    if (url.origin !== origin || url.search || url.hash) return error(404);
    const recent = url.pathname === '/api/projects';
    const project = projectPath.exec(url.pathname),
      author = authorPath.exec(url.pathname);
    if (!recent && !project && !author) return error(404);
    if (request.method !== 'GET')
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { ...headers, Allow: 'GET' },
      });
    try {
      const value = recent
        ? await store.readRecentPublished()
        : project
          ? await store.readPublishedPage(project[1])
          : await store.readAuthor(author![1]);
      if (value === null) return error(recent ? 503 : 404);
      // #311: card pictures for the works list and the project page's article cards.
      if (recent) {
        const cards = (value as PublicProjectDiscovery).cards;
        const paths = await images.readPublicPaths(
          [],
          cards.map((card) => card.project.id),
        );
        for (const card of cards) {
          const image = paths.get(card.project.id);
          if (image) card.project = { ...card.project, image };
        }
      } else if (project) {
        const page = value as PublicProjectPage;
        const paths = await images.readPublicPaths(
          [...page.articles, ...page.journal].map((entry) => entry.id),
          [],
        );
        page.articles = page.articles.map((entry) => {
          const image = paths.get(entry.id);
          return image ? { ...entry, image } : entry;
        });
        page.journal = page.journal.map((entry) => {
          const image = paths.get(entry.id);
          return image ? { ...entry, image } : entry;
        });
      }
      const body = JSON.stringify(value);
      if (new TextEncoder().encode(body).byteLength > (project ? 65536 : 262144))
        return error(recent ? 503 : 404);
      return new Response(body, { headers });
    } catch {
      return error(recent ? 503 : 404);
    }
  };
}
