import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { ProjectReportStore } from './project-reports';
import type {
  ModerationDecisionInput,
  ModerationDecisionReceipt,
  ModerationDecisionState,
  ModerationCase,
  ModerationSummary,
} from '../src/editor/moderation-client';
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function decisionInput(v: unknown): v is ModerationDecisionInput {
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return false;
  const x = v as Record<string, unknown>,
    keys = Reflect.ownKeys(v);
  return (
    keys.length === 5 &&
    keys.every(
      (k) =>
        typeof k === 'string' &&
        ['decisionId', 'expectedRound', 'expectedVersion', 'action', 'reason'].includes(k),
    ) &&
    uuid(x.decisionId) &&
    x.expectedRound === 1 &&
    typeof x.expectedVersion === 'number' &&
    Number.isSafeInteger(x.expectedVersion) &&
    x.expectedVersion > 0 &&
    x.expectedVersion < 9007199254740990 &&
    (x.action === 'hide' || x.action === 'restore' || x.action === 'delete') &&
    typeof x.reason === 'string' &&
    !!x.reason.trim() &&
    !x.reason.includes('\0') &&
    Array.from(x.reason).length <= 1000 &&
    new TextEncoder().encode(x.reason).byteLength <= 4000 &&
    new TextDecoder().decode(new TextEncoder().encode(x.reason)) === x.reason
  );
}
/** Manual project judgments. Report count never changes visibility. */
export class ProjectModerationStore {
  private sessions: SessionStore;
  private reports: ProjectReportStore;
  private operators: readonly string[];
  constructor(
    private db: D1Database,
    origin: string,
    operatorIds: readonly string[] = [],
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
    this.operators =
      Array.isArray(operatorIds) &&
      operatorIds.length <= 10 &&
      operatorIds.every((v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))
        ? Object.freeze([...operatorIds])
        : [];
    this.reports = new ProjectReportStore(db, origin, this.operators, clock);
  }
  private async operator(req: Request) {
    const p = await this.sessions.storageAuthorization(req);
    return p && this.operators.includes(p.accountId) ? p : null;
  }
  async state(req: Request, id: unknown): Promise<ModerationDecisionState | null> {
    if (req.method !== 'GET' || !uuid(id)) return null;
    try {
      const p = await this.operator(req);
      if (!p) return null;
      const r = await this.db
        .prepare(
          `SELECT p.id contentId,1 round,s.version,p.status,(SELECT COUNT(*) FROM project_reports WHERE project_id=p.id) reportCount FROM project_moderation_state s JOIN project_publications p ON p.id=s.project_id WHERE p.id=? AND p.status IN ('published','hidden','deleted') AND ${live}`,
        )
        .bind(id, ...binds(p))
        .first<ModerationDecisionState>();
      return r &&
        Number.isSafeInteger(r.version) &&
        r.version > 0 &&
        r.version < 9007199254740990 &&
        Number.isSafeInteger(r.reportCount) &&
        r.reportCount > 0
        ? r
        : null;
    } catch {
      return null;
    }
  }
  async queue(req: Request): Promise<ModerationSummary[] | null> {
    if (req.method !== 'GET') return null;
    try {
      const p = await this.operator(req);
      if (!p) return null;
      // One bounded projection, including an authenticated-empty sentinel.
      const result = await this.db
        .prepare(
          `SELECT q.project_id contentId,CASE WHEN length(CAST(r.title AS BLOB))<=800 THEN r.title ELSE NULL END title,r.status,q.n reportCount,q.latest latestReportAt FROM (SELECT 1 WHERE ${live}) auth LEFT JOIN (SELECT project_id,COUNT(*) n,MAX(created_at_ms) latest FROM project_reports GROUP BY project_id) q ON 1=1 LEFT JOIN project_publications r ON r.id=q.project_id ORDER BY q.latest DESC,r.id ASC LIMIT 20`,
        )
        .bind(...binds(p))
        .all<ModerationSummary>();
      if (!result.results.length) return null;
      const rows = result.results.filter((row) => row.contentId !== null);
      return rows.every(
        (row) =>
          uuid(row.contentId) &&
          typeof row.title === 'string' &&
          !!row.title.trim() &&
          Array.from(row.title).length <= 200 &&
          !row.title.includes('\0') &&
          ['published', 'hidden', 'deleted'].includes(row.status) &&
          Number.isSafeInteger(row.reportCount) &&
          row.reportCount > 0 &&
          Number.isSafeInteger(row.latestReportAt) &&
          row.latestReportAt >= 0 &&
          row.latestReportAt <= p.nowMs,
      )
        ? rows
        : null;
    } catch {
      return null;
    }
  }
  async read(req: Request, id: unknown): Promise<ModerationCase | null> {
    const before = await this.state(req, id);
    if (!before) return null;
    const row = await this.reports.readCase(req, id);
    const after = await this.state(req, id);
    if (
      !row ||
      !after ||
      before.version !== after.version ||
      before.status !== after.status ||
      row.status !== after.status ||
      row.reportsTruncated !== after.reportCount > 20 ||
      row.reports.length !== Math.min(20, after.reportCount)
    )
      return null;
    return {
      contentId: row.project.id,
      title: row.project.title,
      status: row.status,
      reportCount: after.reportCount,
      latestReportAt: Math.max(...row.reports.map((r) => r.receivedAt)),
      body:
        row.project.description +
        (row.project.githubUrl ? '\n\nGitHub: ' + row.project.githubUrl : '') +
        (row.project.demoUrl ? '\n\nデモ: ' + row.project.demoUrl : ''),
      reports: row.reports.map((r) => ({
        reason: r.reason,
        detail: r.detail,
        createdAt: r.receivedAt,
      })),
      reportsTruncated: row.reportsTruncated,
    };
  }
  private async receipt(
    p: Proof,
    id: string,
    input: { decisionId: string } | ModerationDecisionInput,
  ): Promise<ModerationDecisionReceipt | null> {
    const exact = 'action' in input ? input : null;
    return this.db
      .prepare(
        `SELECT d.id decisionId,d.project_id contentId,d.action,d.reason,d.result_status resultStatus,1 resultRound,d.result_version resultVersion,o.state notification FROM project_moderation_decisions d JOIN project_moderation_outbox o ON o.decision_id=d.id WHERE d.id=? AND d.project_id=? AND d.operator_account_id=? AND (?=0 OR (d.expected_version=? AND d.action=? AND d.reason=?)) AND d.decided_at_ms<=? AND ${live}`,
      )
      .bind(
        input.decisionId,
        id,
        p.accountId,
        exact ? 1 : 0,
        exact?.expectedVersion ?? null,
        exact?.action ?? null,
        exact?.reason ?? null,
        p.clock(),
        ...binds(p),
      )
      .first<ModerationDecisionReceipt>();
  }
  async readDecision(req: Request, id: unknown, decisionId: unknown) {
    if (req.method !== 'GET' || !uuid(id) || !uuid(decisionId)) return null;
    try {
      const p = await this.operator(req);
      return p ? await this.receipt(p, id, { decisionId }) : null;
    } catch {
      return null;
    }
  }
  async decide(req: Request, id: unknown, input: unknown) {
    if (req.method !== 'POST' || !uuid(id) || !decisionInput(input) || input.expectedRound !== 1)
      return null;
    try {
      if (!(await this.sessions.authorizeMutation(req))) return null;
      const p = await this.operator(req);
      if (!p || p.nowMs > 253402300799999) return null;
      const prior = await this.receipt(p, id, input);
      if (prior) return prior;
      try {
        await this.db
          .prepare(
            `INSERT INTO project_moderation_decisions(id,project_id,operator_account_id,expected_version,action,reason,decided_at_ms,result_status,result_version) SELECT ?,p.id,?,?,?,?,?,CASE ? WHEN 'hide' THEN 'hidden' WHEN 'restore' THEN 'published' ELSE 'deleted' END,s.version+1 FROM project_publications p JOIN project_moderation_state s ON s.project_id=p.id WHERE p.id=? AND s.version=? AND ${live}`,
          )
          .bind(
            input.decisionId,
            p.accountId,
            input.expectedVersion,
            input.action,
            input.reason,
            p.nowMs,
            input.action,
            id,
            input.expectedVersion,
            ...binds(p),
          )
          .run();
      } catch {
        /* Exact actor-bound receipt reconciles concurrent retries only. */
      }
      return await this.receipt(p, id, input);
    } catch {
      return null;
    }
  }
}
