import { SessionStore } from './auth/sessions';
import { EnrollmentStore, canonicalEnrollmentSaveInput } from './auth/enrollment';
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
  let expired = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const read = (async (): Promise<Body> => {
    try {
      const bytes = new Uint8Array(LIMIT);
      let size = 0,
        count = 0;
      for (;;) {
        const chunk = await reader.read();
        if (expired) return { ok: false, status: 408 };
        if (chunk.done) break;
        if (++count > MAX_CHUNKS || size + chunk.value.byteLength > LIMIT) {
          cancel();
          return { ok: false, status: 413 };
        }
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
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
