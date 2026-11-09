import { SessionStore } from './auth/sessions';
import { publicArticleSqlBounds } from './publication';
import { publicProjectSqlBounds } from './projects';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import {
  isReadingReference,
  type ReadingReference,
  type ReadingHistoryPage,
} from '../src/history/types';

// Only currently public canonical references can be recorded or resolve to a title.
// No body, author, media, email or withdrawn title is copied into private history.
const titleBounds = (alias: string) =>
  `length(${alias}.title) BETWEEN 1 AND 200 AND length(CAST(${alias}.title AS BLOB))<=800 AND instr(${alias}.title,char(0))=0`;
const visible = `
 SELECT c.kind,c.id content_id,c.title,c.is_sample FROM requested q JOIN content c ON c.id=q.content_id AND c.kind=q.kind JOIN public_profiles p ON p.id=c.author_id
 WHERE c.status='published' AND ${titleBounds('c')} AND (
 (c.is_sample=1 AND p.is_sample=1) OR
 (${publicArticleSqlBounds} AND EXISTS(
 SELECT 1 FROM article_publications r
 WHERE r.content_id=c.id AND r.public_profile_id=c.author_id)))
 UNION ALL
 SELECT 'project',r.id,r.title,0 FROM requested q JOIN project_publications r ON r.id=q.content_id AND q.kind='project'
 JOIN public_profiles p ON p.id=r.public_profile_id AND p.is_sample=0
 WHERE ${publicProjectSqlBounds} AND ${titleBounds('r')}`;
const targetCTE = `visible_targets AS MATERIALIZED(${visible})`;
export class ReadingHistoryStore {
  private readonly sessions: SessionStore;
  constructor(
    private readonly db: D1Database,
    origin: string,
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  async record(request: Request, reference: unknown): Promise<boolean | null> {
    if (request.method !== 'PUT' || !isReadingReference(reference)) return null;
    try {
      if (!(await this.sessions.authorizeMutation(request))) return null;
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      const r = await this.db
        .prepare(
          `WITH requested(kind,content_id) AS (VALUES(?,?)), ${targetCTE}
        INSERT INTO private_reading_history(owner_account_id,kind,content_id,last_viewed_at_ms)
        SELECT ?,v.kind,v.content_id,? FROM visible_targets v WHERE v.kind=? AND v.content_id=?
        AND ${live}
        AND COALESCE((SELECT enabled FROM private_reading_history_settings WHERE owner_account_id=?),1)=1
        AND (EXISTS(SELECT 1 FROM private_reading_history WHERE owner_account_id=? AND kind=v.kind AND content_id=v.content_id)
          OR (SELECT count(*) FROM private_reading_history WHERE owner_account_id=?)<500)
        ON CONFLICT(owner_account_id,kind,content_id) DO UPDATE SET last_viewed_at_ms=MAX(private_reading_history.last_viewed_at_ms,excluded.last_viewed_at_ms)
        RETURNING content_id`,
        )
        .bind(
          reference.kind,
          reference.contentId,
          p.accountId,
          p.nowMs,
          reference.kind,
          reference.contentId,
          ...binds(p),
          p.accountId,
          p.accountId,
          p.accountId,
        )
        .first();
      // Disabled, capacity reached, and unavailable targets are intentionally indistinguishable.
      return !!r;
    } catch {
      return null;
    }
  }
  async list(request: Request, offset: number): Promise<ReadingHistoryPage | null> {
    if (request.method !== 'GET' || !Number.isInteger(offset) || offset < 0 || offset > 500)
      return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      // One statement checks current authority, membership and visibility at the final read.
      const rows = await this.db
        .prepare(
          `WITH page AS MATERIALIZED(SELECT h.kind,h.content_id,h.last_viewed_at_ms FROM private_reading_history h
        WHERE h.owner_account_id=? ORDER BY h.last_viewed_at_ms DESC,h.kind,h.content_id LIMIT 21 OFFSET ?),
        requested AS MATERIALIZED(SELECT kind,content_id FROM page), ${targetCTE},
        authorized AS MATERIALIZED(SELECT COALESCE((SELECT enabled FROM private_reading_history_settings WHERE owner_account_id=?),1) enabled WHERE ${live})
        SELECT auth.enabled,page.*,v.title,v.is_sample FROM authorized auth LEFT JOIN page ON 1=1
        LEFT JOIN visible_targets v ON v.kind=page.kind AND v.content_id=page.content_id
        ORDER BY page.last_viewed_at_ms DESC,page.kind,page.content_id`,
        )
        .bind(p.accountId, offset, p.accountId, ...binds(p))
        .all<{
          enabled: number;
          kind: ReadingReference['kind'] | null;
          content_id: string | null;
          last_viewed_at_ms: number | null;
          title: string | null;
          is_sample: number | null;
        }>();
      if (
        !rows.results.length ||
        rows.results.some((r) => r.title !== null && r.is_sample !== 0 && r.is_sample !== 1)
      )
        return null;
      const entries = rows.results
        .filter((r) => r.kind !== null)
        .map((r) => ({
          kind: r.kind!,
          contentId: r.content_id!,
          lastViewedAt: r.last_viewed_at_ms!,
          title: r.title,
          isSample: r.title === null ? null : r.is_sample === 1,
        }));
      if (
        entries.some(
          (r) =>
            !isReadingReference({ kind: r.kind, contentId: r.contentId }) ||
            !Number.isSafeInteger(r.lastViewedAt) ||
            r.lastViewedAt < 0 ||
            (r.title !== null &&
              (typeof r.title !== 'string' ||
                Array.from(r.title).length > 200 ||
                r.title.includes('\0'))),
        )
      )
        return null;
      return {
        entries: entries.slice(0, 20),
        enabled: rows.results[0].enabled === 1,
        nextOffset: entries.length > 20 ? offset + 20 : null,
        capacity: 500,
      };
    } catch {
      return null;
    }
  }
  async remove(request: Request, reference?: ReadingReference): Promise<boolean> {
    if (request.method !== 'DELETE' || (reference !== undefined && !isReadingReference(reference)))
      return false;
    try {
      if (!(await this.sessions.authorizeMutation(request))) return false;
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return false;
      const condition = reference ? ' AND kind=? AND content_id=?' : '';
      await this.db.batch([
        this.db
          .prepare(
            `DELETE FROM private_reading_history WHERE owner_account_id=?${condition} AND ${live}`,
          )
          .bind(
            p.accountId,
            ...(reference ? [reference.kind, reference.contentId] : []),
            ...binds(p),
          ),
        this.db
          .prepare(
            `SELECT CASE WHEN ${live} AND NOT EXISTS(SELECT 1 FROM private_reading_history WHERE owner_account_id=?${condition}) THEN 1 ELSE json('') END guarded`,
          )
          .bind(
            ...binds(p),
            p.accountId,
            ...(reference ? [reference.kind, reference.contentId] : []),
          ),
      ]);
      return true;
    } catch {
      return false;
    }
  }
  async setEnabled(request: Request, enabled: boolean): Promise<boolean> {
    if (request.method !== 'PATCH' || typeof enabled !== 'boolean') return false;
    try {
      if (!(await this.sessions.authorizeMutation(request))) return false;
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return false;
      return !!(await this.db
        .prepare(
          `INSERT INTO private_reading_history_settings(owner_account_id,enabled) SELECT ?,? WHERE ${live} ON CONFLICT(owner_account_id) DO UPDATE SET enabled=excluded.enabled RETURNING enabled`,
        )
        .bind(p.accountId, Number(enabled), ...binds(p))
        .first());
    } catch {
      return false;
    }
  }
}
