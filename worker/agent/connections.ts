import { base64url } from 'jose';
import {
  liveSessionSql,
  liveSessionBindings,
  type SessionStorageProof,
} from '../auth/session-guard';
import { periodSql } from '../auth/student-participation';
import { pkceChallenge } from '../auth/pkce';

/**
 * Server repository for AI agent connections (MCP over OAuth 2.1).
 * Codes, tokens and consent request ids are random 256-bit values; only their SHA-256 is stored.
 * Every final statement rechecks the grant, the account state and (for writes) the enrollment period.
 */
export const REQUEST_TTL_MS = 10 * 60_000;
export const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
export const GRANT_TTL_MS = 90 * 24 * 60 * 60_000;
export const DAILY_AGENT_DRAFTS = 10;
const DAY_MS = 24 * 60 * 60_000;
const CLIENTS_PER_HOUR = 300;
const REQUESTS_PER_HOUR = 1000;
const GRANTS_PER_ACCOUNT = 10;

export const randomSecret = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const rawValid = (v: unknown, prefix = ''): v is string =>
  typeof v === 'string' &&
  v.length === prefix.length + 43 &&
  v.startsWith(prefix) &&
  /^[A-Za-z0-9_-]{43}$/.test(v.slice(prefix.length));
export async function secretHash(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('agent-v1:' + value)),
  );
  return Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
}
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);

export interface AgentClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}
export interface AgentAccess {
  tokenHash: string;
  grantId: string;
  accountId: string;
}
export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}
export interface AgentConnectionView {
  id: string;
  clientName: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}
export interface AgentDraft {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: number;
  createdByAgent: boolean;
  /** Public article id when the student has published this draft (and it is still published). */
  publishedArticleId: string | null;
}
export type AgentDraftSummary = Omit<AgentDraft, 'body'>;
export type DraftWriteResult =
  | { ok: true; draft: AgentDraft }
  | {
      ok: false;
      reason:
        | 'unauthorized'
        | 'not_found'
        | 'version_conflict'
        | 'daily_limit'
        | 'not_enrolled'
        | 'project_not_found';
    };
/** One of the student's own live published projects (#276). Only fields already on its public page. */
export interface AgentProject {
  id: string;
  title: string;
  publishedAt: number;
}
/** Editing an already published article while it stays published. Never a first publication. */
export type PublishedEditResult =
  | { ok: true; draft: AgentDraft; articleId: string }
  | {
      ok: false;
      reason:
        | 'unauthorized'
        | 'not_found'
        | 'not_published'
        | 'version_conflict'
        | 'unpublished_changes'
        | 'unavailable'
        | 'not_enrolled';
    };

export const SCOPE = 'drafts';
/** Optional publication suggestions from the agent. Used only when the student presses it. */
export interface DraftHints {
  summary: string;
  tags: string[];
}
export interface AgentDraftHintsView extends DraftHints {
  draftId: string;
}

/** A grant that is unrevoked, unexpired, and still matches the account's current state. */
const grantLiveSql = `EXISTS(SELECT 1 FROM agent_grants g JOIN private_accounts a ON a.id=g.account_id WHERE g.id=? AND g.account_id=? AND g.revoked_at_ms IS NULL AND g.expires_at_ms>? AND g.created_at_ms<=? AND a.status='active' AND a.session_epoch=g.account_epoch)`;
/** The presented access token is still current for that grant. */
const accessLiveSql = `EXISTS(SELECT 1 FROM agent_tokens t WHERE t.token_hash=? AND t.grant_id=? AND t.kind='access' AND t.used_at_ms IS NULL AND t.expires_at_ms>? AND t.created_at_ms<=?)`;
export const liveAccess = `(${grantLiveSql} AND ${accessLiveSql})`;
export const accessBindings = (a: AgentAccess, now: number) => [
  a.grantId,
  a.accountId,
  now,
  now,
  a.tokenHash,
  a.grantId,
  now,
  now,
];
export const periodBindings = (a: AgentAccess, now: number) => [a.accountId, now, now, now];

type DraftRow = {
  id: string;
  title: string;
  body: string;
  version: number;
  updated_at_ms: number;
  by_agent: number;
  published_id?: string | null;
};
const draftDto = (r: DraftRow): AgentDraft => ({
  id: r.id,
  title: r.title,
  body: r.body,
  version: r.version,
  updatedAt: r.updated_at_ms,
  createdByAgent: r.by_agent === 1,
  publishedArticleId: r.published_id ?? null,
});
/** The live public article that a draft was published as (first publication by the student). */
const publishedIdSql = (draft: string) =>
  `(SELECT r.content_id FROM article_publications r JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id AND c.kind='article' AND c.status='published' AND c.is_sample=0 WHERE r.draft_id=${draft}.id AND r.owner_account_id=${draft}.owner_account_id)`;

export class AgentConnectionStore {
  constructor(
    private readonly db: D1Database,
    private readonly clock: () => number = Date.now,
  ) {}
  private now() {
    const n = this.clock();
    if (!Number.isSafeInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER - GRANT_TTL_MS)
      throw Error('unavailable clock');
    return n;
  }

  // ---- OAuth clients and consent requests (unauthenticated, bounded) ----

  async registerClient(
    clientName: string,
    redirectUris: string[],
  ): Promise<AgentClient | 'rate_limited' | null> {
    try {
      const now = this.now();
      const clientId = randomSecret();
      const row = await this.db
        .prepare(
          `INSERT INTO agent_oauth_clients(client_id,client_name,redirect_uris_json,created_at_ms) SELECT ?,?,?,? WHERE (SELECT count(*) FROM agent_oauth_clients WHERE created_at_ms>?)<? RETURNING client_id`,
        )
        .bind(
          clientId,
          clientName,
          JSON.stringify(redirectUris),
          now,
          now - 3_600_000,
          CLIENTS_PER_HOUR,
        )
        .first<{ client_id: string }>();
      return row ? { clientId, clientName, redirectUris } : 'rate_limited';
    } catch {
      return null;
    }
  }

  async getClient(clientId: unknown): Promise<AgentClient | null> {
    if (!rawValid(clientId)) return null;
    try {
      const row = await this.db
        .prepare(
          'SELECT client_id,client_name,redirect_uris_json FROM agent_oauth_clients WHERE client_id=?',
        )
        .bind(clientId)
        .first<{ client_id: string; client_name: string; redirect_uris_json: string }>();
      if (!row) return null;
      const uris = JSON.parse(row.redirect_uris_json);
      return Array.isArray(uris) && uris.every((u) => typeof u === 'string')
        ? { clientId: row.client_id, clientName: row.client_name, redirectUris: uris }
        : null;
    } catch {
      return null;
    }
  }

  async createRequest(input: {
    clientId: string;
    redirectUri: string;
    state: string | null;
    codeChallenge: string;
  }): Promise<string | 'rate_limited' | null> {
    try {
      const now = this.now();
      const raw = randomSecret();
      const row = await this.db
        .prepare(
          `INSERT INTO agent_oauth_requests(request_hash,client_id,redirect_uri,state,code_challenge,created_at_ms,expires_at_ms) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM agent_oauth_requests WHERE created_at_ms>?)<? RETURNING request_hash`,
        )
        .bind(
          await secretHash(raw),
          input.clientId,
          input.redirectUri,
          input.state,
          input.codeChallenge,
          now,
          now + REQUEST_TTL_MS,
          now - 3_600_000,
          REQUESTS_PER_HOUR,
        )
        .first();
      return row ? raw : 'rate_limited';
    } catch {
      return null;
    }
  }

  /** Consent screen data. Requires a live browser session; returns no identity. */
  async readRequest(
    proof: SessionStorageProof,
    requestId: unknown,
  ): Promise<{ clientName: string; redirectUri: string } | null> {
    if (!rawValid(requestId)) return null;
    try {
      const row = await this.db
        .prepare(
          `SELECT c.client_name,r.redirect_uri FROM agent_oauth_requests r JOIN agent_oauth_clients c ON c.client_id=r.client_id WHERE r.request_hash=? AND r.used_at_ms IS NULL AND r.expires_at_ms>? AND r.created_at_ms<=? AND ${liveSessionSql}`,
        )
        .bind(await secretHash(requestId), proof.nowMs, proof.nowMs, ...liveSessionBindings(proof))
        .first<{ client_name: string; redirect_uri: string }>();
      return row ? { clientName: row.client_name, redirectUri: row.redirect_uri } : null;
    } catch {
      return null;
    }
  }

  /**
   * The student's decision. Allow creates the grant and a one-time code in one transaction,
   * bound to the server-verified session's account; the request can be decided only once.
   */
  async decideRequest(
    proof: SessionStorageProof,
    requestId: unknown,
    allow: boolean,
  ): Promise<
    | { redirectUri: string; state: string | null; code: string | null }
    | 'too_many_connections'
    | null
  > {
    if (!rawValid(requestId)) return null;
    try {
      const now = proof.nowMs;
      const requestHash = await secretHash(requestId);
      const used = await this.db
        .prepare(
          `UPDATE agent_oauth_requests SET used_at_ms=? WHERE request_hash=? AND used_at_ms IS NULL AND expires_at_ms>? AND created_at_ms<=? AND ${liveSessionSql} RETURNING client_id,redirect_uri,state,code_challenge`,
        )
        .bind(now, requestHash, now, now, ...liveSessionBindings(proof))
        .first<{
          client_id: string;
          redirect_uri: string;
          state: string | null;
          code_challenge: string;
        }>();
      if (!used) return null;
      if (!allow) return { redirectUri: used.redirect_uri, state: used.state, code: null };
      const grantId = crypto.randomUUID();
      const code = randomSecret();
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO agent_grants(id,account_id,account_epoch,client_id,client_name,created_at_ms,last_used_at_ms,expires_at_ms) SELECT ?,a.id,a.session_epoch,c.client_id,c.client_name,?,?,? FROM private_accounts a JOIN agent_oauth_clients c ON c.client_id=? WHERE a.id=? AND a.status='active' AND ${liveSessionSql} AND (SELECT count(*) FROM agent_grants x WHERE x.account_id=a.id AND x.revoked_at_ms IS NULL AND x.expires_at_ms>?)<? RETURNING id`,
          )
          .bind(
            grantId,
            now,
            now,
            now + GRANT_TTL_MS,
            used.client_id,
            proof.accountId,
            ...liveSessionBindings(proof),
            now,
            GRANTS_PER_ACCOUNT,
          ),
        this.db
          .prepare(
            `INSERT INTO agent_tokens(token_hash,grant_id,kind,redirect_uri,code_challenge,created_at_ms,expires_at_ms) SELECT ?,id,'code',?,?,?,? FROM agent_grants WHERE id=? AND account_id=?`,
          )
          .bind(
            await secretHash(code),
            used.redirect_uri,
            used.code_challenge,
            now,
            now + CODE_TTL_MS,
            grantId,
            proof.accountId,
          ),
      ]);
      if (!results[0].results.length) return 'too_many_connections';
      return { redirectUri: used.redirect_uri, state: used.state, code };
    } catch {
      return null;
    }
  }

  // ---- Token endpoint ----

  private async issue(grantId: string, now: number): Promise<TokenPair | null> {
    const access = 'ksh_at_' + randomSecret();
    const refresh = 'ksh_rt_' + randomSecret();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO agent_tokens(token_hash,grant_id,kind,created_at_ms,expires_at_ms) SELECT ?,id,'access',?,min(?,expires_at_ms) FROM agent_grants WHERE id=? AND revoked_at_ms IS NULL AND expires_at_ms>? RETURNING expires_at_ms`,
        )
        .bind(await secretHash(access), now, now + ACCESS_TTL_MS, grantId, now),
      this.db
        .prepare(
          `INSERT INTO agent_tokens(token_hash,grant_id,kind,created_at_ms,expires_at_ms) SELECT ?,id,'refresh',?,min(?,expires_at_ms) FROM agent_grants WHERE id=? AND revoked_at_ms IS NULL AND expires_at_ms>? RETURNING expires_at_ms`,
        )
        .bind(await secretHash(refresh), now, now + REFRESH_TTL_MS, grantId, now),
    ]);
    const row = results[0].results[0] as { expires_at_ms: number } | undefined;
    if (!row || !results[1].results.length) return null;
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.max(1, Math.floor((row.expires_at_ms - now) / 1000)),
      refresh_token: refresh,
      scope: SCOPE,
    };
  }

  private async revokeGrantById(grantId: string, now: number) {
    await this.db.batch([
      this.db
        .prepare('UPDATE agent_grants SET revoked_at_ms=? WHERE id=? AND revoked_at_ms IS NULL')
        .bind(now, grantId),
      this.db.prepare('DELETE FROM agent_tokens WHERE grant_id=?').bind(grantId),
    ]);
  }

  /** Authorization code + PKCE. A replayed code revokes the whole connection (RFC 9700). */
  async exchangeCode(input: {
    code: unknown;
    clientId: unknown;
    redirectUri: unknown;
    verifier: unknown;
  }): Promise<TokenPair | null> {
    const { code, clientId, redirectUri, verifier } = input;
    if (
      !rawValid(code) ||
      !rawValid(clientId) ||
      typeof redirectUri !== 'string' ||
      redirectUri.length > 2048
    )
      return null;
    // Malformed verifiers stop here, before the code is looked up or marked used.
    const challenge = await pkceChallenge(verifier);
    if (!challenge) return null;
    try {
      const now = this.now();
      const hash = await secretHash(code);
      const row = await this.db
        .prepare(
          `UPDATE agent_tokens SET used_at_ms=? WHERE token_hash=? AND kind='code' AND used_at_ms IS NULL AND expires_at_ms>? AND created_at_ms<=? AND redirect_uri=? AND code_challenge=? AND EXISTS(SELECT 1 FROM agent_grants g JOIN private_accounts a ON a.id=g.account_id WHERE g.id=agent_tokens.grant_id AND g.client_id=? AND g.revoked_at_ms IS NULL AND g.expires_at_ms>? AND a.status='active' AND a.session_epoch=g.account_epoch) RETURNING grant_id`,
        )
        .bind(now, hash, now, now, redirectUri, challenge, clientId, now)
        .first<{ grant_id: string }>();
      if (!row) {
        const replay = await this.db
          .prepare(
            "SELECT grant_id FROM agent_tokens WHERE token_hash=? AND kind='code' AND used_at_ms IS NOT NULL",
          )
          .bind(hash)
          .first<{ grant_id: string }>();
        if (replay) await this.revokeGrantById(replay.grant_id, now);
        return null;
      }
      return await this.issue(row.grant_id, now);
    } catch {
      return null;
    }
  }

  /** Rotating refresh tokens. Reuse of a spent token revokes the connection. */
  async refresh(input: { refreshToken: unknown; clientId: unknown }): Promise<TokenPair | null> {
    const { refreshToken, clientId } = input;
    if (!rawValid(refreshToken, 'ksh_rt_') || !rawValid(clientId)) return null;
    try {
      const now = this.now();
      const hash = await secretHash(refreshToken);
      const row = await this.db
        .prepare(
          `UPDATE agent_tokens SET used_at_ms=? WHERE token_hash=? AND kind='refresh' AND used_at_ms IS NULL AND expires_at_ms>? AND created_at_ms<=? AND EXISTS(SELECT 1 FROM agent_grants g JOIN private_accounts a ON a.id=g.account_id WHERE g.id=agent_tokens.grant_id AND g.client_id=? AND g.revoked_at_ms IS NULL AND g.expires_at_ms>? AND a.status='active' AND a.session_epoch=g.account_epoch) RETURNING grant_id`,
        )
        .bind(now, hash, now, now, clientId, now)
        .first<{ grant_id: string }>();
      if (!row) {
        const spent = await this.db
          .prepare(
            "SELECT grant_id FROM agent_tokens WHERE token_hash=? AND kind='refresh' AND used_at_ms IS NOT NULL",
          )
          .bind(hash)
          .first<{ grant_id: string }>();
        if (spent) await this.revokeGrantById(spent.grant_id, now);
        return null;
      }
      // Previous access tokens of this connection stop with the rotation.
      await this.db
        .prepare(
          "UPDATE agent_tokens SET used_at_ms=? WHERE grant_id=? AND kind='access' AND used_at_ms IS NULL",
        )
        .bind(now, row.grant_id)
        .run();
      return await this.issue(row.grant_id, now);
    } catch {
      return null;
    }
  }

  /** RFC 7009: revoking either token ends the whole connection. Unknown tokens are not an error. */
  async revokeToken(token: unknown): Promise<void> {
    if (!rawValid(token, 'ksh_at_') && !rawValid(token, 'ksh_rt_')) return;
    try {
      const row = await this.db
        .prepare(
          "SELECT grant_id FROM agent_tokens WHERE token_hash=? AND kind IN ('access','refresh')",
        )
        .bind(await secretHash(token as string))
        .first<{ grant_id: string }>();
      if (row) await this.revokeGrantById(row.grant_id, this.now());
    } catch {
      /* revocation is best effort for the caller; the grant check still applies */
    }
  }

  // ---- Bearer access for the MCP endpoint ----

  async authenticate(authorization: string | null): Promise<AgentAccess | null> {
    if (!authorization || authorization.length > 200) return null;
    const match = /^Bearer (ksh_at_[A-Za-z0-9_-]{43})$/.exec(authorization);
    if (!match) return null;
    try {
      const now = this.now();
      const tokenHash = await secretHash(match[1]);
      const row = await this.db
        .prepare(
          `SELECT g.id AS grant_id,g.account_id,g.last_used_at_ms FROM agent_tokens t JOIN agent_grants g ON g.id=t.grant_id JOIN private_accounts a ON a.id=g.account_id WHERE t.token_hash=? AND t.kind='access' AND t.used_at_ms IS NULL AND t.expires_at_ms>? AND t.created_at_ms<=? AND g.revoked_at_ms IS NULL AND g.expires_at_ms>? AND a.status='active' AND a.session_epoch=g.account_epoch`,
        )
        .bind(tokenHash, now, now, now)
        .first<{ grant_id: string; account_id: string; last_used_at_ms: number }>();
      if (!row) return null;
      if (now - row.last_used_at_ms > 60_000)
        await this.db
          .prepare('UPDATE agent_grants SET last_used_at_ms=? WHERE id=? AND last_used_at_ms<?')
          .bind(now, row.grant_id, now)
          .run();
      return { tokenHash, grantId: row.grant_id, accountId: row.account_id };
    } catch {
      return null;
    }
  }

  // ---- The student's own drafts, through a connection ----

  async listDrafts(a: AgentAccess): Promise<AgentDraftSummary[] | null> {
    try {
      const now = this.now();
      const rows = await this.db
        .prepare(
          `SELECT d.id,d.title,d.version,d.updated_at_ms,CASE WHEN o.draft_id IS NULL THEN 0 ELSE 1 END AS by_agent,${publishedIdSql('d')} AS published_id FROM (SELECT 1 WHERE ${liveAccess}) authorized LEFT JOIN private_article_drafts d ON d.owner_account_id=? LEFT JOIN agent_draft_origins o ON o.draft_id=d.id ORDER BY d.updated_at_ms DESC,d.id ASC LIMIT 20`,
        )
        .bind(...accessBindings(a, now), a.accountId)
        .all<Omit<DraftRow, 'body'>>();
      if (!rows.results.length) return null;
      return rows.results
        .filter((r) => r.id !== null)
        .map((r) => ({
          id: r.id,
          title: r.title,
          version: r.version,
          updatedAt: r.updated_at_ms,
          createdByAgent: r.by_agent === 1,
          publishedArticleId: r.published_id ?? null,
        }));
    } catch {
      return null;
    }
  }

  async readDraft(a: AgentAccess, id: unknown): Promise<AgentDraft | 'not_found' | null> {
    if (!uuid(id)) return 'not_found';
    try {
      const now = this.now();
      const rows = await this.db
        .prepare(
          `SELECT d.id,d.title,d.body,d.version,d.updated_at_ms,CASE WHEN o.draft_id IS NULL THEN 0 ELSE 1 END AS by_agent,${publishedIdSql('d')} AS published_id FROM (SELECT 1 WHERE ${liveAccess}) authorized LEFT JOIN private_article_drafts d ON d.id=? AND d.owner_account_id=? LEFT JOIN agent_draft_origins o ON o.draft_id=d.id`,
        )
        .bind(...accessBindings(a, now), id, a.accountId)
        .all<DraftRow>();
      if (!rows.results.length) return null;
      const row = rows.results[0];
      return row.id === null ? 'not_found' : draftDto(row);
    } catch {
      return null;
    }
  }

  /**
   * The student's own live published projects (#276), newest first, at most 20. Another student's
   * project, a stopped or hidden one and drafts are never returned; nothing private is selected.
   */
  async listProjects(a: AgentAccess): Promise<AgentProject[] | null> {
    try {
      const now = this.now();
      const rows = await this.db
        .prepare(
          `SELECT r.id,CASE WHEN length(r.title)<=200 AND length(CAST(r.title AS BLOB))<=800 THEN r.title ELSE '' END title,r.published_at_ms FROM (SELECT 1 WHERE ${liveAccess}) authorized LEFT JOIN project_publications r ON r.owner_account_id=? AND r.status='published' AND r.published_at_ms<=? ORDER BY r.published_at_ms DESC,r.id ASC LIMIT 20`,
        )
        .bind(...accessBindings(a, now), a.accountId, now)
        .all<{ id: string | null; title: string; published_at_ms: number }>();
      if (!rows.results.length) return null;
      return rows.results
        .filter((r): r is { id: string; title: string; published_at_ms: number } => uuid(r.id))
        .map((r) => ({ id: r.id, title: r.title, publishedAt: r.published_at_ms }));
    } catch {
      return null;
    }
  }

  private async writeFailure(
    a: AgentAccess,
    now: number,
    projectId: string | null = null,
  ): Promise<DraftWriteResult> {
    const state = await this.db
      .prepare(
        `SELECT (SELECT 1 WHERE ${liveAccess}) AS live,(SELECT 1 WHERE ${periodSql}) AS enrolled,(SELECT 1 FROM project_publications WHERE id=? AND owner_account_id=? AND status='published') AS project,(SELECT count(*) FROM agent_draft_origins WHERE account_id=? AND created_at_ms>?) AS today`,
      )
      .bind(
        ...accessBindings(a, now),
        ...periodBindings(a, now),
        projectId,
        a.accountId,
        a.accountId,
        now - DAY_MS,
      )
      .first<{ live: number | null; enrolled: number | null; project: number | null }>();
    if (!state?.live) return { ok: false, reason: 'unauthorized' };
    if (!state.enrolled) return { ok: false, reason: 'not_enrolled' };
    if (projectId !== null && !state.project) return { ok: false, reason: 'project_not_found' };
    return { ok: false, reason: 'daily_limit' };
  }

  async createDraft(
    a: AgentAccess,
    title: string,
    body: string,
    hints: DraftHints | null = null,
    projectId: string | null = null,
  ): Promise<DraftWriteResult | null> {
    if (projectId !== null && !uuid(projectId)) return { ok: false, reason: 'project_not_found' };
    try {
      const now = this.now();
      const id = crypto.randomUUID();
      // #276: the project must be the student's own live published one, checked in the same INSERT,
      // so a refused project saves nothing at all (no draft, no origin, no hints).
      const projectSql = projectId
        ? " AND EXISTS(SELECT 1 FROM project_publications r WHERE r.id=? AND r.owner_account_id=? AND r.status='published')"
        : '';
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms) SELECT ?,?,?,?,1,? WHERE ${liveAccess} AND ${periodSql} AND (SELECT count(*) FROM agent_draft_origins WHERE account_id=? AND created_at_ms>?)<?${projectSql} RETURNING id,title,body,version,updated_at_ms,1 AS by_agent`,
          )
          .bind(
            id,
            a.accountId,
            title,
            body,
            now,
            ...accessBindings(a, now),
            ...periodBindings(a, now),
            a.accountId,
            now - DAY_MS,
            DAILY_AGENT_DRAFTS,
            ...(projectId ? [projectId, a.accountId] : []),
          ),
        this.db
          .prepare(
            'INSERT INTO agent_draft_origins(draft_id,account_id,grant_id,created_at_ms) SELECT id,owner_account_id,?,? FROM private_article_drafts WHERE id=? AND owner_account_id=?',
          )
          .bind(a.grantId, now, id, a.accountId),
        ...(hints ? [this.hintsStatement(a, id, hints, now)] : []),
        ...(projectId
          ? [
              this.db
                .prepare(
                  'INSERT INTO agent_draft_projects(draft_id,project_id,owner_account_id,created_at_ms) SELECT id,?,owner_account_id,? FROM private_article_drafts WHERE id=? AND owner_account_id=?',
                )
                .bind(projectId, now, id, a.accountId),
            ]
          : []),
      ]);
      const row = results[0].results[0] as DraftRow | undefined;
      return row ? { ok: true, draft: draftDto(row) } : await this.writeFailure(a, now, projectId);
    } catch {
      return null;
    }
  }

  async updateDraft(
    a: AgentAccess,
    id: unknown,
    title: string,
    body: string,
    expectedVersion: number,
    hints: DraftHints | null = null,
  ): Promise<DraftWriteResult | null> {
    if (!uuid(id)) return { ok: false, reason: 'not_found' };
    try {
      const now = this.now();
      const row = await this.db
        .prepare(
          `UPDATE private_article_drafts SET title=?,body=?,version=version+1,updated_at_ms=? WHERE id=? AND owner_account_id=? AND version=? AND updated_at_ms<=? AND ${liveAccess} AND ${periodSql} RETURNING id,title,body,version,updated_at_ms,(SELECT count(*) FROM agent_draft_origins o WHERE o.draft_id=private_article_drafts.id) AS by_agent,${publishedIdSql('private_article_drafts')} AS published_id`,
        )
        .bind(
          title,
          body,
          now,
          id,
          a.accountId,
          expectedVersion,
          now,
          ...accessBindings(a, now),
          ...periodBindings(a, now),
        )
        .first<DraftRow>();
      if (row) {
        if (hints) await this.hintsStatement(a, row.id, hints, now).run();
        return { ok: true, draft: draftDto(row) };
      }
      const current = await this.readDraft(a, id);
      if (current === null) return { ok: false, reason: 'unauthorized' };
      if (current === 'not_found') return { ok: false, reason: 'not_found' };
      if (current.version !== expectedVersion) return { ok: false, reason: 'version_conflict' };
      const failure = await this.writeFailure(a, now);
      return failure.ok === false && failure.reason === 'daily_limit'
        ? { ok: false, reason: 'version_conflict' }
        : failure;
    } catch {
      return null;
    }
  }

  /**
   * Replaces the title/body of an article the student has already published, and publishes that
   * edit as the next revision in the same transaction (the article stays public throughout).
   * It never inserts into article_publications: the first publication stays a human-only action
   * in the app. Summary, tags and the other public fields are carried over from the current
   * revision. Refused when the draft holds the student's own unpublished edits, so an agent can
   * never push private work-in-progress to the public page.
   */
  async editPublishedArticle(
    a: AgentAccess,
    id: unknown,
    title: string,
    body: string,
    expectedVersion: number,
  ): Promise<PublishedEditResult | null> {
    if (!uuid(id)) return { ok: false, reason: 'not_found' };
    try {
      const now = this.now();
      const state = await this.db
        .prepare(
          `SELECT d.id,d.version,r.content_id,c.status,cur.revision,cur.source_version,cur.media_ids_json,(SELECT 1 WHERE ${periodSql}) AS enrolled,EXISTS(SELECT 1 FROM article_publication_stops WHERE content_id=r.content_id) AS stopped,EXISTS(SELECT 1 FROM article_reports report WHERE report.content_id=r.content_id AND report.round=COALESCE((SELECT round FROM article_moderation_state WHERE content_id=r.content_id),1)) AS reported FROM (SELECT 1 WHERE ${liveAccess}) authorized LEFT JOIN private_article_drafts d ON d.id=? AND d.owner_account_id=? LEFT JOIN article_publications r ON r.draft_id=d.id AND r.owner_account_id=d.owner_account_id LEFT JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id AND c.kind='article' AND c.is_sample=0 LEFT JOIN article_publication_revisions cur ON cur.content_id=r.content_id AND cur.revision=(SELECT MAX(revision) FROM article_publication_revisions WHERE content_id=r.content_id)`,
        )
        .bind(...periodBindings(a, now), ...accessBindings(a, now), id, a.accountId)
        .all<{
          id: string | null;
          version: number;
          content_id: string | null;
          status: string | null;
          revision: number | null;
          source_version: number | null;
          media_ids_json: string | null;
          enrolled: number | null;
          stopped: number;
          reported: number;
        }>();
      if (!state.results.length) return { ok: false, reason: 'unauthorized' };
      const s = state.results[0];
      if (s.id === null) return { ok: false, reason: 'not_found' };
      if (s.content_id === null || s.revision === null)
        return { ok: false, reason: 'not_published' };
      if (s.status !== 'published' || s.stopped || s.reported || s.revision >= 1000)
        return { ok: false, reason: 'unavailable' };
      if (!s.enrolled) return { ok: false, reason: 'not_enrolled' };
      if (s.version !== expectedVersion) return { ok: false, reason: 'version_conflict' };
      if (s.source_version !== s.version) return { ok: false, reason: 'unpublished_changes' };
      // Keep only images the current revision already shows and the new body still references.
      const media = (JSON.parse(s.media_ids_json ?? '[]') as string[]).filter((m) =>
        body.includes('/api/media/' + m),
      );
      const results = await this.db.batch([
        this.db
          .prepare(
            `UPDATE private_article_drafts SET title=?,body=?,version=version+1,updated_at_ms=? WHERE id=? AND owner_account_id=? AND version=? AND updated_at_ms<=? AND ${liveAccess} AND ${periodSql} AND EXISTS(SELECT 1 FROM article_publications r JOIN article_publication_revisions cur ON cur.content_id=r.content_id AND cur.revision=? WHERE r.draft_id=private_article_drafts.id AND r.owner_account_id=private_article_drafts.owner_account_id AND cur.source_version=private_article_drafts.version AND NOT EXISTS(SELECT 1 FROM article_publication_revisions later WHERE later.content_id=r.content_id AND later.revision>cur.revision)) RETURNING id`,
          )
          .bind(
            title,
            body,
            now,
            id,
            a.accountId,
            expectedVersion,
            now,
            ...accessBindings(a, now),
            ...periodBindings(a, now),
            s.revision,
          ),
        // Selects nothing unless the UPDATE above applied (d.version is then expected+1). The
        // article_revision_guard trigger re-checks stops, open reports and account state, and its
        // RAISE rolls back the whole batch, so a private-only half write cannot remain.
        this.db
          .prepare(
            `INSERT INTO article_publication_revisions(content_id,revision,source_version,title,body,summary,tags_json,audience,prerequisite,outcome,minutes,media_ids_json,published_at_ms) SELECT r.content_id,cur.revision+1,d.version,d.title,d.body,cur.summary,cur.tags_json,cur.audience,cur.prerequisite,cur.outcome,cur.minutes,?,? FROM private_article_drafts d JOIN article_publications r ON r.draft_id=d.id AND r.owner_account_id=d.owner_account_id JOIN article_publication_revisions cur ON cur.content_id=r.content_id AND cur.revision=? WHERE d.id=? AND d.owner_account_id=? AND d.version=? AND cur.source_version=? RETURNING content_id`,
          )
          .bind(
            JSON.stringify(media),
            now,
            s.revision,
            id,
            a.accountId,
            expectedVersion + 1,
            expectedVersion,
          ),
      ]);
      const published = results[1].results[0] as { content_id: string } | undefined;
      if (!results[0].results.length || !published)
        return { ok: false, reason: 'version_conflict' };
      const draft = await this.readDraft(a, id);
      if (!draft || draft === 'not_found') return { ok: false, reason: 'unauthorized' };
      return { ok: true, draft, articleId: published.content_id };
    } catch {
      return null;
    }
  }

  /** Upserts hints only for the student's own existing draft. */
  private hintsStatement(a: AgentAccess, draftId: string, hints: DraftHints, now: number) {
    return this.db
      .prepare(
        'INSERT INTO agent_draft_hints(draft_id,account_id,summary,tags_json,updated_at_ms) SELECT id,owner_account_id,?,?,? FROM private_article_drafts WHERE id=? AND owner_account_id=? ON CONFLICT(draft_id) DO UPDATE SET summary=excluded.summary,tags_json=excluded.tags_json,updated_at_ms=excluded.updated_at_ms',
      )
      .bind(hints.summary, JSON.stringify(hints.tags), now, draftId, a.accountId);
  }

  // ---- The student's connection list (browser session) ----

  async listConnections(proof: SessionStorageProof): Promise<{
    connections: AgentConnectionView[];
    agentDraftIds: string[];
    hints: AgentDraftHintsView[];
  } | null> {
    try {
      const now = proof.nowMs;
      const rows = await this.db
        .prepare(
          `SELECT g.id,g.client_name,g.created_at_ms,g.last_used_at_ms,g.expires_at_ms FROM (SELECT 1 WHERE ${liveSessionSql}) authorized LEFT JOIN agent_grants g ON g.account_id=? AND g.revoked_at_ms IS NULL AND g.expires_at_ms>? AND g.account_epoch=(SELECT session_epoch FROM private_accounts WHERE id=?) ORDER BY g.created_at_ms DESC LIMIT 20`,
        )
        .bind(...liveSessionBindings(proof), proof.accountId, now, proof.accountId)
        .all<{
          id: string | null;
          client_name: string;
          created_at_ms: number;
          last_used_at_ms: number;
          expires_at_ms: number;
        }>();
      if (!rows.results.length) return null;
      const drafts = await this.db
        .prepare(
          'SELECT draft_id FROM agent_draft_origins WHERE account_id=? ORDER BY created_at_ms DESC LIMIT 100',
        )
        .bind(proof.accountId)
        .all<{ draft_id: string }>();
      const hints = await this.db
        .prepare(
          'SELECT draft_id,summary,tags_json FROM agent_draft_hints WHERE account_id=? ORDER BY updated_at_ms DESC LIMIT 100',
        )
        .bind(proof.accountId)
        .all<{ draft_id: string; summary: string; tags_json: string }>();
      return {
        connections: rows.results
          .filter((r) => r.id !== null)
          .map((r) => ({
            id: r.id!,
            clientName: r.client_name,
            createdAt: r.created_at_ms,
            lastUsedAt: r.last_used_at_ms,
            expiresAt: r.expires_at_ms,
          })),
        agentDraftIds: drafts.results.map((r) => r.draft_id),
        hints: hints.results.flatMap((r) => {
          try {
            const tags = JSON.parse(r.tags_json);
            return Array.isArray(tags) && tags.every((t) => typeof t === 'string')
              ? [{ draftId: r.draft_id, summary: r.summary, tags }]
              : [];
          } catch {
            return [];
          }
        }),
      };
    } catch {
      return null;
    }
  }

  async revokeConnection(proof: SessionStorageProof, id: unknown): Promise<boolean | null> {
    if (!uuid(id)) return false;
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `UPDATE agent_grants SET revoked_at_ms=? WHERE id=? AND account_id=? AND revoked_at_ms IS NULL AND ${liveSessionSql} RETURNING id`,
          )
          .bind(proof.nowMs, id, proof.accountId, ...liveSessionBindings(proof)),
        this.db
          .prepare(
            'DELETE FROM agent_tokens WHERE grant_id IN (SELECT id FROM agent_grants WHERE id=? AND account_id=? AND revoked_at_ms IS NOT NULL)',
          )
          .bind(id, proof.accountId),
      ]);
      return results[0].results.length > 0;
    } catch {
      return null;
    }
  }

  /** Scheduled cleanup of expired, unauthenticated or ended rows. Bounded per run. */
  async cleanup(): Promise<void> {
    const now = this.now();
    await this.db.batch([
      this.db
        .prepare(
          'DELETE FROM agent_oauth_requests WHERE request_hash IN (SELECT request_hash FROM agent_oauth_requests WHERE expires_at_ms<=? LIMIT 500)',
        )
        .bind(now),
      this.db
        .prepare(
          'DELETE FROM agent_tokens WHERE token_hash IN (SELECT token_hash FROM agent_tokens WHERE expires_at_ms<=? OR (used_at_ms IS NOT NULL AND used_at_ms<=?) LIMIT 500)',
        )
        .bind(now, now - DAY_MS),
      this.db
        .prepare(
          'DELETE FROM agent_grants WHERE id IN (SELECT id FROM agent_grants WHERE expires_at_ms<=? OR (revoked_at_ms IS NOT NULL AND revoked_at_ms<=?) LIMIT 200)',
        )
        .bind(now - 30 * DAY_MS, now - 30 * DAY_MS),
      this.db
        .prepare(
          'DELETE FROM agent_oauth_clients WHERE client_id IN (SELECT c.client_id FROM agent_oauth_clients c WHERE c.created_at_ms<=? AND NOT EXISTS(SELECT 1 FROM agent_grants g WHERE g.client_id=c.client_id) LIMIT 500)',
        )
        .bind(now - DAY_MS),
    ]);
  }
}
