import {
  liveStudentSessionSql as writerLive,
  liveStudentSessionBindings as writerBindings,
} from './auth/student-participation';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { SessionStore } from './auth/sessions';
import { decodePublicProfile, publicProfileSqlBounds } from './publication';
import { avatarVersion, publicAvatarPath } from '../src/shared/avatar';
import type {
  ProfileReportCase,
  ProfileReportCaseSummary,
  ProfileReportReceipt,
} from '../src/profile-report-types';
const slug = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const text = (v: unknown, n: number): v is string =>
  typeof v === 'string' &&
  v.length <= n * 2 &&
  !v.includes('\0') &&
  Array.from(v).length <= n &&
  new TextDecoder().decode(new TextEncoder().encode(v)) === v;
function input(v: unknown): v is { reason: string; detail?: string } {
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return false;
  const x = v as Record<string, unknown>,
    k = Reflect.ownKeys(v);
  return (
    k.includes('reason') &&
    k.every((k) => k === 'reason' || k === 'detail') &&
    text(x.reason, 200) &&
    !!x.reason.trim() &&
    (!k.includes('detail') ||
      (text(x.detail, 2000) && new TextEncoder().encode(x.detail).length <= 8000))
  );
}
// Same public eligibility as /api/students: a non-sample, bounded profile that is not an
// identity value and currently has at least one published article or project.
const profile = `${publicProfileSqlBounds} AND NOT EXISTS(SELECT 1 FROM private_accounts identity WHERE identity.id=p.id OR identity.google_subject=p.id)`;
const visible = `(EXISTS(SELECT 1 FROM content c WHERE c.author_id=p.id AND c.kind='article' AND c.status='published' AND c.is_sample=0) OR EXISTS(SELECT 1 FROM project_publications r WHERE r.public_profile_id=p.id AND r.status='published'))`;
const cols = 'p.id author_id,p.display_name,p.department,p.year_label,p.bio,p.initials';
type CaseRow = {
  author_id: string;
  display_name: string;
  department: string;
  year_label: string;
  bio: string;
  initials: string;
  reason: string | null;
  detail: string | null;
  reported_name: string;
  reported_department: string;
  reported_year: string;
  reported_bio: string;
  created_at_ms: number;
  report_count: number;
  avatar_version: string | null;
};
/** Private profile report intake and operator read-only review. No automatic hide. */
export class ProfileReportStore {
  private sessions: SessionStore;
  private operators: readonly string[];
  constructor(
    private db: D1Database,
    origin: string,
    operatorIds: readonly string[] = [],
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
    this.operators =
      Array.isArray(operatorIds) && operatorIds.length <= 10 && operatorIds.every(slug)
        ? Object.freeze([...operatorIds])
        : [];
  }
  async report(req: Request, id: unknown, value: unknown): Promise<{ received: true } | null> {
    if (req.method !== 'POST' || !slug(id) || !input(value)) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      // The snapshot columns copy the public text the reporter is reporting, never identity data.
      const row = await this.db
        .prepare(
          `INSERT INTO profile_reports(id,public_profile_id,reporter_account_id,reason,detail,display_name,department,year_label,bio,created_at_ms) SELECT ?,p.id,?,?,?,p.display_name,p.department,p.year_label,p.bio,? FROM public_profiles p WHERE p.id=? AND ${profile} AND ${visible} AND NOT EXISTS(SELECT 1 FROM account_public_profiles own WHERE own.owner_account_id=? AND own.public_profile_id=p.id) AND ${writerLive} AND NOT EXISTS(SELECT 1 FROM profile_reports future WHERE future.public_profile_id=p.id AND future.created_at_ms>?) ON CONFLICT(public_profile_id,reporter_account_id) DO UPDATE SET id=profile_reports.id RETURNING id`,
        )
        .bind(
          crypto.randomUUID(),
          p.accountId,
          value.reason,
          value.detail ?? '',
          p.nowMs,
          id,
          p.accountId,
          ...writerBindings(p),
          p.nowMs,
        )
        .first();
      return row ? { received: true } : null;
    } catch {
      return null;
    }
  }
  /** Own receipt only. The author's own profile and hidden/unknown profiles stay unavailable. */
  async getOwnReceipt(req: Request, id: unknown): Promise<ProfileReportReceipt | null> {
    if (req.method !== 'GET' || !slug(id)) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const row = await this.db
        .prepare(
          `SELECT q.id receipt FROM public_profiles p LEFT JOIN profile_reports q ON q.public_profile_id=p.id AND q.reporter_account_id=? WHERE p.id=? AND ${profile} AND (q.id IS NOT NULL OR ${visible}) AND (q.id IS NULL OR q.created_at_ms<=?) AND NOT EXISTS(SELECT 1 FROM account_public_profiles own WHERE own.owner_account_id=? AND own.public_profile_id=p.id) AND ${live}`,
        )
        .bind(p.accountId, id, p.nowMs, p.accountId, ...binds(p))
        .first<{ receipt: string | null }>();
      return row ? { received: row.receipt !== null } : null;
    } catch {
      return null;
    }
  }
  private async operator(req: Request) {
    if (req.method !== 'GET' || !this.operators.length) return null;
    const p = await this.sessions.storageAuthorization(req);
    return p && this.operators.includes(p.accountId) ? p : null;
  }
  async queue(req: Request): Promise<ProfileReportCaseSummary[] | null> {
    try {
      const p = await this.operator(req);
      if (!p) return null;
      const rs = await this.db
        .prepare(
          `SELECT q.public_profile_id reported_target,p.id,CASE WHEN length(CAST(p.display_name AS BLOB))<=320 THEN p.display_name ELSE NULL END display_name,q.report_count,q.latest FROM (SELECT 1 WHERE ${live}) auth LEFT JOIN (SELECT public_profile_id,COUNT(*) report_count,MAX(created_at_ms) latest FROM profile_reports GROUP BY public_profile_id) q ON 1=1 LEFT JOIN public_profiles p ON p.id=q.public_profile_id ORDER BY q.latest DESC,p.id ASC LIMIT 20`,
        )
        .bind(...binds(p))
        .all<{
          reported_target: string | null;
          id: string | null;
          display_name: string | null;
          report_count: number;
          latest: number;
        }>();
      if (!rs.results.length) return null;
      const result: ProfileReportCaseSummary[] = [];
      for (const r of rs.results) {
        if (r.reported_target === null) continue;
        if (
          !slug(r.id) ||
          !text(r.display_name, 80) ||
          !r.display_name.trim() ||
          !Number.isSafeInteger(r.report_count) ||
          r.report_count < 1 ||
          !Number.isSafeInteger(r.latest) ||
          r.latest < 0 ||
          r.latest > p.nowMs
        )
          return null;
        result.push({
          profileId: r.id,
          displayName: r.display_name,
          reportCount: r.report_count,
          latestReportAt: r.latest,
        });
      }
      return result;
    } catch {
      return null;
    }
  }
  async readCase(req: Request, id: unknown): Promise<ProfileReportCase | null> {
    if (!slug(id)) return null;
    try {
      const p = await this.operator(req);
      if (!p) return null;
      const rs = await this.db
        .prepare(
          `SELECT ${cols},CASE WHEN length(CAST(q.reason AS BLOB))<=800 THEN q.reason ELSE NULL END reason,CASE WHEN length(CAST(q.detail AS BLOB))<=8000 THEN q.detail ELSE NULL END detail,q.display_name reported_name,q.department reported_department,q.year_label reported_year,q.bio reported_bio,q.created_at_ms,(SELECT COUNT(*) FROM profile_reports total WHERE total.public_profile_id=p.id) report_count,(SELECT substr(a.sha256,1,16) FROM profile_avatars a WHERE a.public_profile_id=p.id) avatar_version FROM public_profiles p JOIN profile_reports q ON q.public_profile_id=p.id WHERE p.id=? AND ${profile} AND ${live} ORDER BY q.created_at_ms DESC,q.id ASC LIMIT 20`,
        )
        .bind(id, ...binds(p))
        .all<CaseRow>();
      if (!rs.results.length) return null;
      const author = decodePublicProfile(rs.results[0]);
      if (
        !author ||
        rs.results.some(
          (r) =>
            !text(r.reason, 200) ||
            !r.reason.trim() ||
            !text(r.detail, 2000) ||
            !text(r.reported_name, 80) ||
            !text(r.reported_department, 80) ||
            !text(r.reported_year, 32) ||
            !text(r.reported_bio, 800) ||
            !Number.isSafeInteger(r.created_at_ms) ||
            r.created_at_ms < 0 ||
            r.created_at_ms > p.nowMs ||
            r.report_count !== rs.results[0].report_count ||
            r.avatar_version !== rs.results[0].avatar_version,
        )
      )
        return null;
      const version = rs.results[0].avatar_version;
      if (version !== null && !avatarVersion(version)) return null;
      const result: ProfileReportCase = {
        profile: author,
        avatar: version === null ? null : publicAvatarPath(author.id, version),
        reports: rs.results.map((r) => ({
          reason: r.reason!,
          detail: r.detail!,
          receivedAt: r.created_at_ms,
          reported: {
            name: r.reported_name,
            department: r.reported_department,
            year: r.reported_year,
            bio: r.reported_bio,
          },
        })),
        reportsTruncated: rs.results[0].report_count > rs.results.length,
      };
      return new TextEncoder().encode(JSON.stringify(result)).length <= 262144 ? result : null;
    } catch {
      return null;
    }
  }
  /** Operator takes down the exact icon they reviewed; the reason reaches the owner's notices. */
  async removeAvatar(req: Request, id: unknown, value: unknown): Promise<{ removed: true } | null> {
    if (req.method !== 'POST' || !slug(id) || !this.operators.length) return null;
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
      return null;
    const v = value as Record<string, unknown>;
    if (
      Reflect.ownKeys(v).length !== 2 ||
      !avatarVersion(v.avatar) ||
      !text(v.reason, 1000) ||
      !v.reason.trim() ||
      new TextEncoder().encode(v.reason).length > 4000
    )
      return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p || !this.operators.includes(p.accountId)) return null;
      const row = await this.db
        .prepare(
          `INSERT INTO profile_avatar_removals(id,public_profile_id,owner_account_id,operator_account_id,sha256,reason,decided_at_ms) SELECT ?,a.public_profile_id,m.owner_account_id,?,a.sha256,?,? FROM profile_avatars a JOIN account_public_profiles m ON m.public_profile_id=a.public_profile_id WHERE a.public_profile_id=? AND substr(a.sha256,1,16)=? AND EXISTS(SELECT 1 FROM profile_reports q WHERE q.public_profile_id=a.public_profile_id) AND ${live} RETURNING id`,
        )
        .bind(crypto.randomUUID(), p.accountId, v.reason, p.nowMs, id, v.avatar, ...binds(p))
        .first();
      return row ? { removed: true } : null;
    } catch {
      return null;
    }
  }
}
