import { SessionStore } from './auth/sessions';
import { ArticleModerationStore } from './moderation';
import { canonicalOrigin, readBoundedJson } from './http-boundary';
export interface ModerationBindings {
  MODERATION_OPERATOR_ACCOUNT_IDS?: string;
}
/** Server configuration only. An absent or invalid allowlist never admits an operator. */
export function parseModerationOperators(bindings: ModerationBindings): readonly string[] {
  const raw = bindings.MODERATION_OPERATOR_ACCOUNT_IDS;
  if (typeof raw !== 'string' || raw.length > 2048) return [];
  try {
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) &&
      ids.length <= 10 &&
      ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) &&
      new Set(ids).size === ids.length
      ? Object.freeze([...ids])
      : [];
  } catch {
    return [];
  }
}
const PREFIX = '/api/private/';
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
const unavailable = () => error(404, 'moderation_unavailable');
const input = (request: Request) => readBoundedJson(request, { bytes: LIMIT, chunks: MAX_CHUNKS });
/** Existing-session reports and trusted operator decisions. No role grant or mail sender. */
export function createModerationHandler(
  db: D1Database,
  origin: string,
  operatorIds: readonly string[] = [],
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock);
  const moderation = new ArticleModerationStore(db, origin, operatorIds, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (
      !url.pathname.startsWith('/api/private/reports') &&
      !url.pathname.startsWith('/api/private/moderation') &&
      !url.pathname.startsWith('/api/private/notifications')
    )
      return null;
    if (!canonicalOrigin(origin)) return error(503, 'moderation_unavailable');
    if (url.search || url.hash) return unavailable();
    const report = /^\/api\/private\/reports\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(
      url.pathname,
    );
    const casePath = /^\/api\/private\/moderation\/cases\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(
      url.pathname,
    );
    const decision =
      /^\/api\/private\/moderation\/cases\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/decision$/.exec(
        url.pathname,
      );
    const receipt =
      /^\/api\/private\/moderation\/cases\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/decisions\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(
        url.pathname,
      );
    const ownNotices = url.pathname === '/api/private/notifications';
    const emailQueue = url.pathname === '/api/private/moderation/notifications';
    const retryEmail =
      /^\/api\/private\/moderation\/notifications\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/retry$/.exec(
        url.pathname,
      );
    const session = url.pathname === '/api/private/moderation/session';
    const queue = url.pathname === '/api/private/moderation/cases';
    if (
      !report &&
      !casePath &&
      !decision &&
      !receipt &&
      !session &&
      !queue &&
      !ownNotices &&
      !emailQueue &&
      !retryEmail
    )
      return unavailable();
    const allowed = retryEmail ? ['POST'] : report || decision ? ['GET', 'POST'] : ['GET'];
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
      if (session) return json({ csrfToken: authorized.csrfToken });
      if (request.method === 'GET') {
        const result = ownNotices
          ? await moderation.ownNotifications(request)
          : emailQueue
            ? await moderation.emailQueue(request)
            : report
              ? await moderation.getOwnReport(request, report[1])
              : receipt
                ? await moderation.readDecision(request, receipt[1], receipt[2])
                : decision
                  ? await moderation.decisionState(request, decision[1])
                  : casePath
                    ? await moderation.readCase(request, casePath[1])
                    : await moderation.queue(request);
        return result === null ? unavailable() : json(result);
      }
      const body = await input(request);
      if (!body.ok) return error(body.status, 'invalid_request');
      const result = retryEmail
        ? await moderation.retryEmail(request, retryEmail[1], body.value)
        : decision
          ? await moderation.decide(request, decision[1], body.value)
          : await moderation.report(request, report![1], body.value);
      return result === null ? unavailable() : json(result);
    } catch {
      return unavailable();
    }
  };
}
