import type { SessionRestrictionReader } from './session-guard';
import { BrowserOAuthFlow, type BrowserFlowConfig, type OAuthIntent } from './browser-flow';
import { verifySchoolGoogleIdToken } from './google-identity';
import { PendingRegistrationStore } from './pending-registration';
import type { VerifiedSchoolIdentity } from './google-identity';
import { SessionStore } from './sessions';
import { SelfRegistrationStore } from './self-registration';
export interface GoogleLoginConfig extends BrowserFlowConfig {
  clientSecret: string;
}
export type GoogleRegistrationResult =
  { kind: 'pending-receipt'; clearCookie: string } | { kind: 'failed'; clearCookie: string };
export type GoogleLoginResult =
  | { kind: 'failed'; clearCookie: string }
  | ({ kind: 'authenticated'; clearCookie: string } & NonNullable<
      Awaited<ReturnType<SessionStore['create']>>
    >);
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_BODY = 32 * 1024;
function configured(c: GoogleLoginConfig) {
  try {
    return (
      typeof c.clientSecret === 'string' &&
      /^[\x21-\x7e]{1,4096}$/.test(c.clientSecret) &&
      new URL(c.origin).protocol === 'https:' &&
      new URL(c.origin).origin === c.origin &&
      c.cookieKey instanceof Uint8Array &&
      c.cookieKey.byteLength === 32 &&
      /^[A-Za-z0-9_-]{1,220}\.apps\.googleusercontent\.com$/.test(c.clientId)
    );
  } catch {
    return false;
  }
}
async function readToken(response: Response): Promise<string | null> {
  if (!response.ok || response.redirected || !response.body) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
    void response.body.cancel().catch(() => {});
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      'id_token' in body &&
      typeof body.id_token === 'string'
      ? body.id_token
      : null;
  } finally {
    reader.releaseLock();
  }
}
/** Server-private only. No route, account admission, or provider payload is exposed. */
export class GoogleLoginBroker {
  constructor(
    private readonly db: D1Database,
    private readonly config: GoogleLoginConfig,
    private readonly clock: () => number = Date.now,
    private readonly restriction?: SessionRestrictionReader,
  ) {}
  async start(request: Request) {
    return configured(this.config)
      ? new BrowserOAuthFlow(this.db, this.config, this.clock).start(request)
      : null;
  }
  async startRegistration(request: Request) {
    return configured(this.config)
      ? new BrowserOAuthFlow(this.db, this.config, this.clock).start(
          request,
          'pending-registration',
        )
      : null;
  }
  async startSelfRegistration(request: Request, years: unknown) {
    return configured(this.config) && !this.restriction
      ? new BrowserOAuthFlow(this.db, this.config, this.clock).startSelfRegistration(request, years)
      : null;
  }
  async callback(request: Request): Promise<GoogleLoginResult | null> {
    return this.complete(request, 'login') as Promise<GoogleLoginResult | null>;
  }
  async registrationCallback(
    request: Request,
    allowIdentity?: (identity: VerifiedSchoolIdentity) => boolean,
  ): Promise<GoogleRegistrationResult | null> {
    return this.complete(
      request,
      'pending-registration',
      allowIdentity,
    ) as Promise<GoogleRegistrationResult | null>;
  }
  async selfRegistrationCallback(request: Request): Promise<GoogleLoginResult | null> {
    return this.restriction
      ? null
      : (this.complete(request, 'self-registration') as Promise<GoogleLoginResult | null>);
  }
  private async complete(
    request: Request,
    intent: OAuthIntent | 'self-registration',
    allowIdentity?: (identity: VerifiedSchoolIdentity) => boolean,
  ): Promise<GoogleLoginResult | GoogleRegistrationResult | null> {
    if (!configured(this.config)) return null;
    const flow = new BrowserOAuthFlow(this.db, this.config, this.clock),
      claim =
        intent === 'self-registration'
          ? await flow.claimSelfRegistration(request)
          : await flow.claim(request, intent);
    if (!claim) return null;
    const failure: GoogleLoginResult = { kind: 'failed', clearCookie: claim.clearCookie };
    if (claim.kind === 'denied') return failure;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve(null);
      }, 5000);
    });
    try {
      // Workers supports manual rather than error; reject every redirect without following it.
      const exchange = (async () => {
        const response = await fetch(TOKEN_URL, {
          method: 'POST',
          redirect: 'manual',
          signal: abort.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: claim.code,
            redirect_uri: this.config.origin + '/api/auth/callback',
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code_verifier: claim.verifier,
          }),
        });
        if (abort.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          return null;
        }
        return readToken(response);
      })();
      // The race also bounds a non-cooperative stream; Promise.race handles late rejections.
      const token = await Promise.race([exchange, deadline]);
      if (!token || abort.signal.aborted) return failure;
      clearTimeout(timer);
      abort.abort();
      const identity = await verifySchoolGoogleIdToken(token, {
        clientId: this.config.clientId,
        expectedNonce: claim.nonce,
      });
      if (!identity) return failure;
      if (intent === 'pending-registration') {
        if (allowIdentity && !allowIdentity(identity)) return failure;
        const receipt = await new PendingRegistrationStore(this.db, this.clock).record(
          identity,
          claim.proof,
        );
        return receipt ? { kind: 'pending-receipt', clearCookie: claim.clearCookie } : failure;
      }
      if (intent === 'self-registration') {
        const session = await new SelfRegistrationStore(this.db, this.clock).complete(
          identity,
          claim.proof,
        );
        return session
          ? { kind: 'authenticated', ...session, clearCookie: claim.clearCookie }
          : failure;
      }
      const session = await new SessionStore(
        this.db,
        this.config.origin,
        this.clock,
        this.restriction,
      ).create(identity, claim.proof);
      return session
        ? { kind: 'authenticated', ...session, clearCookie: claim.clearCookie }
        : failure;
    } catch {
      return failure;
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }
}
