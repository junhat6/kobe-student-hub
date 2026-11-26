import { SessionStore } from './auth/sessions';
import { PublicProfileStore } from './public-profile';
import { ProfileLinkStore } from './profile-links';
import { normalizeProfileLinkInput } from '../src/shared/profile-links';
import { canonicalOrigin, readBoundedJson } from './http-boundary';
const PREFIX = '/api/private/profile';
const LINKS = PREFIX + '/links';
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
const unavailable = () => error(404, 'profile_unavailable');
const input = (request: Request) => readBoundedJson(request, { bytes: LIMIT, chunks: MAX_CHUNKS });
/** Private profile boundary, mounted only through the ordinary-authoring release gate. */
export function createPrivateProfileHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock);
  const profiles = new PublicProfileStore(db, origin, clock);
  const links = new ProfileLinkStore(db, origin, clock);
  /** The owner's X・GitHub・LinkedIn・website links (#313): read, or replace the whole set. */
  async function linksRoute(request: Request): Promise<Response> {
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
        const result = await links.readOwn(request);
        return result === null ? unavailable() : json(result);
      }
      const body = await readBoundedJson(request, { bytes: 4096, chunks: 256 });
      if (!body.ok) return error(body.status, 'invalid_request');
      const next =
        body.value !== null &&
        typeof body.value === 'object' &&
        !Array.isArray(body.value) &&
        Object.getPrototypeOf(body.value) === Object.prototype &&
        Reflect.ownKeys(body.value).length === 1 &&
        Object.hasOwn(body.value, 'links')
          ? normalizeProfileLinkInput((body.value as { links: unknown }).links)
          : null;
      // A value that is not one of the accepted shapes is refused before any session write.
      if (next === null) return error(400, 'invalid_link');
      const result = next.length ? await links.replace(request, next) : await links.clear(request);
      return result === null ? unavailable() : json(result);
    } catch {
      return unavailable();
    }
  }
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return null;
    if (!canonicalOrigin(origin)) return error(503, 'profile_unavailable');
    if (url.pathname === LINKS && !url.search && !url.hash) return linksRoute(request);
    if (url.pathname !== PREFIX || url.search || url.hash) return unavailable();
    const allowed = ['GET', 'POST', 'PATCH'];
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
        const result = await profiles.getOwn(request);
        return result === null ? unavailable() : json(result);
      }
      const body = await input(request);
      if (!body.ok) return error(body.status, 'invalid_request');
      if (request.method === 'PATCH') {
        const result = await profiles.update(request, body.value);
        if (!result) return unavailable();
        return result.kind === 'conflict'
          ? error(409, 'profile_changed')
          : json({ profile: result.profile });
      }
      const result = await profiles.create(request, body.value);
      return result === null ? unavailable() : json(result, 201);
    } catch {
      return unavailable();
    }
  };
}
