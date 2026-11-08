import { SessionStore } from './auth/sessions';
import { ProjectReportStore } from './project-reports';
import { ProjectModerationStore } from './project-moderation';
import { ModerationMediaStore } from './moderation-media';
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
const unavailable = () => error(404, 'project_report_unavailable');
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
/** Report intake and manual project review; current server allowlist is checked on every operation. */
export function createPrivateProjectReportHandler(
  db: D1Database,
  origin: string,
  operatorIds: readonly string[] = [],
  clock: () => number = Date.now,
) {
  const operators =
    Array.isArray(operatorIds) &&
    operatorIds.length <= 10 &&
    operatorIds.every((v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))
      ? Object.freeze([...operatorIds])
      : [];
  const sessions = new SessionStore(db, origin, clock),
    store = new ProjectReportStore(db, origin, operators, clock),
    moderation = new ProjectModerationStore(db, origin, operators, clock),
    media = new ModerationMediaStore(db, origin, operators, clock);
  return async (request: Request): Promise<Response | null> => {
    const u = new URL(request.url);
    if (
      !u.pathname.startsWith('/api/private/project-reports') &&
      !u.pathname.startsWith('/api/private/project-moderation') &&
      !u.pathname.startsWith('/api/private/moderation-media')
    )
      return null;
    if (!canonicalOrigin(origin)) return error(503, 'project_report_unavailable');
    const image =
      /^\/api\/private\/moderation-media\/(articles|projects)\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(
        u.pathname,
      );
    if (image) {
      if (u.search || u.hash) return unavailable();
      if (request.method !== 'GET') {
        const r = error(405, 'method_not_allowed');
        r.headers.set('Allow', 'GET');
        return r;
      }
      if (!(await sessions.authenticate(request))) return error(401, 'authentication_required');
      const value = await media.read(request, image[1], image[2], image[3]);
      return value
        ? new Response(value.bytes, {
            headers: {
              ...headers,
              'Content-Type': value.mime,
              'Content-Length': String(value.bytes.length),
              'Content-Security-Policy': "default-src 'none'; sandbox",
            },
          })
        : unavailable();
    }
    const m =
      /^\/api\/private\/project-(reports|moderation\/(?:cases|review))(?:\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(decision|decisions)(?:\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?)?)?$/.exec(
        u.pathname,
      );
    if (
      !m ||
      u.search ||
      u.hash ||
      (m[1] === 'reports' && (!m[2] || m[3])) ||
      (m[3] === 'decision' && m[4]) ||
      (m[3] === 'decisions' && !m[4])
    )
      return unavailable();
    const report = m[1] === 'reports',
      review = m[1] === 'moderation/review';
    const allowed = report || m[3] === 'decision' ? ['GET', 'POST'] : ['GET'];
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
      if (m[3] === 'decision') {
        if (request.method === 'POST') {
          const body = await input(request);
          if (!body.ok) return error(body.status, 'invalid_request');
          result = await moderation.decide(request, m[2], body.value);
        } else result = await moderation.state(request, m[2]);
      } else if (m[3] === 'decisions') result = await moderation.readDecision(request, m[2], m[4]);
      else if (review)
        result = m[2] ? await moderation.read(request, m[2]) : await moderation.queue(request);
      else if (report && request.method === 'POST') {
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
