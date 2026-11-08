import {
  liveStudentSessionSql as writerLive,
  liveStudentSessionBindings as writerBindings,
} from './auth/student-participation';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { SessionStore } from './auth/sessions';
import { ProjectStore, decodeProjectSnapshot } from './projects';
import { publicProfileSqlBounds } from './publication';
import type {
  ProjectReportCaseSummary as ProjectCaseSummary,
  ProjectReportCase,
} from '../src/project-report-types';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
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
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
const profile = `${publicProfileSqlBounds} AND NOT EXISTS(SELECT 1 FROM private_accounts identity WHERE identity.id=p.id OR identity.google_subject=p.id)`;
const bounded = `length(CAST(r.title AS BLOB))<=800 AND length(CAST(r.description AS BLOB))<=16384 AND length(CAST(r.github_url AS BLOB))<=2048 AND length(CAST(r.demo_url AS BLOB))<=2048`;
const cols = 'p.id author_id,p.display_name,p.department,p.year_label,p.bio,p.initials';
type Row = {
  id: string;
  title: string;
  description: string;
  github_url: string;
  demo_url: string;
  published_at_ms: number;
  status: ProjectCaseSummary['status'];
  author_id: string;
  display_name: string;
  department: string;
  year_label: string;
  bio: string;
  initials: string;
  reason: string;
  detail: string;
  created_at_ms: number;
};
/** Fictional local intake and read-only review. No project moderation policy or actual operator grant. */
export class ProjectReportStore {
  private sessions: SessionStore;
  private projects: ProjectStore;
  private operators: readonly string[];
  constructor(
    private db: D1Database,
    origin: string,
    operatorIds: readonly string[] = [],
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
    this.projects = new ProjectStore(db, origin, clock);
    this.operators =
      Array.isArray(operatorIds) && operatorIds.length <= 10 && operatorIds.every(slug)
        ? Object.freeze([...operatorIds])
        : [];
  }
  async report(req: Request, id: unknown, value: unknown): Promise<{ received: true } | null> {
    if (req.method !== 'POST' || !uuid(id) || !input(value)) return null;
    try {
      if (!(await this.sessions.authorizeMutation(req))) return null;
      const target = await this.projects.readPublished(id);
      if (!target) return null;
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const f = target.project;
      const row = await this.db
        .prepare(
          `INSERT INTO project_reports(id,project_id,reporter_account_id,reason,detail,created_at_ms) SELECT ?,r.id,?,?,?,? FROM project_publications r JOIN public_profiles p ON p.id=r.public_profile_id WHERE r.id=? AND r.status='published' AND r.title=? AND r.description=? AND r.github_url=? AND r.demo_url=? AND r.public_profile_id=? AND ${bounded} AND ${profile} AND ${writerLive} AND NOT EXISTS(SELECT 1 FROM project_reports future WHERE future.project_id=r.id AND future.created_at_ms>?) ON CONFLICT(project_id,reporter_account_id) DO UPDATE SET id=project_reports.id RETURNING id`,
        )
        .bind(
          crypto.randomUUID(),
          p.accountId,
          value.reason,
          value.detail ?? '',
          p.nowMs,
          id,
          f.title,
          f.description,
          f.githubUrl,
          f.demoUrl,
          target.author.id,
          ...writerBindings(p),
          p.nowMs,
        )
        .first();
      return row ? { received: true } : null;
    } catch {
      return null;
    }
  }
  async getOwnReceipt(req: Request, id: unknown): Promise<{ received: boolean } | null> {
    if (req.method !== 'GET' || !uuid(id)) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const row = await this.db
        .prepare(
          `SELECT q.id receipt FROM project_publications r LEFT JOIN project_reports q ON q.project_id=r.id AND q.reporter_account_id=? WHERE r.id=? AND r.status IN ('published','hidden','deleted') AND q.id IS NOT NULL AND q.created_at_ms<=? AND ${live}`,
        )
        .bind(p.accountId, id, p.nowMs, ...binds(p))
        .first();
      if (row) return { received: true };
      const target = await this.projects.readPublished(id);
      if (!target) return null;
      const fresh = await this.sessions.storageAuthorization(req);
      if (!fresh) return null;
      const r = await this.db
        .prepare(
          `SELECT q.id receipt FROM project_publications r LEFT JOIN project_reports q ON q.project_id=r.id AND q.reporter_account_id=? JOIN public_profiles p ON p.id=r.public_profile_id WHERE r.id=? AND r.status='published' AND r.title=? AND r.description=? AND r.github_url=? AND r.demo_url=? AND ${bounded} AND ${profile} AND (q.id IS NULL OR q.created_at_ms<=?) AND ${live}`,
        )
        .bind(
          fresh.accountId,
          id,
          target.project.title,
          target.project.description,
          target.project.githubUrl,
          target.project.demoUrl,
          fresh.nowMs,
          ...binds(fresh),
        )
        .first<{ receipt: string | null }>();
      return r ? { received: r.receipt !== null } : null;
    } catch {
      return null;
    }
  }
  private async operator(req: Request) {
    if (req.method !== 'GET' || !this.operators.length) return null;
    const p = await this.sessions.storageAuthorization(req);
    return p && this.operators.includes(p.accountId) ? p : null;
  }
  async queue(req: Request): Promise<ProjectCaseSummary[] | null> {
    try {
      const p = await this.operator(req);
      if (!p) return null;
      const rs = await this.db
        .prepare(
          `SELECT q.project_id reported_target,r.id,CASE WHEN length(CAST(r.title AS BLOB))<=800 THEN r.title ELSE NULL END title,r.status,q.latest FROM (SELECT 1 WHERE ${live}) auth LEFT JOIN (SELECT project_id,MAX(created_at_ms) latest FROM project_reports GROUP BY project_id) q ON 1=1 LEFT JOIN project_publications r ON r.id=q.project_id ORDER BY q.latest DESC,r.id ASC LIMIT 20`,
        )
        .bind(...binds(p))
        .all<{
          reported_target: string | null;
          id: string | null;
          title: string;
          status: ProjectCaseSummary['status'];
          latest: number;
        }>();
      if (!rs.results.length) return null;
      const result: ProjectCaseSummary[] = [];
      for (const r of rs.results) {
        if (r.reported_target === null) continue;
        if (
          !uuid(r.id) ||
          !text(r.title, 200) ||
          !r.title.trim() ||
          !['published', 'hidden', 'deleted'].includes(r.status) ||
          !Number.isSafeInteger(r.latest) ||
          r.latest < 0 ||
          r.latest > p.nowMs
        )
          return null;
        result.push({
          projectId: r.id,
          title: r.title,
          status: r.status,
          latestReportAt: r.latest,
        });
      }
      return result;
    } catch {
      return null;
    }
  }
  async readCase(req: Request, id: unknown): Promise<ProjectReportCase | null> {
    if (!uuid(id)) return null;
    try {
      const p = await this.operator(req);
      if (!p) return null;
      const rs = await this.db
        .prepare(
          `SELECT r.*,${cols},CASE WHEN length(CAST(q.reason AS BLOB))<=800 THEN q.reason ELSE NULL END reason,CASE WHEN length(CAST(q.detail AS BLOB))<=8000 THEN q.detail ELSE NULL END detail,q.created_at_ms FROM project_publications r JOIN public_profiles p ON p.id=r.public_profile_id JOIN project_reports q ON q.project_id=r.id WHERE r.id=? AND r.status IN ('published','hidden','deleted') AND ${bounded} AND ${profile} AND ${live} ORDER BY q.created_at_ms DESC,q.id ASC LIMIT 21`,
        )
        .bind(id, ...binds(p))
        .all<Row>();
      if (!rs.results.length) return null;
      const decoded = decodeProjectSnapshot(rs.results[0]);
      if (
        !decoded ||
        rs.results.some(
          (r) =>
            !text(r.reason, 200) ||
            !r.reason.trim() ||
            !text(r.detail, 2000) ||
            !Number.isSafeInteger(r.created_at_ms) ||
            r.created_at_ms < 0 ||
            r.created_at_ms > p.nowMs,
        )
      )
        return null;
      const result = {
        ...decoded,
        status: rs.results[0].status,
        reports: rs.results
          .slice(0, 20)
          .map((r) => ({ reason: r.reason, detail: r.detail, receivedAt: r.created_at_ms })),
        reportsTruncated: rs.results.length > 20,
      };
      return new TextEncoder().encode(JSON.stringify(result)).length <= 262144 ? result : null;
    } catch {
      return null;
    }
  }
}
