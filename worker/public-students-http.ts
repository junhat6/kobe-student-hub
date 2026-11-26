import { ArticlePublicationStore } from './publication';
import { ProjectStore } from './projects';
import { ProfileAvatarStore } from './profile-avatars';
import { readPublicActivity } from './public-activity';
import { readPublicReceivedLikes } from './public-received-likes';
import { readPublicAuthorCard } from './public-author-card';
import { ProfileLinkStore } from './profile-links';
import type { PublicStudent } from '../src/public-student-types';

const path =
  /^\/api\/students\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})(\/activity|\/received-likes|\/card)?$/;
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'application/json; charset=utf-8',
};
const error = (status: number) =>
  new Response(JSON.stringify({ error: 'student_unavailable' }), { status, headers });

/** Anonymous activity projection. Empty selections are valid; failed selections never become empty. */
export function createPublicStudentHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const articles = new ArticlePublicationStore(db, origin, clock);
  const projects = new ProjectStore(db, origin, clock);
  const avatars = new ProfileAvatarStore(db, origin, clock);
  const links = new ProfileLinkStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== '/api/students' && !url.pathname.startsWith('/api/students/')) return null;
    try {
      if (new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)
        return error(503);
    } catch {
      return error(503);
    }
    if (url.origin !== origin || url.search || url.hash) return error(404);
    const matched = path.exec(url.pathname);
    if (!matched) return error(404);
    if (request.method !== 'GET')
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { ...headers, Allow: 'GET' },
      });
    if (matched[2])
      try {
        const value =
          matched[2] === '/activity'
            ? await readPublicActivity(db, matched[1], clock())
            : matched[2] === '/card'
              ? await readPublicAuthorCard(db, matched[1])
              : await readPublicReceivedLikes(db, matched[1]);
        if (value === 'missing') return error(404);
        if (value === null) return error(503);
        // The card shows the author's links beside the counts (#313).
        const body =
          matched[2] === '/card' ? { ...value, links: await links.readPublic(matched[1]) } : value;
        return new Response(JSON.stringify(body), { headers });
      } catch {
        return error(503);
      }
    try {
      const value = await readPublicStudent(articles, projects, matched[1]);
      if (value === 'missing') return error(404);
      if (value === null) return error(503);
      const student: PublicStudent = {
        ...value,
        avatar: await avatars.readPublicPath(value.author.id),
        links: await links.readPublic(value.author.id),
      };
      const body = JSON.stringify(student);
      if (new TextEncoder().encode(body).byteLength > 262144) return error(503);
      return new Response(body, { headers });
    } catch {
      return error(503);
    }
  };
}

/**
 * The public student page without the icon: the same bounded article and project selections and
 * the same consistency check for /api/students and the MCP get_student tool (#294).
 * 'missing' when nothing is public; null when a selection failed (never shown as empty).
 */
export async function readPublicStudent(
  articles: ArticlePublicationStore,
  projects: ProjectStore,
  id: string,
): Promise<Omit<PublicStudent, 'avatar' | 'links'> | 'missing' | null> {
  const [a, p] = await Promise.all([
    articles.readPublishedAuthorSelection(id),
    projects.readAuthorSelection(id),
  ]);
  if (a === null || p === null) return null;
  const author = a.author ?? p.author;
  if (!author || (!a.entries.length && !p.projects.length)) return 'missing';
  if (a.author && p.author && JSON.stringify(a.author) !== JSON.stringify(p.author)) return null;
  return { author, entries: a.entries, projects: p.projects };
}
