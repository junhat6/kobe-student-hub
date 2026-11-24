import { parseProofAuthorization, hasLegacyProofHeader } from '../../src/shared/auth-proof';
import { base64url } from 'jose';
import {
  canonicalEnrollmentYears,
  ENROLLMENT_POLICY_VERSION,
  type EnrollmentYears,
} from '../../src/shared/enrollment';
import {
  liveRestrictedSessionSql,
  liveSessionBindings,
  SESSION_ABSOLUTE_MS,
  SESSION_CLOCK_SKEW_MS,
  type SessionStorageProof,
} from './session-guard';
export const CONTEXT_COOKIE = '__Host-kobe-browser';
/**
 * A context row that no login has used yet stays short, so anonymous bootstraps cannot hold the
 * live-context cap for a year. A session insert extends its own context row to the session's
 * expiry (trigger session_context_lifetime, migrations/0041). The cookie itself carries the
 * session length so it is still sent while that extended row is live (#269).
 */
export const CONTEXT_PENDING_LIFETIME_MS = 28_800_000;
const CONTEXT_CAP_CLOCK_MARGIN_MS = 3_600_000;
export const CONTEXT_COOKIE_MAX_AGE_SECONDS = SESSION_ABSOLUTE_MS / 1000;
export interface BrowserIssuanceLimits {
  maxLiveContexts: number;
  maxCommandsPerMinute: number;
}
const DEFAULT_ISSUANCE_LIMITS: BrowserIssuanceLimits = {
  maxLiveContexts: 10000,
  maxCommandsPerMinute: 20,
};
export type BrowserAction = 'login' | 'pending-registration' | 'logout';
export interface BrowserClaim {
  stateHash: string;
  owner: string;
  contextHash: string;
  generation: number;
  fence: number;
}
export const freshBrowserSecret = () =>
  base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const validBrowserSecret = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
export async function browserDigest(domain: string, value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(domain + ':' + value)),
    ),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
}
export function singleSecretCookie(request: Request, name: string) {
  const h = request.headers.get('Cookie');
  if (!h || h.length > 16384) return null;
  const values = h
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + '='))
    .map((s) => s.slice(name.length + 1));
  return values.length === 1 && validBrowserSecret(values[0]) ? values[0] : null;
}
export function sameOriginCommand(request: Request, origin: string) {
  return (
    request.method === 'POST' &&
    new URL(request.url).origin === origin &&
    request.headers.get('Origin') === origin &&
    ['same-origin', 'none', null].includes(request.headers.get('Sec-Fetch-Site'))
  );
}
export function emptyCommand(request: Request) {
  const length = request.headers.get('Content-Length');
  const ok = !(
    (request.body !== null && length !== '0') ||
    (length !== null && length !== '0') ||
    request.headers.has('Transfer-Encoding') ||
    request.headers.has('Content-Type') ||
    (request.headers.get('Content-Encoding') !== null &&
      request.headers.get('Content-Encoding')?.toLowerCase() !== 'identity')
  );
  void request.body?.cancel().catch(() => {});
  return ok;
}
/** Anonymous ordering capability only. Never returns an actor or recovers a session. */
export class BrowserSessionCoordinator {
  constructor(
    private readonly db: D1Database,
    private readonly origin: string,
    private readonly clock: () => number = Date.now,
    private readonly limits: BrowserIssuanceLimits = DEFAULT_ISSUANCE_LIMITS,
  ) {}
  private now() {
    if (
      !this.limits ||
      !Number.isSafeInteger(this.limits.maxLiveContexts) ||
      this.limits.maxLiveContexts < 1 ||
      this.limits.maxLiveContexts > 10000 ||
      !Number.isSafeInteger(this.limits.maxCommandsPerMinute) ||
      this.limits.maxCommandsPerMinute < 1 ||
      this.limits.maxCommandsPerMinute > 20
    )
      return null;
    try {
      if (new URL(this.origin).protocol !== 'https:' || new URL(this.origin).origin !== this.origin)
        return null;
    } catch {
      return null;
    }
    const n = this.clock();
    return Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER - SESSION_ABSOLUTE_MS
      ? n
      : null;
  }
  /**
   * A context row's created_at_ms was written by another request, possibly on an isolate whose
   * clock ran ahead, so its `<=` comparisons tolerate SESSION_CLOCK_SKEW_MS like the session
   * lookup does (#268, #277: logout right after the first visit/login). Expiry stays strict.
   */
  async context(request: Request) {
    const raw = singleSecretCookie(request, CONTEXT_COOKIE),
      now = this.now();
    if (
      hasLegacyProofHeader(request.headers) ||
      !raw ||
      now === null ||
      new URL(request.url).origin !== this.origin
    )
      return null;
    const hash = await browserDigest('browser-v1', raw);
    const row = await this.db
      .prepare(
        `SELECT generation,expires_at_ms FROM auth_browser_contexts WHERE context_hash=? AND created_at_ms<=?+${SESSION_CLOCK_SKEW_MS} AND expires_at_ms>?`,
      )
      .bind(hash, now, now)
      .first<{ generation: number; expires_at_ms: number }>();
    return row ? { hash, ...row } : null;
  }
  async bootstrap(request: Request) {
    if (
      hasLegacyProofHeader(request.headers) ||
      !sameOriginCommand(request, this.origin) ||
      !emptyCommand(request)
    )
      return null;
    const now = this.now();
    if (now === null) return null;
    await this.cleanupRevocations();
    if (await this.context(request)) return null;
    const raw = freshBrowserSecret(),
      hash = await browserDigest('browser-v1', raw);
    const inserted = await this.db
      .prepare(
        'INSERT INTO auth_browser_contexts(context_hash,created_at_ms,expires_at_ms) SELECT ?,?,? WHERE (SELECT count(*) FROM (SELECT 1 FROM auth_browser_contexts WHERE expires_at_ms>? AND expires_at_ms<=? LIMIT ?))<? RETURNING context_hash',
      )
      .bind(
        hash,
        now,
        now + CONTEXT_PENDING_LIFETIME_MS,
        now,
        // Only rows that can still be anonymous count: a row a login extended past the pending
        // lifetime is bounded by school Google logins, and counting it would let repeated logins
        // hold the cap (and block everyone's new logins) for up to a year (#269 verifier F-中1).
        // The margin keeps rows written by a request that read a later clock (concurrent
        // requests, isolate skew) inside the count, so the cap stays exact (#269 verifier 低2).
        now + CONTEXT_PENDING_LIFETIME_MS + CONTEXT_CAP_CLOCK_MARGIN_MS,
        this.limits.maxLiveContexts,
        this.limits.maxLiveContexts,
      )
      .first();
    if (!inserted) return null;
    return {
      setCookie: `${CONTEXT_COOKIE}=${raw}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${CONTEXT_COOKIE_MAX_AGE_SECONDS}`,
    };
  }
  async command(
    request: Request,
    action: BrowserAction,
    expected?: number,
    logoutTokenHash?: string,
  ) {
    if (
      hasLegacyProofHeader(request.headers) ||
      !sameOriginCommand(request, this.origin) ||
      !emptyCommand(request) ||
      !['login', 'pending-registration', 'logout'].includes(action)
    )
      return null;
    await this.cleanupRevocations();
    const context = await this.context(request),
      now = this.now();
    if (!context || now === null || (expected !== undefined && context.generation !== expected))
      return null;
    const raw = freshBrowserSecret();
    const r = await this.db
      .prepare(
        `INSERT INTO auth_browser_commands(command_hash,context_hash,action,expected_generation,revocation_fence,created_at_ms,expires_at_ms,logout_token_hash) SELECT ?,c.context_hash,?,c.generation,f.generation,?,min(c.expires_at_ms,?),? FROM auth_browser_contexts c,auth_revocation_fence f WHERE c.context_hash=? AND c.generation=? AND c.created_at_ms<=?+${SESSION_CLOCK_SKEW_MS} AND c.expires_at_ms>? AND f.id=1 AND (SELECT count(*) FROM (SELECT 1 FROM auth_browser_commands q WHERE q.context_hash=c.context_hash AND (q.action='logout')=(?='logout') AND q.created_at_ms>? LIMIT ?))<?`,
      )
      .bind(
        await browserDigest('command-v1', raw),
        action,
        now,
        now + 60000,
        logoutTokenHash ?? null,
        context.hash,
        context.generation,
        now,
        now,
        action,
        now - 60000,
        this.limits.maxCommandsPerMinute,
        this.limits.maxCommandsPerMinute,
      )
      .run();
    return r.meta.changes === 1 ? { commandToken: raw } : null;
  }
  /**
   * The command row's created_at_ms was written by the request that issued it, possibly on an
   * isolate whose clock ran ahead of this one (two-step logout: logout-command → command proof,
   * #280), so that `<=` tolerates SESSION_CLOCK_SKEW_MS too. Expiry, generation, fence and epoch
   * stay strict.
   */
  async execute(
    request: Request,
    action: BrowserAction,
    attempt?: {
      stateHash: string;
      browserHash: string;
      nonce: string;
      enrollment?: EnrollmentYears;
    },
    authorization?: SessionStorageProof,
  ) {
    const enrollment =
      attempt?.enrollment === undefined ? null : canonicalEnrollmentYears(attempt.enrollment);
    if (attempt?.enrollment !== undefined && (!enrollment || action !== 'login'))
      return { kind: 'rejected' } as const;
    const proof = parseProofAuthorization(request.headers),
      token = proof?.purpose === 'command' ? proof.token : null,
      now = this.now();
    if (!validBrowserSecret(token) || now === null || !sameOriginCommand(request, this.origin))
      return { kind: 'rejected' } as const;
    const context = await this.context(request);
    if (!context) return { kind: 'rejected' } as const;
    const hash = await browserDigest('command-v1', token);
    const rs = await this.db.batch([
      this.db
        .prepare(
          `UPDATE auth_browser_commands SET executed_at_ms=?1,state_hash=?2,browser_hash=?3,nonce=?4,attempt_expires_at_ms=?5 WHERE command_hash=?6 AND context_hash=?7 AND action=?8 AND executed_at_ms IS NULL AND created_at_ms<=?1+${SESSION_CLOCK_SKEW_MS} AND expires_at_ms>?1 AND EXISTS(SELECT 1 FROM auth_browser_contexts c,auth_revocation_fence f WHERE c.context_hash=auth_browser_commands.context_hash AND c.generation=auth_browser_commands.expected_generation AND c.generation<9007199254740991 AND c.created_at_ms<=?1+${SESSION_CLOCK_SKEW_MS} AND c.expires_at_ms>?1 AND f.id=1 AND auth_browser_commands.revocation_fence>=f.minimum_generation) AND ${authorization ? liveRestrictedSessionSql(authorization) : '1'} RETURNING expected_generation`,
        )
        .bind(
          now,
          attempt?.stateHash ?? null,
          attempt?.browserHash ?? null,
          attempt?.nonce ?? null,
          attempt ? now + 600000 : null,
          hash,
          context.hash,
          action,
          ...(authorization ? liveSessionBindings(authorization) : []),
        ),
      ...(enrollment
        ? [
            this.db
              .prepare(
                `INSERT INTO auth_self_registration_attempts(state_hash,admission_year,graduation_year,policy_version) SELECT t.state_hash,?,?,? FROM oauth_attempts t JOIN auth_browser_commands q ON q.state_hash=t.state_hash WHERE q.command_hash=? AND q.context_hash=? AND q.action='login' AND q.executed_at_ms=? AND t.state_hash=? AND t.context_hash=q.context_hash AND t.context_generation=q.expected_generation+1 AND t.intent='login' RETURNING state_hash`,
              )
              .bind(
                enrollment.admissionYear,
                enrollment.graduationYear,
                ENROLLMENT_POLICY_VERSION,
                hash,
                context.hash,
                now,
                attempt!.stateHash,
              ),
          ]
        : []),
      this.db
        .prepare(
          `SELECT executed_at_ms FROM auth_browser_commands WHERE command_hash=? AND context_hash=? AND action=? AND created_at_ms<=?+${SESSION_CLOCK_SKEW_MS} AND expires_at_ms>?`,
        )
        .bind(hash, context.hash, action, now, now),
    ]);
    if (rs[0].results.length)
      return { kind: !enrollment || rs[1].results.length === 1 ? 'executed' : 'rejected' } as const;
    const prior = rs[rs.length - 1].results[0] as { executed_at_ms: number | null } | undefined;
    return prior?.executed_at_ms !== undefined && prior.executed_at_ms !== null
      ? ({ kind: 'already-completed' } as const)
      : ({ kind: 'rejected' } as const);
  }
  /** Opportunistic bounded cleanup; a permanent low-watermark rejects retired old attempts even after clock rollback. */
  async cleanupRevocations() {
    const now = this.now();
    if (now === null) return null;
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE auth_revocation_fence SET minimum_generation=max(minimum_generation,COALESCE((SELECT max(generation) FROM (SELECT b.generation FROM auth_subject_fences b WHERE NOT EXISTS(SELECT 1 FROM oauth_attempts t WHERE t.revocation_fence<b.generation AND t.expires_at_ms>?) AND NOT EXISTS(SELECT 1 FROM auth_browser_commands q WHERE q.revocation_fence<b.generation AND q.executed_at_ms IS NULL AND q.expires_at_ms>?) ORDER BY b.generation LIMIT 100)),minimum_generation)) WHERE id=1`,
        )
        .bind(now, now),
      this.db.prepare(
        'DELETE FROM auth_subject_fences WHERE google_subject IN(SELECT google_subject FROM auth_subject_fences WHERE generation<=(SELECT minimum_generation FROM auth_revocation_fence WHERE id=1) ORDER BY generation LIMIT 100)',
      ),
    ]);
    return results[1].meta.changes;
  }
  /**
   * The attempt and context rows were written by the start request, possibly on an isolate whose
   * clock ran ahead of the callback's (#282), so their `<=` comparisons tolerate
   * SESSION_CLOCK_SKEW_MS. consumed_at_ms is lifted to created_at_ms because 0003's CHECK requires
   * consumed_at_ms >= created_at_ms; consumption is judged by IS NULL only, so the lift changes
   * nothing else. Expiry, one-time consumption, generation and fence stay strict.
   */
  async claim(
    request: Request,
    state: string,
    browserBinding: string,
    action: Exclude<BrowserAction, 'logout'>,
  ) {
    const context = await this.context(request),
      now = this.now();
    if (!context || now === null) return null;
    const owner = freshBrowserSecret();
    const plain = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))),
      (v) => v.toString(16).padStart(2, '0'),
    ).join('');
    const binding = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(browserBinding)),
      ),
      (v) => v.toString(16).padStart(2, '0'),
    ).join('');
    const row = await this.db
      .prepare(
        `UPDATE oauth_attempts SET consumed_at_ms=max(?1,created_at_ms),claim_owner=?2 WHERE state_hash=?3 AND browser_hash=?4 AND consumed_at_ms IS NULL AND created_at_ms<=?1+${SESSION_CLOCK_SKEW_MS} AND expires_at_ms>?1 AND context_hash=?5 AND intent=?6 AND EXISTS(SELECT 1 FROM auth_browser_contexts c,auth_revocation_fence f WHERE c.context_hash=oauth_attempts.context_hash AND c.generation=oauth_attempts.context_generation AND c.created_at_ms<=?1+${SESSION_CLOCK_SKEW_MS} AND c.expires_at_ms>?1 AND f.id=1 AND oauth_attempts.revocation_fence>=f.minimum_generation) RETURNING nonce,context_generation,revocation_fence`,
      )
      .bind(now, owner, plain, binding, context.hash, action)
      .first<{ nonce: string; context_generation: number; revocation_fence: number }>();
    return row
      ? {
          nonce: row.nonce,
          proof: {
            stateHash: plain,
            owner,
            contextHash: context.hash,
            generation: row.context_generation,
            fence: row.revocation_fence,
          } satisfies BrowserClaim,
        }
      : null;
  }
}
