import { periodSql } from '../auth/student-participation';
import { liveAccess, accessBindings, periodBindings, type AgentAccess } from './connections';
import { lineDiff, type LineDiff } from '../../src/shared/line-diff';
import { storedTasteLines, type TasteLine } from '../../src/shared/taste-ledger';

/**
 * The student's own taste ledger and the materials their agent distills it from (C23).
 * Every statement carries the live-access guard, and every row is read or written only for the
 * connected account: another student's drafts, reviews addressed to an author, and the author's
 * private data never appear. The server compares lines without AI; it never writes taste itself.
 */
export const MATERIAL_LIMITS = { reviews: 30, drafts: 8, staleDays: 14 } as const;
const DAY_MS = 24 * 60 * 60_000;

export interface TasteLedger {
  version: number;
  lines: TasteLine[];
}
export type LedgerWriteResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'unauthorized' | 'version_conflict' | 'not_enrolled' };

export interface TasteMaterials {
  /** Reviews the student wrote (only operators can write them today). Article title and URL path. */
  reviews: {
    articleId: string;
    articleTitle: string;
    verdict: string;
    points: string[];
    note: string;
    reviewedAt: number;
  }[];
  /** Drafts the agent wrote, and how the student's current draft / public article differ. */
  drafts: {
    draftId: string;
    agentVersion: number;
    currentVersion: number;
    recordedAt: number;
    titleChanged: boolean;
    toDraft: LineDiff;
    toPublished: LineDiff | null;
  }[];
  /** Agent-created drafts older than 14 days that the student has never published. */
  staleAgentDrafts: number;
}

export class AgentTasteStore {
  constructor(
    private readonly db: D1Database,
    private readonly clock: () => number = Date.now,
  ) {}
  private now() {
    const n = this.clock();
    if (!Number.isSafeInteger(n) || n < 0) throw Error('unavailable clock');
    return n;
  }

  /**
   * Keeps what the agent wrote, copied from the student's own draft row at exactly that version,
   * so a later diff compares against the agent's text and nothing else. Best effort: a missing
   * record only means one less material.
   */
  async recordAgentVersion(a: AgentAccess, draftId: string, draftVersion: number) {
    try {
      const now = this.now();
      await this.db
        .prepare(
          `INSERT INTO agent_draft_versions(draft_id,account_id,title,body,draft_version,recorded_at_ms) SELECT d.id,d.owner_account_id,d.title,d.body,d.version,? FROM private_article_drafts d WHERE d.id=? AND d.owner_account_id=? AND d.version=? AND ${liveAccess} ON CONFLICT(draft_id) DO UPDATE SET title=excluded.title,body=excluded.body,draft_version=excluded.draft_version,recorded_at_ms=excluded.recorded_at_ms`,
        )
        .bind(now, draftId, a.accountId, draftVersion, ...accessBindings(a, now))
        .run();
    } catch {
      /* material only */
    }
  }

  async readLedger(a: AgentAccess): Promise<TasteLedger | null> {
    try {
      const now = this.now();
      const rows = await this.db
        .prepare(
          `SELECT l.version,l.lines_json FROM (SELECT 1 WHERE ${liveAccess}) authorized LEFT JOIN agent_taste_ledgers l ON l.account_id=?`,
        )
        .bind(...accessBindings(a, now), a.accountId)
        .all<{ version: number | null; lines_json: string | null }>();
      if (!rows.results.length) return null;
      const row = rows.results[0];
      return { version: row.version ?? 0, lines: storedTasteLines(row.lines_json) };
    } catch {
      return null;
    }
  }

  /** Whole-ledger replacement with a version check. expectedVersion 0 creates the ledger. */
  async replaceLedger(
    a: AgentAccess,
    lines: TasteLine[],
    expectedVersion: number,
  ): Promise<LedgerWriteResult | null> {
    try {
      const now = this.now();
      const json = JSON.stringify(lines);
      const row =
        expectedVersion === 0
          ? await this.db
              .prepare(
                `INSERT INTO agent_taste_ledgers(account_id,version,lines_json,updated_at_ms) SELECT ?,1,?,? WHERE ${liveAccess} AND ${periodSql} ON CONFLICT(account_id) DO NOTHING RETURNING version`,
              )
              .bind(a.accountId, json, now, ...accessBindings(a, now), ...periodBindings(a, now))
              .first<{ version: number }>()
          : // Same batch: a line the student showed to operators stays shown only while its
            // kind and text survive the replacement; a changed line goes back to not shown (#243).
            ((
              await this.db.batch([
                this.db
                  .prepare(
                    `UPDATE agent_taste_ledgers SET version=version+1,lines_json=?,updated_at_ms=? WHERE account_id=? AND version=? AND updated_at_ms<=? AND ${liveAccess} AND ${periodSql} RETURNING version`,
                  )
                  .bind(
                    json,
                    now,
                    a.accountId,
                    expectedVersion,
                    now,
                    ...accessBindings(a, now),
                    ...periodBindings(a, now),
                  ),
                this.db
                  .prepare(
                    `DELETE FROM agent_taste_shares WHERE account_id=? AND NOT EXISTS(SELECT 1 FROM agent_taste_ledgers l,json_each(l.lines_json) j WHERE l.account_id=agent_taste_shares.account_id AND json_extract(j.value,'$.kind')=agent_taste_shares.kind AND json_extract(j.value,'$.text')=agent_taste_shares.text)`,
                  )
                  .bind(a.accountId),
              ])
            )[0].results[0] as { version: number } | undefined);
      if (row) return { ok: true, version: row.version };
      const state = await this.db
        .prepare(
          `SELECT (SELECT 1 WHERE ${liveAccess}) AS live,(SELECT 1 WHERE ${periodSql}) AS enrolled`,
        )
        .bind(...accessBindings(a, now), ...periodBindings(a, now))
        .first<{ live: number | null; enrolled: number | null }>();
      if (!state?.live) return { ok: false, reason: 'unauthorized' };
      if (!state.enrolled) return { ok: false, reason: 'not_enrolled' };
      return { ok: false, reason: 'version_conflict' };
    } catch {
      return null;
    }
  }

  async readMaterials(a: AgentAccess): Promise<TasteMaterials | null> {
    try {
      const now = this.now();
      const [live, reviews, drafts, stale] = await this.db.batch([
        this.db.prepare(`SELECT 1 AS live WHERE ${liveAccess}`).bind(...accessBindings(a, now)),
        this.db
          .prepare(
            `SELECT er.verdict,er.points_json,er.note,er.reviewed_at_ms,c.id AS content_id,c.title FROM editorial_reviews er JOIN content c ON c.id=er.content_id AND c.kind='article' AND c.status='published' AND c.is_sample=0 WHERE er.reviewer_account_id=? AND ${liveAccess} ORDER BY er.reviewed_at_ms DESC,er.id ASC LIMIT ${MATERIAL_LIMITS.reviews}`,
          )
          .bind(a.accountId, ...accessBindings(a, now)),
        this.db
          .prepare(
            `SELECT v.draft_id,v.title AS agent_title,v.body AS agent_body,v.draft_version,v.recorded_at_ms,d.title,d.body,d.version,(SELECT cur.body FROM article_publications r JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id AND c.kind='article' AND c.status='published' AND c.is_sample=0 JOIN article_publication_revisions cur ON cur.content_id=r.content_id WHERE r.draft_id=d.id AND r.owner_account_id=d.owner_account_id ORDER BY cur.revision DESC LIMIT 1) AS published_body FROM agent_draft_versions v JOIN private_article_drafts d ON d.id=v.draft_id AND d.owner_account_id=v.account_id WHERE v.account_id=? AND ${liveAccess} ORDER BY v.recorded_at_ms DESC,v.draft_id ASC LIMIT ${MATERIAL_LIMITS.drafts}`,
          )
          .bind(a.accountId, ...accessBindings(a, now)),
        this.db
          .prepare(
            `SELECT count(*) AS n FROM agent_draft_origins o WHERE o.account_id=? AND o.created_at_ms<=? AND NOT EXISTS(SELECT 1 FROM article_publications r WHERE r.draft_id=o.draft_id AND r.owner_account_id=o.account_id) AND ${liveAccess}`,
          )
          .bind(a.accountId, now - MATERIAL_LIMITS.staleDays * DAY_MS, ...accessBindings(a, now)),
      ]);
      if (!live.results.length) return null;
      return {
        reviews: (
          reviews.results as {
            verdict: string;
            points_json: string;
            note: string;
            reviewed_at_ms: number;
            content_id: string;
            title: string;
          }[]
        ).map((r) => {
          let points: string[] = [];
          try {
            const parsed = JSON.parse(r.points_json);
            if (Array.isArray(parsed)) points = parsed.filter((p) => typeof p === 'string');
          } catch {
            /* keep empty */
          }
          return {
            articleId: r.content_id,
            articleTitle: r.title,
            verdict: r.verdict,
            points,
            note: r.note,
            reviewedAt: r.reviewed_at_ms,
          };
        }),
        drafts: (
          drafts.results as {
            draft_id: string;
            agent_title: string;
            agent_body: string;
            draft_version: number;
            recorded_at_ms: number;
            title: string;
            body: string;
            version: number;
            published_body: string | null;
          }[]
        ).map((r) => ({
          draftId: r.draft_id,
          agentVersion: r.draft_version,
          currentVersion: r.version,
          recordedAt: r.recorded_at_ms,
          titleChanged: r.agent_title !== r.title,
          toDraft: lineDiff(r.agent_body, r.body),
          toPublished: r.published_body === null ? null : lineDiff(r.agent_body, r.published_body),
        })),
        staleAgentDrafts: (stale.results[0] as { n: number } | undefined)?.n ?? 0,
      };
    } catch {
      return null;
    }
  }
}
