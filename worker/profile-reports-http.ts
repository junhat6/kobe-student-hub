import { SessionStore } from './auth/sessions';
import { ProfileReportStore } from './profile-reports';
import { canonicalOrigin, readBoundedJson } from './http-boundary';
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
const unavailable = () => error(404, 'profile_report_unavailable');
const input = (request: Request) => readBoundedJson(request, { bytes: LIMIT, chunks: MAX_CHUNKS });
const slug = '[A-Za-z0-9][A-Za-z0-9_-]{0,127}';
const route = new RegExp(
  `^/api/private/profile-(reports|moderation/cases)(?:/(${slug}))?(/avatar-removal)?$`,
);
const avatarRoute = new RegExp(
  `^/api/private/profile-moderation/cases/(${slug})/avatar/([0-9a-f]{16})$`,
);
// Same posture as the icon routes: never cached or shared, never sniffed, framed or scripted.
const imageHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};
/** Profile report intake and operator read-only review; the allowlist is checked on every read. */
export function createPrivateProfileReportHandler(
  db: D1Database,
  origin: string,
  operatorIds: readonly string[] = [],
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock),
    store = new ProfileReportStore(db, origin, operatorIds, clock);
  return async (request: Request): Promise<Response | null> => {
    const u = new URL(request.url);
    if (
      !u.pathname.startsWith('/api/private/profile-reports') &&
      !u.pathname.startsWith('/api/private/profile-moderation')
    )
      return null;
    if (!canonicalOrigin(origin)) return error(503, 'profile_report_unavailable');
    const image = avatarRoute.exec(u.pathname);
    if (image) {
      if (u.search || u.hash) return unavailable();
      if (request.method !== 'GET') {
        const r = error(405, 'method_not_allowed');
        r.headers.set('Allow', 'GET');
        return r;
      }
      try {
        if (!(await sessions.authenticate(request))) return error(401, 'authentication_required');
        const value = await store.readAvatar(request, image[1], image[2]);
        return value
          ? new Response(value.bytes, {
              headers: {
                ...imageHeaders,
                'Content-Type': value.mime,
                'Content-Length': String(value.bytes.length),
              },
            })
          : unavailable();
      } catch {
        return unavailable();
      }
    }
    const m = route.exec(u.pathname);
    if (!m || u.search || u.hash || (m[1] === 'reports' && (!m[2] || m[3])) || (m[3] && !m[2]))
      return unavailable();
    const report = m[1] === 'reports',
      removal = Boolean(m[3]);
    const allowed = report ? ['GET', 'POST'] : removal ? ['POST'] : ['GET'];
    if (!allowed.includes(request.method)) {
      const r = error(405, 'method_not_allowed');
      r.headers.set('Allow', allowed.join(', '));
      return r;
    }
    try {
      const auth =
        request.method === 'GET'
          ? await sessions.authenticate(request)
          : await sessions.authorizeMutation(request);
      if (!auth) return error(401, 'authentication_required');
      let result: unknown;
      if (removal) {
        const body = await input(request);
        if (!body.ok) return error(body.status, 'invalid_request');
        result = await store.removeAvatar(request, m[2], body.value);
        return result === null ? unavailable() : json(result, 201);
      }
      if (report && request.method === 'POST') {
        const body = await input(request);
        if (!body.ok) return error(body.status, 'invalid_request');
        result = await store.report(request, m[2], body.value);
      } else
        result = report
          ? await store.getOwnReceipt(request, m[2])
          : m[2]
            ? await store.readCase(request, m[2])
            : await store.queue(request);
      return result === null
        ? unavailable()
        : json(result, report && request.method === 'POST' ? 201 : 200);
    } catch {
      return unavailable();
    }
  };
}
