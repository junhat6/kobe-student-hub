import type { EmailDeliverySummary, OwnModerationNotice } from '../notification-types';
import { proofAuthorization } from '../shared/auth-proof';
export interface ReportInput {
  reason: string;
  detail: string;
}
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
export interface ModerationDecisionInput {
  decisionId: string;
  expectedRound: number;
  expectedVersion: number;
  action: 'restore' | 'delete';
  reason: string;
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
export interface EmailRetryInput {
  retryCommandId: string;
  expectedAttempts: number;
  confirmRetry: true;
}
export class ModerationClientError extends Error {
  constructor(readonly kind: 'authentication' | 'unavailable' = 'unavailable') {
    super('確認結果を取得できませんでした。');
    this.name = 'ModerationClientError';
  }
}
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const keys = (v: unknown, wanted: string[]): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === wanted.length &&
  wanted.every((k) => Object.hasOwn(v, k));
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length <= max * 2 &&
  !v.includes('\0') &&
  Array.from(v).length <= max &&
  new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(v)) === v;
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000;
const summaryFields = ['contentId', 'title', 'status', 'reportCount', 'latestReportAt'];
function summary(v: Record<string, unknown>) {
  return (
    id(v.contentId) &&
    text(v.title, 200) &&
    (v.status === 'published' || v.status === 'hidden') &&
    Number.isInteger(v.reportCount) &&
    Number(v.reportCount) >= 1 &&
    Number(v.reportCount) <= 3 &&
    time(v.latestReportAt)
  );
}
function report(v: unknown): v is ModerationCase['reports'][number] {
  return (
    keys(v, ['reason', 'detail', 'createdAt']) &&
    text(v.reason, 200) &&
    Boolean(v.reason.trim()) &&
    text(v.detail, 2000) &&
    new TextEncoder().encode(v.detail).byteLength <= 8000 &&
    time(v.createdAt)
  );
}
function caseDto(v: unknown): v is ModerationCase {
  return (
    keys(v, [...summaryFields, 'body', 'reports']) &&
    summary(v) &&
    typeof v.body === 'string' &&
    v.body.length <= 262144 &&
    !v.body.includes('\0') &&
    new TextEncoder().encode(v.body).byteLength <= 262144 &&
    new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(v.body)) === v.body &&
    Array.isArray(v.reports) &&
    v.reports.length >= 1 &&
    v.reports.length <= 3 &&
    v.reports.every(report) &&
    v.reportCount === v.reports.length &&
    v.latestReportAt === Math.max(...v.reports.map((r) => r.createdAt))
  );
}
export const validReportInput = (value: unknown): value is ReportInput =>
  keys(value, ['reason', 'detail']) &&
  text(value.reason, 200) &&
  Boolean(value.reason.trim()) &&
  text(value.detail, 2000) &&
  new TextEncoder().encode(value.detail).byteLength <= 8000;
const version = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v < 9007199254740990;
export const validDecisionInput = (value: unknown): value is ModerationDecisionInput =>
  keys(value, ['decisionId', 'expectedRound', 'expectedVersion', 'action', 'reason']) &&
  typeof value.decisionId === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.decisionId) &&
  version(value.expectedRound) &&
  version(value.expectedVersion) &&
  (value.action === 'restore' || value.action === 'delete') &&
  text(value.reason, 1000) &&
  !!value.reason.trim() &&
  new TextEncoder().encode(value.reason).byteLength <= 4000;
function decisionReceipt(
  value: unknown,
  targetId: string,
  input: ModerationDecisionInput,
): value is ModerationDecisionReceipt {
  return (
    keys(value, [
      'decisionId',
      'contentId',
      'action',
      'reason',
      'resultStatus',
      'resultRound',
      'resultVersion',
      'notification',
    ]) &&
    value.decisionId === input.decisionId &&
    value.contentId === targetId &&
    value.action === input.action &&
    value.reason === input.reason &&
    value.resultStatus === (input.action === 'restore' ? 'published' : 'deleted') &&
    value.resultRound === input.expectedRound + (input.action === 'restore' ? 1 : 0) &&
    value.resultVersion === input.expectedVersion + 1 &&
    value.notification === 'pending'
  );
}
function decisionState(value: unknown, targetId: string): value is ModerationDecisionState {
  return (
    keys(value, ['contentId', 'round', 'version', 'status', 'reportCount']) &&
    value.contentId === targetId &&
    version(value.round) &&
    version(value.version) &&
    (value.status === 'published' || value.status === 'hidden' || value.status === 'deleted') &&
    Number.isInteger(value.reportCount) &&
    Number(value.reportCount) >= 0 &&
    Number(value.reportCount) <= 3
  );
}
/** Existing-cookie transport only. Never creates an identity or retries a report automatically. */
function emailSummary(v: unknown): v is EmailDeliverySummary {
  return (
    keys(v, [
      'outboxId',
      'contentId',
      'event',
      'reportCount',
      'createdAt',
      'state',
      'attempts',
      'retryCommandId',
    ]) &&
    id(v.outboxId) &&
    id(v.contentId) &&
    typeof v.event === 'string' &&
    ['report_received', 'temporarily_hidden'].includes(v.event) &&
    Number.isInteger(v.reportCount) &&
    Number(v.reportCount) >= 1 &&
    Number(v.reportCount) <= 3 &&
    time(v.createdAt) &&
    typeof v.state === 'string' &&
    ['pending', 'ready', 'leased', 'accepted', 'failed', 'unknown'].includes(v.state) &&
    Number.isInteger(v.attempts) &&
    Number(v.attempts) >= 0 &&
    Number(v.attempts) <= 3 &&
    (v.retryCommandId === null ||
      (typeof v.retryCommandId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          v.retryCommandId,
        )))
  );
}
function ownNotice(v: unknown): v is OwnModerationNotice {
  return (
    keys(v, ['id', 'contentId', 'title', 'kind', 'reason', 'createdAt']) &&
    typeof v.id === 'string' &&
    /^(?:report|decision)\.[0-9a-f-]{36}$/.test(v.id) &&
    id(v.contentId) &&
    text(v.title, 200) &&
    typeof v.kind === 'string' &&
    ['temporarily_hidden', 'restored', 'deleted'].includes(v.kind) &&
    text(v.reason, 1000) &&
    time(v.createdAt)
  );
}
export function createModerationClient(fetcher: typeof fetch = fetch) {
  async function request(
    path: string,
    body?: ReportInput | ModerationDecisionInput | EmailRetryInput,
    csrfToken?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const cancel = () => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    };
    const operation = (async () => {
      const response = await fetcher(path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: body
          ? {
              Accept: 'application/json',
              'Content-Type': 'application/json; charset=utf-8',
              Authorization: proofAuthorization('csrf', csrfToken!),
            }
          : { Accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (
        expired ||
        response.status !== 200 ||
        !response.body ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new ModerationClientError(response.status === 401 ? 'authentication' : 'unavailable');
      }
      const length = response.headers.get('Content-Length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 2097152)
      ) {
        void response.body.cancel().catch(() => {});
        throw new ModerationClientError();
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(2097152);
      let size = 0,
        count = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (expired) throw new ModerationClientError();
          if (next.done) break;
          if (++count > 65536 || size + next.value.byteLength > bytes.length)
            throw new ModerationClientError();
          bytes.set(next.value, size);
          size += next.value.byteLength;
        }
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
        ) as unknown;
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
        reader = undefined;
      }
    })();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        cancel();
        reject(new ModerationClientError());
      }, 10000);
    });
    try {
      return await Promise.race([operation, deadline]);
    } catch (error) {
      if (error instanceof ModerationClientError) throw error;
      throw new ModerationClientError();
    } finally {
      clearTimeout(timer);
      cancel();
    }
  }
  const target = (targetId: string) => {
    if (!id(targetId)) throw new ModerationClientError();
    return '/api/private/reports/' + targetId;
  };
  return {
    async session(): Promise<string> {
      const result = await request('/api/private/moderation/session');
      if (
        !keys(result, ['csrfToken']) ||
        typeof result.csrfToken !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(result.csrfToken)
      )
        throw new ModerationClientError();
      return result.csrfToken;
    },
    async received(targetId: string): Promise<boolean> {
      const result = await request(target(targetId));
      if (!keys(result, ['received']) || typeof result.received !== 'boolean')
        throw new ModerationClientError();
      return result.received;
    },
    async report(
      targetId: string,
      input: ReportInput,
      csrfToken: string,
      confirmed: boolean,
    ): Promise<void> {
      if (!confirmed || !validReportInput(input) || !/^[A-Za-z0-9_-]{43}$/.test(csrfToken))
        throw new ModerationClientError();
      const result = await request(target(targetId), input, csrfToken);
      if (!keys(result, ['received']) || result.received !== true)
        throw new ModerationClientError();
    },
    async queue(): Promise<ModerationSummary[]> {
      const result = await request('/api/private/moderation/cases');
      if (
        !Array.isArray(result) ||
        result.length > 20 ||
        !result.every((v) => keys(v, summaryFields) && summary(v)) ||
        new Set(result.map((v) => v.contentId)).size !== result.length
      )
        throw new ModerationClientError();
      return result as ModerationSummary[];
    },
    async ownNotifications(): Promise<OwnModerationNotice[]> {
      const value = await request('/api/private/notifications');
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        !value.every(ownNotice) ||
        new Set(value.map((v) => v.id)).size !== value.length
      )
        throw new ModerationClientError();
      return value;
    },
    async emailQueue(): Promise<EmailDeliverySummary[]> {
      const value = await request('/api/private/moderation/notifications');
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        !value.every(emailSummary) ||
        new Set(value.map((v) => v.outboxId)).size !== value.length
      )
        throw new ModerationClientError();
      return value;
    },
    async retryEmail(
      outboxId: string,
      input: EmailRetryInput,
      csrfToken: string,
    ): Promise<EmailDeliverySummary> {
      if (
        !id(outboxId) ||
        !keys(input, ['retryCommandId', 'expectedAttempts', 'confirmRetry']) ||
        input.confirmRetry !== true ||
        !Number.isInteger(input.expectedAttempts) ||
        input.expectedAttempts < 1 ||
        input.expectedAttempts >= 3 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          input.retryCommandId,
        ) ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrfToken)
      )
        throw new ModerationClientError();
      const value = await request(
        '/api/private/moderation/notifications/' + outboxId + '/retry',
        input,
        csrfToken,
      );
      if (
        !emailSummary(value) ||
        value.outboxId !== outboxId ||
        value.retryCommandId !== input.retryCommandId
      )
        throw new ModerationClientError();
      return value;
    },
    async readCase(targetId: string): Promise<ModerationCase> {
      if (!id(targetId)) throw new ModerationClientError();
      const result = await request('/api/private/moderation/cases/' + targetId);
      if (!caseDto(result) || result.contentId !== targetId) throw new ModerationClientError();
      return result;
    },
    async decisionState(targetId: string): Promise<ModerationDecisionState> {
      if (!id(targetId)) throw new ModerationClientError();
      const result = await request('/api/private/moderation/cases/' + targetId + '/decision');
      if (!decisionState(result, targetId)) throw new ModerationClientError();
      return result;
    },
    async decide(
      targetId: string,
      input: ModerationDecisionInput,
      csrfToken: string,
      confirmed: boolean,
    ): Promise<ModerationDecisionReceipt> {
      if (
        !id(targetId) ||
        !confirmed ||
        !validDecisionInput(input) ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrfToken)
      )
        throw new ModerationClientError();
      const result = await request(
        '/api/private/moderation/cases/' + targetId + '/decision',
        input,
        csrfToken,
      );
      if (!decisionReceipt(result, targetId, input)) throw new ModerationClientError();
      return result;
    },
    async readDecision(
      targetId: string,
      input: ModerationDecisionInput,
    ): Promise<ModerationDecisionReceipt> {
      if (!id(targetId) || !validDecisionInput(input)) throw new ModerationClientError();
      const result = await request(
        '/api/private/moderation/cases/' + targetId + '/decisions/' + input.decisionId,
      );
      if (!decisionReceipt(result, targetId, input)) throw new ModerationClientError();
      return result;
    },
  };
}
