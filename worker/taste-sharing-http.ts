import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as bindings } from './auth/session-guard';
import {
  liveStudentSessionSql as writerLive,
  liveStudentSessionBindings as writerBindings,
} from './auth/student-participation';
import { input } from './editorial-reviews-http';
import {
  decodeTasteAction,
  storedTasteLines,
  type OwnTasteView,
  type SharedTasteView,
  type TasteAction,
  type TasteLine,
} from '../src/shared/taste-ledger';

/** The student's own ledger on the account screen (C23 condition 4, #243). */
export const OWN_TASTE_PATH = '/api/private/my-taste';
/** Lines students chose to show, for operators only. Never carries who wrote them. */
export const SHARED_TASTE_PATH = '/api/private/editorial-taste/shared';
// Far above what one operator reads at once; keeps the response bounded.
const SHARED_ROWS = 200;
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
const sameLine = (a: TasteLine | undefined, kind: string, text: string) =>
  !!a && a.kind === kind && a.text === text;
type OwnRow = { version: number | null; lines_json: string | null; shared_json: string | null };
export type TasteActionResult =
  | { ok: true; view: OwnTasteView }
  | { ok: false; reason: 'unauthorized' | 'version_conflict' | 'not_enrolled' };

/**
 * Account-side management of the student's own taste ledger, and the operators' read of the
 * lines students chose to show. Every final statement re-checks the live session; showing a line
 * is a new participation and also needs the enrollment period, while reading, hiding and deleting
 * are cleanup that stays available after it. The agent (MCP) has no tool for any of this.
 */
export class TasteSharingStore {
  private readonly sessions: SessionStore;
  constructor(
    private readonly db: D1Database,
    origin: string,
    private readonly operatorIds: readonly string[],
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  private async view(p: Proof): Promise<OwnTasteView | null> {
    const row = await this.read(p);
    if (!row) return null;
    const shared = new Set<string>();
    try {
      const pairs: unknown = JSON.parse(row.shared_json ?? '[]');
      if (Array.isArray(pairs))
        for (const pair of pairs)
          if (Array.isArray(pair) && pair.length === 2) shared.add(JSON.stringify(pair));
    } catch {
      /* nothing shown */
    }
    return {
      version: row.version ?? 0,
      lines: storedTasteLines(row.lines_json).map((line) => ({
        ...line,
        shared: shared.has(JSON.stringify([line.kind, line.text])),
      })),
    };
  }
  async read(p: Proof): Promise<OwnRow | null> {
    return await this.db
      .prepare(
        `SELECT l.version,l.lines_json,(SELECT json_group_array(json_array(s.kind,s.text)) FROM agent_taste_shares s WHERE s.account_id=authorized.account_id) AS shared_json FROM (SELECT ? AS account_id WHERE ${live}) authorized LEFT JOIN agent_taste_ledgers l ON l.account_id=authorized.account_id`,
      )
      .bind(p.accountId, ...bindings(p))
      .first<OwnRow>();
  }
  async own(request: Request): Promise<OwnTasteView | null> {
    const p = await this.sessions.storageAuthorization(request);
    return p ? this.view(p) : null;
  }
  async act(request: Request, action: TasteAction): Promise<TasteActionResult> {
    const p = await this.sessions.storageAuthorization(request);
    if (!p) return { ok: false, reason: 'unauthorized' };
    const before = await this.view(p);
    if (!before) return { ok: false, reason: 'unauthorized' };
    if (
      before.version !== action.version ||
      !sameLine(before.lines[action.index], action.kind, action.text)
    )
      return { ok: false, reason: 'version_conflict' };
    if (action.op === 'delete') await this.remove(p, before, action);
    else if (action.op === 'share') await this.share(p, action);
    else await this.unshare(p, action);
    const after = await this.view(p);
    if (!after) return { ok: false, reason: 'unauthorized' };
    const line = after.lines.find((l) => sameLine(l, action.kind, action.text));
    if (action.op === 'delete') {
      if (after.version === before.version) return { ok: false, reason: 'version_conflict' };
    } else if (after.version !== before.version || !line) {
      return { ok: false, reason: 'version_conflict' };
    } else if (action.op === 'share' && !line.shared) {
      return { ok: false, reason: 'not_enrolled' };
    }
    return { ok: true, view: after };
  }
  /** Removes one line under the version check; a share of that text goes with it. */
  async remove(p: Proof, before: OwnTasteView, action: TasteAction) {
    const lines: TasteLine[] = before.lines
      .filter((_, i) => i !== action.index)
      .map(({ shared: _shared, ...line }) => line);
    const now = p.clock();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE agent_taste_ledgers SET version=version+1,lines_json=?,updated_at_ms=? WHERE account_id=? AND version=? AND updated_at_ms<=? AND ${live}`,
        )
        .bind(JSON.stringify(lines), now, p.accountId, action.version, now, ...bindings(p)),
      this.db
        .prepare(
          `DELETE FROM agent_taste_shares WHERE account_id=? AND NOT EXISTS(SELECT 1 FROM agent_taste_ledgers l,json_each(l.lines_json) j WHERE l.account_id=agent_taste_shares.account_id AND json_extract(j.value,'$.kind')=agent_taste_shares.kind AND json_extract(j.value,'$.text')=agent_taste_shares.text) AND ${live}`,
        )
        .bind(p.accountId, ...bindings(p)),
    ]);
  }
  async share(p: Proof, action: TasteAction) {
    await this.db
      .prepare(
        `INSERT INTO agent_taste_shares(account_id,kind,text,shared_at_ms) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM agent_taste_ledgers l,json_each(l.lines_json) j WHERE l.account_id=? AND l.version=? AND json_extract(j.value,'$.kind')=? AND json_extract(j.value,'$.text')=?) AND ${writerLive} ON CONFLICT(account_id,kind,text) DO NOTHING`,
      )
      .bind(
        p.accountId,
        action.kind,
        action.text,
        p.clock(),
        p.accountId,
        action.version,
        action.kind,
        action.text,
        ...writerBindings(p),
      )
      .run();
  }
  async unshare(p: Proof, action: TasteAction) {
    await this.db
      .prepare(
        `DELETE FROM agent_taste_shares WHERE account_id=? AND kind=? AND text=? AND ${live}`,
      )
      .bind(p.accountId, action.kind, action.text, ...bindings(p))
      .run();
  }
  /**
   * Shown lines that are still in their author's current ledger, newest first. The account id
   * is only a join key here: the DTO holds the line alone, so the operator cannot tell who wrote it.
   */
  async shared(request: Request): Promise<SharedTasteView | null> {
    const p = await this.sessions.storageAuthorization(request);
    if (!p || !this.operatorIds.includes(p.accountId)) return null;
    const { results } = await this.db
      .prepare(
        `SELECT j.value AS line FROM agent_taste_shares s JOIN private_accounts a ON a.id=s.account_id AND a.status='active' JOIN agent_taste_ledgers l ON l.account_id=s.account_id JOIN json_each(l.lines_json) j ON json_extract(j.value,'$.kind')=s.kind AND json_extract(j.value,'$.text')=s.text WHERE ${live} GROUP BY s.account_id,s.kind,s.text ORDER BY max(s.shared_at_ms) DESC,s.kind,s.text LIMIT ${SHARED_ROWS}`,
      )
      .bind(...bindings(p))
      .all<{ line: string }>();
    // One line at a time, so a malformed row drops alone instead of emptying the list.
    return {
      lines: results.flatMap((r) => storedTasteLines('[' + r.line + ']').slice(0, 1)),
    };
  }
}
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;

/** Closed unless enabled (R2 release flag TASTE_SHARING_RELEASE_ENABLED). */
export function createTasteSharingHandler(
  db: D1Database,
  origin: string,
  options: { enabled?: boolean; operatorIds?: readonly string[] } = {},
  clock: () => number = Date.now,
) {
  const store = new TasteSharingStore(db, origin, options.operatorIds ?? [], clock);
  return async (request: Request): Promise<Response | null> => {
    if (options.enabled !== true) return null;
    const url = new URL(request.url);
    const own = url.pathname === OWN_TASTE_PATH;
    if (!own && url.pathname !== SHARED_TASTE_PATH) return null;
    if (!canonicalOrigin(origin)) return error(503, 'taste_unavailable');
    if (url.search || url.hash) return error(404, 'taste_unavailable');
    const allowed = own ? ['GET', 'POST'] : ['GET'];
    if (!allowed.includes(request.method)) {
      const response = error(405, 'method_not_allowed');
      response.headers.set('Allow', allowed.join(', '));
      return response;
    }
    try {
      if (!own) {
        // Anyone but a live operator gets the same 404 as an unknown path.
        const result = await store.shared(request);
        return result ? json(result) : error(404, 'taste_unavailable');
      }
      if (request.method === 'GET') {
        const result = await store.own(request);
        return result ? json(result) : error(401, 'authentication_required');
      }
      const body = await input(request);
      if (!body.ok) return error(body.status, 'invalid_request');
      const action = decodeTasteAction(body.value);
      if (!action) return error(400, 'invalid_request');
      const result = await store.act(request, action);
      if (result.ok) return json(result.view);
      if (result.reason === 'unauthorized') return error(401, 'authentication_required');
      if (result.reason === 'not_enrolled') return error(403, 'not_enrolled');
      return error(409, 'version_conflict');
    } catch {
      return error(503, 'taste_unavailable');
    }
  };
}
