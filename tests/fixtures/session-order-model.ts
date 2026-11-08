/** Closed protocol model ONLY. No HTTP, crypto, SQL or production imports.
 * Deterministic labels are not credentials. Each method is one assumed atomic DB step.
 * This is a candidate specification, not an authentication implementation. */
type Context = { epoch: number; expires: number; csrf: string };
type Attempt = { context: string; epoch: number; expires: number; consumed: boolean };
type Session = {
  context: string;
  epoch: number;
  actor: string;
  accountEpoch: number;
  expires: number;
};
export type Headers = { context?: string; session?: string };
export class ModelJar {
  context?: string;
  session?: string;
  apply(h: Headers) {
    if (h.context !== undefined) this.context = h.context;
    if (h.session !== undefined) this.session = h.session;
  }
}
export class SessionOrderModel {
  now = 0;
  available = true;
  sequence = 0;
  contexts = new Map<string, Context>();
  attempts = new Map<string, Attempt>();
  sessions = new Map<string, Session>();
  accounts = new Map([
    ['A', { active: true, epoch: 0 }],
    ['B', { active: true, epoch: 0 }],
  ]);
  writes: string[] = [];
  private label(prefix: string) {
    return prefix + ++this.sequence;
  }
  private context(id: string | undefined) {
    const c = id && this.contexts.get(id);
    return c && c.expires > this.now ? c : null;
  }
  // Every bootstrap emits a fresh id exactly once; never an attempt or session.
  bootstrap(): Headers {
    const id = this.label('context-');
    this.contexts.set(id, { epoch: 0, expires: this.now + 1000, csrf: this.label('csrf-') });
    return { context: id };
  }
  proof(id: string | undefined, action: 'start' | 'logout' = 'start') {
    const c = this.context(id);
    return this.available && c ? c.csrf + ':' + action : null;
  }
  start(id: string | undefined, csrf: string | undefined): string | null {
    const c = this.context(id);
    if (
      !this.available ||
      !c ||
      !csrf ||
      c.csrf + ':start' !== csrf ||
      c.epoch === Number.MAX_SAFE_INTEGER
    )
      return null;
    c.epoch++;
    const attempt = this.label('attempt-');
    this.attempts.set(attempt, {
      context: id!,
      epoch: c.epoch,
      expires: this.now + 10,
      consumed: false,
    });
    return attempt;
  }
  claim(attempt: string, id: string | undefined) {
    const a = this.attempts.get(attempt);
    if (!this.available || !a || a.consumed || a.expires <= this.now || a.context !== id)
      return false;
    a.consumed = true;
    return true;
  }
  // Assumes successful provider verification AFTER claim; exact insert-time epoch guard.
  issue(attempt: string, id: string | undefined, actor: string): Headers {
    const a = this.attempts.get(attempt),
      c = this.context(id),
      account = this.accounts.get(actor);
    if (
      !this.available ||
      !a ||
      !a.consumed ||
      a.expires <= this.now ||
      a.context !== id ||
      !c ||
      a.epoch !== c.epoch ||
      !account?.active
    )
      return {};
    // A real completion also needs a one-use claim ticket; model removes it atomically.
    this.attempts.delete(attempt);
    const token = this.label('session-');
    this.sessions.set(token, {
      context: id!,
      epoch: c.epoch,
      actor,
      accountEpoch: account.epoch,
      expires: this.now + 100,
    });
    return { session: token };
  }
  complete(attempt: string, id: string | undefined, actor: string) {
    return this.claim(attempt, id) ? this.issue(attempt, id, actor) : {};
  }
  inspect(
    jar: ModelJar,
  ): { kind: 'authenticated'; actor: string } | { kind: 'signed-out' | 'unavailable' } {
    if (!this.available) return { kind: 'unavailable' };
    const c = this.context(jar.context),
      s = jar.session ? this.sessions.get(jar.session) : undefined,
      account = s ? this.accounts.get(s.actor) : undefined;
    return c &&
      s &&
      s.context === jar.context &&
      s.epoch === c.epoch &&
      s.expires > this.now &&
      account?.active &&
      s.accountEpoch === account.epoch
      ? { kind: 'authenticated', actor: s.actor }
      : { kind: 'signed-out' };
  }
  // A previous successful preflight never authorizes a later commit by itself.
  commit(jar: ModelJar) {
    const s = this.inspect(jar);
    if (s.kind !== 'authenticated') return false;
    this.writes.push(s.actor);
    return true;
  }
  logout(id: string | undefined, csrf: string | undefined) {
    const c = this.context(id);
    if (
      !this.available ||
      !c ||
      !csrf ||
      c.csrf + ':logout' !== csrf ||
      c.epoch === Number.MAX_SAFE_INTEGER
    )
      return false;
    c.epoch++;
    return true; // no Set-Cookie deletion: a delayed deletion would erase a newer session
  }
}
