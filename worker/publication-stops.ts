import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { SessionStore } from './auth/sessions';
import type { PublicationStopState } from '../src/publication-stop-types';
type Kind = 'article' | 'project';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const version = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
const config = (kind: Kind) =>
  kind === 'article'
    ? {
        records: 'article_publications',
        key: 'content_id',
        markers: 'article_publication_stops',
        markerKey: 'content_id',
        join: 'JOIN content c ON c.id=r.content_id',
        status: 'c.status',
        consistent: "c.kind='article' AND c.is_sample=0 AND c.author_id=r.public_profile_id",
      }
    : {
        records: 'project_publications',
        key: 'id',
        markers: 'project_publication_stops',
        markerKey: 'project_id',
        join: '',
        status: 'r.status',
        consistent: '1=1',
      };
type Row = {
  source_version: number;
  status: PublicationStopState['status'];
  published_at_ms: number;
  marker_id: string | null;
  marker_owner: string | null;
  marker_version: number | null;
  stopped_at_ms: number | null;
};
/** Local explicit owner stop; no restore, deletion or public-edit API. */
export class PublicationStopStore {
  private sessions: SessionStore;
  constructor(
    private db: D1Database,
    origin: string,
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  private async state(p: Proof, kind: Kind, id: string): Promise<PublicationStopState | null> {
    const c = config(kind);
    const r = await this.db
      .prepare(
        `SELECT r.source_version,${c.status} status,r.published_at_ms,m.${c.markerKey} marker_id,m.owner_account_id marker_owner,m.source_version marker_version,m.stopped_at_ms FROM ${c.records} r ${c.join} LEFT JOIN ${c.markers} m ON m.${c.markerKey}=r.${c.key} WHERE r.${c.key}=? AND r.owner_account_id=? AND ${c.consistent} AND ${live}`,
      )
      .bind(id, p.accountId, ...binds(p))
      .first<Row>();
    if (
      !r ||
      !version(r.source_version) ||
      !['published', 'hidden', 'deleted'].includes(r.status) ||
      !Number.isSafeInteger(r.published_at_ms) ||
      r.published_at_ms < 0 ||
      r.published_at_ms > p.nowMs ||
      r.published_at_ms > 253402300799999
    )
      return null;
    const stopped = r.marker_id !== null;
    if (
      stopped &&
      (r.marker_owner !== p.accountId ||
        r.marker_version !== r.source_version ||
        !Number.isSafeInteger(r.stopped_at_ms) ||
        r.stopped_at_ms! < r.published_at_ms ||
        r.stopped_at_ms! > p.nowMs ||
        r.status === 'published')
    )
      return null;
    return { kind, publicId: id, sourceVersion: r.source_version, status: r.status, stopped };
  }
  async getOwn(req: Request, kind: unknown, id: unknown): Promise<PublicationStopState | null> {
    if (req.method !== 'GET' || (kind !== 'article' && kind !== 'project') || !uuid(id))
      return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      return p ? await this.state(p, kind, id) : null;
    } catch {
      return null;
    }
  }
  async stop(
    req: Request,
    kind: unknown,
    id: unknown,
    input: unknown,
  ): Promise<PublicationStopState | null> {
    if (
      req.method !== 'POST' ||
      (kind !== 'article' && kind !== 'project') ||
      !uuid(id) ||
      !input ||
      typeof input !== 'object' ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== 2 ||
      !Object.hasOwn(input, 'expectedSourceVersion') ||
      !Object.hasOwn(input, 'confirmStop')
    )
      return null;
    const i = input as Record<string, unknown>;
    if (!version(i.expectedSourceVersion) || i.confirmStop !== true) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p || p.nowMs > 253402300799999) return null;
      const c = config(kind);
      await this.db
        .prepare(
          `INSERT INTO ${c.markers}(${c.markerKey},owner_account_id,source_version,stopped_at_ms) SELECT r.${c.key},r.owner_account_id,r.source_version,? FROM ${c.records} r ${c.join} WHERE r.${c.key}=? AND r.owner_account_id=? AND r.source_version=? AND r.published_at_ms<=? AND ${c.status}='published' AND ${c.consistent} AND ${live} ON CONFLICT(${c.markerKey}) DO NOTHING`,
        )
        .bind(p.nowMs, id, p.accountId, i.expectedSourceVersion, p.nowMs, ...binds(p))
        .run();
      const result = await this.state(p, kind, id);
      return result?.stopped && result.sourceVersion === i.expectedSourceVersion ? result : null;
    } catch {
      return null;
    }
  }
}
