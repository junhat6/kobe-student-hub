import type { EmailDeliverySummary, OwnModerationNotice } from '../src/notification-types';
import {
  liveStudentSessionSql as writerLive,
  liveStudentSessionBindings as writerBindings,
} from './auth/student-participation';
import { liveSessionSql as live, liveSessionBindings as bindings } from './auth/session-guard';
import { SessionStore } from './auth/sessions';
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
export interface ModerationSummary {
  contentId: string;
  title: string;
  status: 'published' | 'hidden';
  reportCount: number;
  latestReportAt: number;
}
export interface ModerationCase extends ModerationSummary {
  body: string;
  reports: { reason: string; detail: string; createdAt: number }[];
}
export interface ModerationDecisionState {
  contentId: string;
  round: number;
  version: number;
  status: 'published' | 'hidden' | 'deleted';
  reportCount: number;
}
export interface ModerationDecisionReceipt {
  decisionId: string;
  contentId: string;
  action: 'restore' | 'delete';
  reason: string;
  resultStatus: 'published' | 'deleted';
  resultRound: number;
  resultVersion: number;
  notification: 'pending';
}
type DecisionInput = {
  decisionId: string;
  expectedRound: number;
  expectedVersion: number;
  action: 'restore' | 'delete';
  reason: string;
};
const version = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v < 9007199254740990;
const idValid = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length <= max * 2 &&
  !v.includes('\0') &&
  Array.from(v).length <= max &&
  new TextDecoder().decode(new TextEncoder().encode(v)) === v;
function reportInput(v: unknown): v is { reason: string; detail?: string } {
  if (
    v === null ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Object.prototype
  )
    return false;
  const keys = Reflect.ownKeys(v);
  if (!keys.includes('reason') || keys.some((k) => k !== 'reason' && k !== 'detail')) return false;
  const x = v as Record<string, unknown>;
  return (
    text(x.reason, 200) &&
    x.reason.trim().length > 0 &&
    ((x.detail === undefined && !keys.includes('detail')) ||
      (text(x.detail, 2000) && new TextEncoder().encode(x.detail).byteLength <= 8000))
  );
}
function decisionInput(v: unknown): v is DecisionInput {
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(v);
  if (
    keys.length !== 5 ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !['decisionId', 'expectedRound', 'expectedVersion', 'action', 'reason'].includes(key),
    )
  )
    return false;
  const x = v as Record<string, unknown>;
  return (
    typeof x.decisionId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x.decisionId) &&
    version(x.expectedRound) &&
    version(x.expectedVersion) &&
    (x.action === 'restore' || x.action === 'delete') &&
    text(x.reason, 1000) &&
    !!x.reason.trim() &&
    new TextEncoder().encode(x.reason).byteLength <= 4000
  );
}
const emailColumns = `o.id outboxId,o.content_id contentId,(SELECT CASE WHEN length(c.title)<=200 AND length(CAST(c.title AS BLOB))<=800 THEN c.title ELSE NULL END FROM content c WHERE c.id=o.content_id) title,o.event,o.report_count reportCount,o.created_at_ms createdAt,CASE WHEN d.state='leased' AND d.lease_until_ms<=? THEN 'unknown' ELSE COALESCE(d.state,'pending') END state,COALESCE(d.attempts,0) attempts,d.retry_command_id retryCommandId`;
function emailSummary(row: EmailDeliverySummary): boolean {
  return (
    idValid(row.outboxId) &&
    idValid(row.contentId) &&
    text(row.title, 200) &&
    ['report_received', 'temporarily_hidden'].includes(row.event) &&
    Number.isInteger(row.reportCount) &&
    row.reportCount >= 1 &&
    row.reportCount <= 3 &&
    Number.isSafeInteger(row.createdAt) &&
    row.createdAt >= 0 &&
    row.createdAt <= 253402300799999 &&
    ['pending', 'ready', 'leased', 'accepted', 'failed', 'unknown'].includes(row.state) &&
    Number.isInteger(row.attempts) &&
    row.attempts >= 0 &&
    row.attempts <= 3 &&
    (row.retryCommandId === null || /^[0-9a-f-]{36}$/.test(row.retryCommandId))
  );
}
/** Server-private reports and trusted operator decisions. Notification delivery is unconfigured. */
export class ArticleModerationStore {
  private readonly sessions: SessionStore;
  private readonly operators: readonly string[];
  constructor(
    private readonly db: D1Database,
    origin: string,
    operatorIds: readonly string[] = [],
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
    this.operators =
      Array.isArray(operatorIds) && operatorIds.length <= 10 && operatorIds.every(idValid)
        ? Object.freeze([...operatorIds])
        : [];
  }
  async report(
    request: Request,
    targetId: unknown,
    input: unknown,
  ): Promise<{ received: true } | null> {
    if (request.method !== 'POST' || !idValid(targetId) || !reportInput(input)) return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      const row = await this.db
        .prepare(
          `INSERT INTO article_reports(id,content_id,reporter_account_id,round,reason,detail,created_at_ms)
    SELECT ?,id,?,COALESCE((SELECT round FROM article_moderation_state WHERE content_id=content.id),1),?,?,? FROM content WHERE id=? AND kind='article' AND status='published' AND ${writerLive}
    AND NOT EXISTS(SELECT 1 FROM article_reports WHERE content_id=content.id AND round=COALESCE((SELECT round FROM article_moderation_state WHERE content_id=content.id),1) AND created_at_ms>?)
    ON CONFLICT(content_id,round,reporter_account_id) DO UPDATE SET id=article_reports.id RETURNING id`,
        )
        .bind(
          crypto.randomUUID(),
          p.accountId,
          input.reason,
          input.detail ?? '',
          p.nowMs,
          targetId,
          ...writerBindings(p),
          p.nowMs,
        )
        .first();
      return row ? { received: true } : null;
    } catch {
      return null;
    }
  }
  async getOwnReport(request: Request, targetId: unknown): Promise<{ received: boolean } | null> {
    if (request.method !== 'GET' || !idValid(targetId)) return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      const row = await this.db
        .prepare(
          `SELECT r.id receipt FROM content c LEFT JOIN article_reports r ON r.content_id=c.id AND r.reporter_account_id=? AND r.round=COALESCE((SELECT round FROM article_moderation_state WHERE content_id=c.id),1)
    WHERE c.id=? AND c.kind='article' AND c.status IN ('published','hidden') AND (r.id IS NOT NULL OR c.status='published') AND (r.created_at_ms IS NULL OR r.created_at_ms<=?) AND ${live}`,
        )
        .bind(p.accountId, targetId, p.nowMs, ...bindings(p))
        .first<{ receipt: string | null }>();
      return row ? { received: row.receipt !== null } : null;
    } catch {
      return null;
    }
  }
  private async operator(request: Request) {
    if (!['GET', 'POST'].includes(request.method) || !this.operators.length) return null;
    const p = await this.sessions.storageAuthorization(request);
    return p && this.operators.includes(p.accountId) ? p : null;
  }
  async queue(request: Request): Promise<ModerationSummary[] | null> {
    if (request.method !== 'GET') return null;
    try {
      const p = await this.operator(request);
      if (!p) return null;
      const result = await this.db
        .prepare(
          `SELECT c.id,SUBSTR(c.title,1,200) title,c.status,r.report_count,r.latest FROM (SELECT 1 WHERE ${live}) auth
    LEFT JOIN (SELECT r.content_id,COUNT(*) report_count,MAX(r.created_at_ms) latest FROM article_reports r JOIN article_moderation_state s ON s.content_id=r.content_id AND s.round=r.round JOIN content eligible ON eligible.id=r.content_id AND eligible.kind='article' AND eligible.status IN ('published','hidden') AND instr(eligible.title,char(0))=0 GROUP BY r.content_id) r ON 1=1
    LEFT JOIN content c ON c.id=r.content_id AND c.kind='article' AND c.status IN ('published','hidden')
    ORDER BY r.latest DESC,c.id ASC LIMIT 20`,
        )
        .bind(...bindings(p))
        .all<{
          id: string | null;
          title: string;
          status: 'published' | 'hidden';
          report_count: number;
          latest: number;
        }>();
      if (!result.results.length) return null;
      const rows = result.results.filter((r) => r.id !== null);
      if (
        rows.some(
          (r) =>
            !idValid(r.id) ||
            !text(r.title, 200) ||
            !Number.isSafeInteger(r.report_count) ||
            r.report_count < 1 ||
            r.report_count > 3 ||
            !Number.isSafeInteger(r.latest) ||
            r.latest < 0,
        )
      )
        return null;
      return rows.map((r) => ({
        contentId: r.id!,
        title: r.title,
        status: r.status,
        reportCount: r.report_count,
        latestReportAt: r.latest,
      }));
    } catch {
      return null;
    }
  }
  async readCase(request: Request, targetId: unknown): Promise<ModerationCase | null> {
    if (request.method !== 'GET' || !idValid(targetId)) return null;
    try {
      const p = await this.operator(request);
      if (!p) return null;
      const result = await this.db
        .prepare(
          `SELECT c.id,SUBSTR(c.title,1,200) title,c.body,c.status,r.reason,r.detail,r.created_at_ms FROM content c JOIN article_moderation_state s ON s.content_id=c.id JOIN article_reports r ON r.content_id=c.id AND r.round=s.round WHERE c.id=? AND c.kind='article' AND c.status IN ('published','hidden') AND instr(c.title,char(0))=0 AND instr(c.body,char(0))=0 AND length(CAST(c.body AS BLOB))<=262144 AND NOT EXISTS(SELECT 1 FROM article_reports invalid WHERE invalid.content_id=c.id AND invalid.round=s.round AND (length(CAST(invalid.reason AS BLOB))>800 OR length(CAST(invalid.detail AS BLOB))>8000)) AND (SELECT COUNT(*) FROM article_reports total WHERE total.content_id=c.id AND total.round=s.round) BETWEEN 1 AND 3 AND ${live} ORDER BY r.created_at_ms ASC,r.id ASC LIMIT 3`,
        )
        .bind(targetId, ...bindings(p))
        .all<{
          id: string;
          title: string;
          body: string;
          status: 'published' | 'hidden';
          reason: string;
          detail: string;
          created_at_ms: number;
        }>();
      const rows = result.results;
      if (
        !rows.length ||
        rows.some(
          (r) =>
            !idValid(r.id) ||
            !text(r.title, 200) ||
            !text(r.reason, 200) ||
            !r.reason.trim() ||
            !text(r.detail, 2000) ||
            !Number.isSafeInteger(r.created_at_ms) ||
            r.created_at_ms < 0,
        )
      )
        return null;
      const first = rows[0];
      return {
        contentId: first.id,
        title: first.title,
        body: first.body,
        status: first.status,
        reportCount: rows.length,
        latestReportAt: Math.max(...rows.map((r) => r.created_at_ms)),
        reports: rows.map((r) => ({
          reason: r.reason,
          detail: r.detail,
          createdAt: r.created_at_ms,
        })),
      };
    } catch {
      return null;
    }
  }
  async decisionState(
    request: Request,
    targetId: unknown,
  ): Promise<ModerationDecisionState | null> {
    if (request.method !== 'GET' || !idValid(targetId)) return null;
    try {
      const p = await this.operator(request);
      if (!p) return null;
      const row = await this.db
        .prepare(
          `SELECT c.id contentId,s.round,s.version,c.status,(SELECT COUNT(*) FROM article_reports r WHERE r.content_id=c.id AND r.round=s.round) reportCount FROM article_moderation_state s JOIN content c ON c.id=s.content_id WHERE c.id=? AND c.kind='article' AND c.status IN ('published','hidden','deleted') AND ${live}`,
        )
        .bind(targetId, ...bindings(p))
        .first<ModerationDecisionState>();
      return row &&
        idValid(row.contentId) &&
        version(row.round) &&
        version(row.version) &&
        Number.isSafeInteger(row.reportCount) &&
        row.reportCount >= 0 &&
        row.reportCount <= 3
        ? row
        : null;
    } catch {
      return null;
    }
  }
  private async decisionReceipt(
    p: Proof,
    targetId: string,
    input: DecisionInput | { decisionId: string },
  ): Promise<ModerationDecisionReceipt | null> {
    const exact = 'action' in input ? input : null;
    const row = await this.db
      .prepare(
        `SELECT d.id decisionId,d.content_id contentId,d.action,d.reason,d.result_status resultStatus,d.result_round resultRound,d.result_version resultVersion,o.state notification FROM article_moderation_decisions d JOIN article_moderation_outbox o ON o.decision_id=d.id WHERE d.id=? AND d.content_id=? AND d.operator_account_id=? AND (?=0 OR (d.expected_round=? AND d.expected_version=? AND d.action=? AND d.reason=?)) AND d.decided_at_ms<=? AND ${live}`,
      )
      .bind(
        input.decisionId,
        targetId,
        p.accountId,
        exact ? 1 : 0,
        exact?.expectedRound ?? null,
        exact?.expectedVersion ?? null,
        exact?.action ?? null,
        exact?.reason ?? null,
        p.clock(),
        ...bindings(p),
      )
      .first<ModerationDecisionReceipt>();
    return row && row.notification === 'pending' ? row : null;
  }
  async readDecision(
    request: Request,
    targetId: unknown,
    decisionId: unknown,
  ): Promise<ModerationDecisionReceipt | null> {
    if (
      request.method !== 'GET' ||
      !idValid(targetId) ||
      typeof decisionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(decisionId)
    )
      return null;
    try {
      const p = await this.operator(request);
      return p ? await this.decisionReceipt(p, targetId, { decisionId }) : null;
    } catch {
      return null;
    }
  }
  async decide(
    request: Request,
    targetId: unknown,
    input: unknown,
  ): Promise<ModerationDecisionReceipt | null> {
    if (request.method !== 'POST' || !idValid(targetId) || !decisionInput(input)) return null;
    try {
      const p = await this.operator(request);
      if (!p || p.nowMs > 253402300799999) return null;
      const prior = await this.decisionReceipt(p, targetId, input);
      if (prior) return prior;
      try {
        await this.db
          .prepare(
            `INSERT INTO article_moderation_decisions(id,content_id,operator_account_id,expected_round,expected_version,action,reason,decided_at_ms,result_status,result_round,result_version) SELECT ?,c.id,?,?,?,?,?,?,CASE ? WHEN 'restore' THEN 'published' ELSE 'deleted' END,s.round+CASE ? WHEN 'restore' THEN 1 ELSE 0 END,s.version+1 FROM content c JOIN article_moderation_state s ON s.content_id=c.id WHERE c.id=? AND s.round=? AND s.version=? AND ${live}`,
          )
          .bind(
            input.decisionId,
            p.accountId,
            input.expectedRound,
            input.expectedVersion,
            input.action,
            input.reason,
            p.nowMs,
            input.action,
            input.action,
            targetId,
            input.expectedRound,
            input.expectedVersion,
            ...bindings(p),
          )
          .run();
      } catch {
        // A concurrent retry may already have committed this exact command.
        // The receipt query repeats the current authority check in either case.
      }
      return await this.decisionReceipt(p, targetId, input);
    } catch {
      return null;
    }
  }
  async emailQueue(request: Request): Promise<EmailDeliverySummary[] | null> {
    if (request.method !== 'GET') return null;
    try {
      const p = await this.operator(request);
      if (!p) return null;
      const rows = await this.db
        .prepare(
          `SELECT ${emailColumns} FROM article_report_outbox o LEFT JOIN moderation_email_deliveries d ON d.outbox_id=o.id WHERE ${live} ORDER BY o.created_at_ms DESC,o.id DESC LIMIT 20`,
        )
        .bind(p.clock(), ...bindings(p))
        .all<EmailDeliverySummary>();
      return rows.results.every(emailSummary) &&
        new TextEncoder().encode(JSON.stringify(rows.results)).byteLength <= 32768
        ? rows.results
        : null;
    } catch {
      return null;
    }
  }
  private async emailRetryReceipt(
    p: Proof,
    outboxId: string,
    retryId: string,
  ): Promise<EmailDeliverySummary | null> {
    const row = await this.db
      .prepare(
        `SELECT ${emailColumns} FROM article_report_outbox o JOIN moderation_email_deliveries d ON d.outbox_id=o.id WHERE o.id=? AND d.retry_command_id=? AND ${live}`,
      )
      .bind(p.clock(), outboxId, retryId, ...bindings(p))
      .first<EmailDeliverySummary>();
    return row && emailSummary(row) ? row : null;
  }
  async retryEmail(
    request: Request,
    outboxId: unknown,
    input: unknown,
  ): Promise<EmailDeliverySummary | null> {
    if (
      request.method !== 'POST' ||
      !idValid(outboxId) ||
      !input ||
      typeof input !== 'object' ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== 3 ||
      !('retryCommandId' in input) ||
      !('expectedAttempts' in input) ||
      !('confirmRetry' in input) ||
      input.confirmRetry !== true ||
      typeof input.retryCommandId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        input.retryCommandId,
      ) ||
      !Number.isInteger(input.expectedAttempts) ||
      Number(input.expectedAttempts) < 1 ||
      Number(input.expectedAttempts) >= 3
    )
      return null;
    try {
      const p = await this.operator(request);
      if (!p) return null;
      const prior = await this.emailRetryReceipt(p, outboxId, input.retryCommandId);
      if (prior) return prior;
      await this.db
        .prepare(
          `UPDATE moderation_email_deliveries SET state='ready',retry_command_id=?,updated_at_ms=? WHERE outbox_id=? AND state='failed' AND attempts=? AND attempts<3 AND ${live}`,
        )
        .bind(input.retryCommandId, p.clock(), outboxId, input.expectedAttempts, ...bindings(p))
        .run();
      return await this.emailRetryReceipt(p, outboxId, input.retryCommandId);
    } catch {
      return null;
    }
  }
  async ownNotifications(request: Request): Promise<OwnModerationNotice[] | null> {
    if (request.method !== 'GET') return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      const result = await this.db
        .prepare(
          `WITH notices AS (
        SELECT 'report.'||o.id id,o.content_id contentId,CASE WHEN length(c.title)<=200 AND length(CAST(c.title AS BLOB))<=800 THEN c.title ELSE NULL END title,'temporarily_hidden' kind,'異なる3人からの通報により、一時非公開になりました。運営が内容を確認します。' reason,o.created_at_ms createdAt FROM article_report_outbox o JOIN article_publications a ON a.content_id=o.content_id JOIN content c ON c.id=o.content_id WHERE a.owner_account_id=? AND o.event='temporarily_hidden'
        UNION ALL SELECT 'decision.'||o.decision_id,o.content_id,CASE WHEN length(c.title)<=200 AND length(CAST(c.title AS BLOB))<=800 THEN c.title ELSE NULL END,o.event,CASE WHEN length(d.reason)<=1000 AND length(CAST(d.reason AS BLOB))<=4000 THEN d.reason ELSE NULL END,o.created_at_ms FROM article_moderation_outbox o JOIN article_moderation_decisions d ON d.id=o.decision_id JOIN article_publications a ON a.content_id=o.content_id JOIN content c ON c.id=o.content_id WHERE a.owner_account_id=?
        ) SELECT id,contentId,title,kind,reason,createdAt FROM notices WHERE ${live} ORDER BY createdAt DESC,id DESC LIMIT 20`,
        )
        .bind(p.accountId, p.accountId, ...bindings(p))
        .all<OwnModerationNotice>();
      const valid = result.results.every(
        (row) =>
          /^(?:report|decision)\.[0-9a-f-]{36}$/.test(row.id) &&
          idValid(row.contentId) &&
          text(row.title, 200) &&
          ['temporarily_hidden', 'restored', 'deleted'].includes(row.kind) &&
          text(row.reason, 1000) &&
          Number.isSafeInteger(row.createdAt) &&
          row.createdAt >= 0 &&
          row.createdAt <= 253402300799999,
      );
      return valid && new TextEncoder().encode(JSON.stringify(result.results)).byteLength <= 131072
        ? result.results
        : null;
    } catch {
      return null;
    }
  }
}
