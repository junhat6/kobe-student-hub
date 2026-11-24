import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as bindings } from './auth/session-guard';
import { publicArticleSqlBounds } from './publication';
import {
  EDITORIAL_TASTE,
  EDITORIAL_TASTE_UPDATED,
  EDITORIAL_PRODUCT_NOTES,
} from '../src/agent/editorial-taste';
import {
  decodeEditorialReviewInput,
  EDITORIAL_AI_DIFF_COMPARED,
  EDITORIAL_POINTS,
  EDITORIAL_SUMMARY_DAYS,
  type EditorialAiDiff,
  EDITORIAL_VERDICTS,
  type EditorialTasteSummary,
  type EditorialReviewView,
  type EditorialVerdict,
  type EditorialPoint,
} from '../src/shared/editorial-review';
import { DIFF_LIMITS, lineDiff } from '../src/shared/line-diff';

const PREFIX = '/api/private/editorial-reviews/';
/** The operator's 好み screen (C22 condition 5): ledger and counts only. */
export const TASTE_PATH = '/api/private/editorial-taste';
const DAY_MS = 24 * 60 * 60 * 1000;
// Bound on rows the summary reads; far above one operator's 30 days of reviews.
const SUMMARY_ROWS = 2000;
const longerThanDiff = (text: string) =>
  text.split(/\r\n|\r|\n/, DIFF_LIMITS.maxLines + 1).length > DIFF_LIMITS.maxLines;
const ledgerLines = (text: string) => text.split('\n').filter((line) => line.trim() !== '');
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
/** Bounded JSON request body (16 KiB, 5 s), shared with the taste sharing handler. */
export async function input(request: Request): Promise<Body> {
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
 * suspended operator) gets the same 404 as an unknown article, so no review data is readable.
 * Transport checks (405 method, 413/415/400 body) run before the session check and reveal only
 * that the path exists, never any review or operator identity (same as the likes API).
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
  /**
   * Counts of the operator's own latest review per article over the last 30 days. Reads only
   * verdict and points: the note, the article and the author never leave this method.
   */
  async summary(request: Request): Promise<EditorialTasteSummary | null> {
    const p = await this.operator(request);
    if (!p) return null;
    const since = p.nowMs - EDITORIAL_SUMMARY_DAYS * DAY_MS;
    const { results } = await this.db
      .prepare(
        `SELECT r.verdict,r.points_json FROM editorial_reviews r WHERE r.reviewer_account_id=? AND r.reviewed_at_ms>=? AND NOT EXISTS(SELECT 1 FROM editorial_reviews n WHERE n.content_id=r.content_id AND n.reviewer_account_id=r.reviewer_account_id AND (n.reviewed_at_ms>r.reviewed_at_ms OR (n.reviewed_at_ms=r.reviewed_at_ms AND n.rowid>r.rowid))) AND ${live} LIMIT ${SUMMARY_ROWS}`,
      )
      .bind(p.accountId, since, ...bindings(p))
      .all<{ verdict: string; points_json: string }>();
    const verdicts = Object.fromEntries(EDITORIAL_VERDICTS.map((v) => [v, 0])) as Record<
      EditorialVerdict,
      number
    >;
    const points = Object.fromEntries(EDITORIAL_POINTS.map((point) => [point.code, 0])) as Record<
      EditorialPoint,
      number
    >;
    for (const row of results) {
      if (Object.hasOwn(verdicts, row.verdict)) verdicts[row.verdict as EditorialVerdict]++;
      const codes: unknown = JSON.parse(row.points_json);
      if (Array.isArray(codes))
        for (const code of new Set(codes))
          if (typeof code === 'string' && Object.hasOwn(points, code))
            points[code as EditorialPoint]++;
    }
    return {
      ledger: {
        taste: ledgerLines(EDITORIAL_TASTE),
        product: ledgerLines(EDITORIAL_PRODUCT_NOTES),
        updated: EDITORIAL_TASTE_UPDATED,
      },
      reviews: { days: EDITORIAL_SUMMARY_DAYS, total: results.length, verdicts, points },
      aiDiff: await this.aiDiff(p, since),
    };
  }

  /**
   * How the operator changed what their own AI agent wrote, over the same window. Bodies are read
   * only to count lines here; no title, line or id leaves this method. A published draft is
   * compared with its latest published body, any other with the current draft.
   */
  private async aiDiff(
    p: NonNullable<Awaited<ReturnType<EditorialReviewStore['operator']>>>,
    since: number,
  ): Promise<EditorialAiDiff> {
    const [total, rows] = await this.db.batch([
      this.db
        .prepare(
          `SELECT count(*) AS n FROM agent_draft_versions v JOIN private_article_drafts d ON d.id=v.draft_id AND d.owner_account_id=v.account_id WHERE v.account_id=? AND v.recorded_at_ms>=? AND ${live}`,
        )
        .bind(p.accountId, since, ...bindings(p)),
      this.db
        .prepare(
          `SELECT v.title AS agent_title,v.body AS agent_body,d.title,d.body,(SELECT cur.body FROM article_publications r JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id AND c.kind='article' AND c.status='published' AND c.is_sample=0 JOIN article_publication_revisions cur ON cur.content_id=r.content_id WHERE r.draft_id=d.id AND r.owner_account_id=d.owner_account_id ORDER BY cur.revision DESC LIMIT 1) AS published_body,(SELECT r.published_at_ms FROM article_publications r JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id AND c.kind='article' AND c.status='published' AND c.is_sample=0 WHERE r.draft_id=d.id AND r.owner_account_id=d.owner_account_id) AS published_at_ms,(SELECT o.created_at_ms FROM agent_draft_origins o WHERE o.draft_id=v.draft_id AND o.account_id=v.account_id) AS created_at_ms FROM agent_draft_versions v JOIN private_article_drafts d ON d.id=v.draft_id AND d.owner_account_id=v.account_id WHERE v.account_id=? AND v.recorded_at_ms>=? AND ${live} ORDER BY v.recorded_at_ms DESC,v.draft_id ASC LIMIT ${EDITORIAL_AI_DIFF_COMPARED}`,
        )
        .bind(p.accountId, since, ...bindings(p)),
    ]);
    const out: EditorialAiDiff = {
      days: EDITORIAL_SUMMARY_DAYS,
      drafts: (total.results[0] as { n: number } | undefined)?.n ?? 0,
      compared: rows.results.length,
      edited: 0,
      added: 0,
      removed: 0,
      published: 0,
      medianDaysToPublish: null,
      approximate: false,
    };
    const days: number[] = [];
    for (const r of rows.results as {
      agent_title: string;
      agent_body: string;
      title: string;
      body: string;
      published_body: string | null;
      published_at_ms: number | null;
      created_at_ms: number | null;
    }[]) {
      const after = r.published_body ?? r.body;
      // Counts only: no changed line is kept, so the change list is capped at zero.
      const diff = lineDiff(r.agent_body, after, { ...DIFF_LIMITS, maxChanges: 0 });
      out.added += diff.added;
      out.removed += diff.removed;
      if (diff.approximate || [r.agent_body, after].some(longerThanDiff)) out.approximate = true;
      if (diff.added + diff.removed > 0 || r.agent_title !== r.title) out.edited++;
      if (r.published_body !== null) {
        out.published++;
        if (r.published_at_ms !== null && r.created_at_ms !== null)
          days.push(Math.max(0, r.published_at_ms - r.created_at_ms) / DAY_MS);
      }
    }
    if (days.length) {
      days.sort((a, b) => a - b);
      const mid = days.length >> 1;
      const median = days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
      out.medianDaysToPublish = Math.round(median * 10) / 10;
    }
    return out;
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
    if (url.pathname === TASTE_PATH) {
      if (!canonicalOrigin(origin)) return error(503, 'editorial_review_unavailable');
      if (url.search || url.hash) return unavailable();
      if (request.method !== 'GET') {
        const response = error(405, 'method_not_allowed');
        response.headers.set('Allow', 'GET');
        return response;
      }
      try {
        const result = await store.summary(request);
        return result === null ? unavailable() : json(result);
      } catch {
        return unavailable();
      }
    }
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
