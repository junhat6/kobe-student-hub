/** Optional deployment inputs only. No send binding or schedule is activated in source config. */
export interface ModerationEmailBindings {
  MODERATION_EMAIL?: SendEmail;
  MODERATION_EMAIL_FROM?: string;
  MODERATION_EMAIL_TO?: string;
}
export interface ModerationEmailOptions {
  email: SendEmail;
  from: string;
  to: string;
  origin: string;
}
const address = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const time = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= 253402300769999;
export function moderationEmailOptions(
  bindings: ModerationEmailBindings,
  origin: string,
): ModerationEmailOptions | null {
  try {
    if (
      !bindings.MODERATION_EMAIL ||
      typeof bindings.MODERATION_EMAIL.send !== 'function' ||
      !address(bindings.MODERATION_EMAIL_FROM) ||
      !address(bindings.MODERATION_EMAIL_TO) ||
      new URL(origin).protocol !== 'https:' ||
      new URL(origin).origin !== origin
    )
      return null;
    return {
      email: bindings.MODERATION_EMAIL,
      from: bindings.MODERATION_EMAIL_FROM,
      to: bindings.MODERATION_EMAIL_TO,
      origin,
    };
  } catch {
    return null;
  }
}
interface Claim {
  outboxId: string;
  leaseToken: string;
  attempts: number;
}
interface Event {
  contentId: string;
  event: 'report_received' | 'temporarily_hidden';
}
/** Trusted internal spool only; no HTTP endpoint grants access to these operations. */
export class ModerationEmailStore {
  constructor(private readonly db: D1Database) {}
  async expire(now: number) {
    await this.db
      .prepare(
        `UPDATE moderation_email_deliveries SET state='unknown',lease_token=NULL,lease_until_ms=NULL,updated_at_ms=? WHERE outbox_id IN (SELECT outbox_id FROM moderation_email_deliveries WHERE state='leased' AND lease_until_ms<=? ORDER BY lease_until_ms,outbox_id LIMIT 20)`,
      )
      .bind(now, now)
      .run();
  }
  async claim(now: number): Promise<Claim | null> {
    return this.db
      .prepare(
        `INSERT INTO moderation_email_deliveries(outbox_id,state,attempts,lease_token,lease_until_ms,updated_at_ms)
      SELECT o.id,'leased',1,?,?,? FROM article_report_outbox o LEFT JOIN moderation_email_deliveries d ON d.outbox_id=o.id
      WHERE o.state='pending' AND (d.outbox_id IS NULL OR (d.state='ready' AND d.attempts<3)) ORDER BY o.created_at_ms,o.id LIMIT 1
      ON CONFLICT(outbox_id) DO UPDATE SET state='leased',attempts=moderation_email_deliveries.attempts+1,lease_token=excluded.lease_token,lease_until_ms=excluded.lease_until_ms,updated_at_ms=excluded.updated_at_ms
      WHERE moderation_email_deliveries.state='ready' AND moderation_email_deliveries.attempts<3
      RETURNING outbox_id outboxId,lease_token leaseToken,attempts`,
      )
      .bind(crypto.randomUUID(), now + 30000, now)
      .first<Claim>();
  }
  async event(claim: Claim): Promise<Event | null> {
    return this.db
      .prepare(
        "SELECT o.content_id contentId,o.event FROM article_report_outbox o JOIN moderation_email_deliveries d ON d.outbox_id=o.id WHERE o.id=? AND d.lease_token=? AND d.state='leased'",
      )
      .bind(claim.outboxId, claim.leaseToken)
      .first<Event>();
  }
  async finish(
    claim: Claim,
    state: 'accepted' | 'failed' | 'unknown',
    now: number,
    messageId: string | null = null,
  ): Promise<boolean> {
    const value = await this.db
      .prepare(
        `UPDATE moderation_email_deliveries SET state=?,provider_message_id=?,lease_token=NULL,lease_until_ms=NULL,updated_at_ms=? WHERE outbox_id=? AND state='leased' AND lease_token=? AND lease_until_ms>? RETURNING outbox_id`,
      )
      .bind(state, messageId, now, claim.outboxId, claim.leaseToken, now)
      .first();
    return value !== null;
  }
}
// Only documented API-boundary rejections are known not to have been accepted.
const rejected = new Set([
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_TOO_MANY_RECIPIENTS',
  'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_RECIPIENT_SUPPRESSED',
  'E_ACCOUNT_SUSPENDED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_CONTENT_TOO_LARGE',
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY',
]);
function knownRejection(error: unknown) {
  try {
    if (!error || typeof error !== 'object' || !('code' in error)) return false;
    const code = error.code;
    return typeof code === 'string' && rejected.has(code);
  } catch {
    return false;
  }
}
function acceptedId(value: unknown): string | null {
  try {
    if (!value || typeof value !== 'object' || !('messageId' in value)) return null;
    const id = value.messageId;
    return typeof id === 'string' &&
      id.trim().length >= 1 &&
      id.length <= 256 &&
      new TextDecoder().decode(new TextEncoder().encode(id)) === id &&
      !/[\u0000-\u001f\u007f]/.test(id)
      ? id
      : null;
  } catch {
    return null;
  }
}
/** Bounded single attempts. Accepted is provider acceptance, never proof of delivery. */
export async function dispatchModerationEmails(
  db: D1Database,
  options: ModerationEmailOptions | null,
  clock: () => number = Date.now,
  timeoutMs = 10000,
) {
  const summary = { enabled: options !== null, attempted: 0, accepted: 0, failed: 0, unknown: 0 };
  if (!options || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    return summary;
  const store = new ModerationEmailStore(db);
  try {
    const now = clock();
    if (!time(now)) return summary;
    await store.expire(now);
    for (let i = 0; i < 5; i++) {
      const at = clock();
      if (!time(at)) break;
      const claim = await store.claim(at);
      if (!claim) break;
      const event = await store.event(claim);
      if (
        !event ||
        !uuid(claim.outboxId) ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(event.contentId) ||
        !['report_received', 'temporarily_hidden'].includes(event.event)
      ) {
        await store.finish(claim, 'unknown', clock());
        summary.unknown++;
        break;
      }
      const link = options.origin + '/moderation?case=' + encodeURIComponent(event.contentId);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const send = Promise.resolve()
        .then(() =>
          options.email.send({
            from: options.from,
            to: options.to,
            subject:
              event.event === 'temporarily_hidden'
                ? '記事を一時非公開にしました'
                : '記事の通報が届いています',
            text: '運営画面で記事と通報内容を確認できます。\n' + link,
            html:
              '<p>運営画面で記事と通報内容を確認できます。</p><p><a href="' +
              link +
              '">運営画面で確認する</a></p>',
          }),
        )
        .then(
          (value) => ({ state: 'accepted' as const, id: acceptedId(value) }),
          (error) => ({
            state: knownRejection(error) ? ('failed' as const) : ('unknown' as const),
            id: null,
          }),
        );
      const deadline = new Promise<{ state: 'unknown'; id: null }>((resolve) => {
        timer = setTimeout(() => resolve({ state: 'unknown', id: null }), timeoutMs);
      });
      summary.attempted++;
      const outcome = await Promise.race([send, deadline]);
      clearTimeout(timer);
      const state = outcome.state === 'accepted' && !outcome.id ? 'unknown' : outcome.state;
      let saved = false;
      try {
        saved = await store.finish(claim, state, clock(), state === 'accepted' ? outcome.id : null);
      } catch {
        /* Receipt remains leased, then unknown; never automatically reclaimed. */
      }
      if (!saved) {
        summary.unknown++;
        break;
      }
      summary[state]++;
    }
  } catch {
    summary.unknown++;
  }
  return summary;
}
