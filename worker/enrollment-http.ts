import { SessionStore } from './auth/sessions';
import { EnrollmentStore, canonicalEnrollmentSaveInput } from './auth/enrollment';
import { canonicalOrigin, readBoundedJson } from './http-boundary';
const PREFIX = '/api/private/enrollment',
  LIMIT = 1024,
  MAX_CHUNKS = 1024;
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
const input = (request: Request) => readBoundedJson(request, { bytes: LIMIT, chunks: MAX_CHUNKS });
/** Local preparation only; production authentication and release gates stay closed. */
export function createEnrollmentHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock),
    enrollment = new EnrollmentStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return null;
    if (!canonicalOrigin(origin)) return error(503, 'enrollment_unavailable');
    if (url.pathname !== PREFIX || url.search || url.hash)
      return error(404, 'enrollment_unavailable');
    if (!['GET', 'PUT'].includes(request.method)) {
      const response = error(405, 'method_not_allowed');
      response.headers.set('Allow', 'GET, PUT');
      return response;
    }
    try {
      const authorized =
        request.method === 'GET'
          ? await sessions.authenticate(request)
          : await sessions.authorizeMutation(request);
      if (!authorized) return error(401, 'authentication_required');
      if (request.method === 'GET') {
        const result = await enrollment.getOwn(request);
        return result === null ? error(404, 'enrollment_unavailable') : json(result);
      }
      const body = await input(request);
      if (!body.ok) return error(body.status, 'invalid_request');
      if (!canonicalEnrollmentSaveInput(body.value)) return error(400, 'invalid_request');
      const result = await enrollment.save(request, body.value);
      return result === null ? error(409, 'enrollment_unavailable') : json(result);
    } catch {
      return error(404, 'enrollment_unavailable');
    }
  };
}
