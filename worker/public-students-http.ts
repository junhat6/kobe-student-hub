import { ArticlePublicationStore } from './publication';
import { ProjectStore } from './projects';
import { ProfileAvatarStore } from './profile-avatars';
import { readPublicActivity } from './public-activity';
import { readPublicReceivedLikes } from './public-received-likes';
import type { PublicStudent } from '../src/public-student-types';

const path = /^\/api\/students\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})(\/activity|\/received-likes)?$/;
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
            : await readPublicReceivedLikes(db, matched[1]);
        if (value === 'missing') return error(404);
        if (value === null) return error(503);
        return new Response(JSON.stringify(value), { headers });
      } catch {
        return error(503);
      }
    try {
      const [a, p] = await Promise.all([
        articles.readPublishedAuthorSelection(matched[1]),
        projects.readAuthorSelection(matched[1]),
      ]);
      if (a === null || p === null) return error(503);
      const author = a.author ?? p.author;
      if (!author || (!a.entries.length && !p.projects.length)) return error(404);
      if (a.author && p.author && JSON.stringify(a.author) !== JSON.stringify(p.author))
        return error(503);
      const avatar = await avatars.readPublicPath(author.id);
      const value: PublicStudent = { author, avatar, entries: a.entries, projects: p.projects };
      const body = JSON.stringify(value);
      if (new TextEncoder().encode(body).byteLength > 262144) return error(503);
      return new Response(body, { headers });
    } catch {
      return error(503);
    }
  };
}
