import { SessionStore } from './auth/sessions';
import { ArticleModerationStore } from './moderation';
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
function canonicalOrigin(origin: string) {
  try {
    return new URL(origin).protocol === 'https:' && new URL(origin).origin === origin;
  } catch {
    return false;
  }
}
type Body = { ok: true; value: unknown } | { ok: false; status: number };
async function input(request: Request): Promise<Body> {
  const type = request.headers.get('Content-Type');
  if (!type || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type))
    return { ok: false, status: 415 };
  const encoding = request.headers.get('Content-Encoding');
  if (encoding !== null && encoding.toLowerCase() !== 'identity') return { ok: false, status: 415 };
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    return { ok: false, status: 400 };
  if (length !== null && Number(length) > LIMIT) {
    void request.body?.cancel().catch(() => {});
    return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const read = (async (): Promise<Body> => {
    try {
      const bytes = new Uint8Array(LIMIT);
      let size = 0;
      let count = 0;
      for (;;) {
        const chunk = await reader.read();
        if (expired) return { ok: false, status: 408 };
        if (chunk.done) break;
        if (++count > MAX_CHUNKS) {
          cancel();
          return { ok: false, status: 413 };
        }
        if (chunk.value.byteLength === 0) continue;
        const next = size + chunk.value.byteLength;
        if (next > LIMIT) {
          cancel();
          return { ok: false, status: 413 };
        }
        bytes.set(chunk.value, size);
        size = next;
      }
      if (length !== null && Number(length) !== size) return { ok: false, status: 400 };
      return {
        ok: true,
        value: JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
        ),
      };
    } catch {
      return { ok: false, status: 400 };
    } finally {
      reader.releaseLock();
    }
  })();
  const deadline = new Promise<Body>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      cancel();
      resolve({ ok: false, status: 408 });
    }, 5000);
  });
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
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
      !url.pathname.startsWith('/api/private/moderation')
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
    const session = url.pathname === '/api/private/moderation/session';
    const queue = url.pathname === '/api/private/moderation/cases';
    if (!report && !casePath && !decision && !receipt && !session && !queue) return unavailable();
    const allowed = report || decision ? ['GET', 'POST'] : ['GET'];
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
        const result = report
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
      const result = decision
        ? await moderation.decide(request, decision[1], body.value)
        : await moderation.report(request, report![1], body.value);
      return result === null ? unavailable() : json(result);
    } catch {
      return unavailable();
    }
  };
}
