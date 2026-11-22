import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as bindings } from './auth/session-guard';
import { publicArticleSqlBounds } from './publication';
import {
  decodeEditorialReviewInput,
  type EditorialReviewView,
  type EditorialVerdict,
  type EditorialPoint,
} from '../src/shared/editorial-review';

const PREFIX = '/api/private/editorial-reviews/';
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
const unavailable = () => error(404, 'editorial_review_unavailable');
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

const contentId = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
type Row = { verdict: string; points_json: string; note: string; reviewed_at_ms: number };
function view(row: Row | null): EditorialReviewView | null {
  if (!row) return null;
  return {
    verdict: row.verdict as EditorialVerdict,
    points: JSON.parse(row.points_json) as EditorialPoint[],
    note: row.note,
    reviewedAt: new Date(row.reviewed_at_ms).toISOString(),
  };
}

/**
 * Operator-only editorial reviews of published articles. Anyone else (signed out, a student, a
 * suspended operator) gets the same 404 as an unknown path, so the feature is not discoverable.
 * Every final statement re-checks the live session; the allowlist is server configuration only.
 */
export class EditorialReviewStore {
  private readonly sessions: SessionStore;
  constructor(
    private readonly db: D1Database,
    origin: string,
    private readonly operatorIds: readonly string[],
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  private async operator(request: Request) {
    const p = await this.sessions.storageAuthorization(request);
    return p && this.operatorIds.includes(p.accountId) ? p : null;
  }
  async latest(
    request: Request,
    id: string,
  ): Promise<{ review: EditorialReviewView | null } | null> {
    const p = await this.operator(request);
    if (!p) return null;
    const auth = await this.db
      .prepare(
        `SELECT 1 ok FROM content c JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id WHERE c.id=? AND ${publicArticleSqlBounds} AND ${live}`,
      )
      .bind(id, ...bindings(p))
      .first<{ ok: number }>();
    if (!auth) return null;
    const row = await this.db
      .prepare(
        `SELECT verdict,points_json,note,reviewed_at_ms FROM editorial_reviews WHERE content_id=? AND reviewer_account_id=? AND ${live} ORDER BY reviewed_at_ms DESC,rowid DESC LIMIT 1`,
      )
      .bind(id, p.accountId, ...bindings(p))
      .first<Row>();
    return { review: view(row) };
  }
  async record(
    request: Request,
    id: string,
    input: unknown,
  ): Promise<{ review: EditorialReviewView } | null> {
    const decoded = decodeEditorialReviewInput(input);
    if (!decoded) return null;
    if (!(await this.sessions.authorizeMutation(request))) return null;
    const p = await this.operator(request);
    if (!p) return null;
    const row = await this.db
      .prepare(
        `INSERT INTO editorial_reviews(id,reviewer_account_id,content_id,revision,verdict,points_json,note,reviewed_at_ms) SELECT ?,?,c.id,(SELECT MAX(r.revision) FROM article_publication_revisions r WHERE r.content_id=c.id),?,?,?,? FROM content c JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id WHERE c.id=? AND ${publicArticleSqlBounds} AND ${live} RETURNING verdict,points_json,note,reviewed_at_ms`,
      )
      .bind(
        crypto.randomUUID(),
        p.accountId,
        decoded.verdict,
        JSON.stringify(decoded.points),
        decoded.note,
        p.nowMs,
        id,
        ...bindings(p),
      )
      .first<Row>();
    const review = view(row);
    return review ? { review } : null;
  }
}

/** Closed unless enabled (R2 release flag). */
export function createEditorialReviewHandler(
  db: D1Database,
  origin: string,
  options: { enabled?: boolean; operatorIds?: readonly string[] } = {},
  clock: () => number = Date.now,
) {
  const store = new EditorialReviewStore(db, origin, options.operatorIds ?? [], clock);
  return async (request: Request): Promise<Response | null> => {
    if (options.enabled !== true) return null;
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return null;
    if (!canonicalOrigin(origin)) return error(503, 'editorial_review_unavailable');
    const id = url.pathname.slice(PREFIX.length);
    if (url.search || url.hash || !contentId(id)) return unavailable();
    const allowed = ['GET', 'PUT'];
    if (!allowed.includes(request.method)) {
      const response = error(405, 'method_not_allowed');
      response.headers.set('Allow', allowed.join(', '));
      return response;
    }
    try {
      if (request.method === 'GET') {
        const result = await store.latest(request, id);
        return result === null ? unavailable() : json(result);
      }
      const body = await input(request);
      if (!body.ok) return error(body.status, 'invalid_request');
      const result = await store.record(request, id, body.value);
      return result === null ? unavailable() : json(result);
    } catch {
      return unavailable();
    }
  };
}
