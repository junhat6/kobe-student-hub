import {
  liveStudentSessionSql as writer,
  liveStudentSessionBindings as writerBinds,
} from './auth/student-participation';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { SessionStore } from './auth/sessions';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_EDGE,
  AVATAR_MIN_EDGE,
  avatarVersion,
  publicAvatarPath,
} from '../src/shared/avatar';

const slug = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
type Image = { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array<ArrayBuffer> };
type Row = { mime: string; payload: unknown; sha256: string };
/** Same anonymous eligibility as /api/students: a non-sample profile owned by an active
 * account with at least one published article or project. Hidden profiles serve nothing. */
const publicAvatarVisible = `a.public_profile_id=p.id AND p.is_sample=0 AND EXISTS(SELECT 1 FROM account_public_profiles m JOIN private_accounts owner ON owner.id=m.owner_account_id AND owner.status='active' WHERE m.public_profile_id=p.id) AND NOT EXISTS(SELECT 1 FROM private_accounts identity WHERE identity.id=p.id OR identity.google_subject=p.id) AND (EXISTS(SELECT 1 FROM content c WHERE c.author_id=p.id AND c.kind='article' AND c.status='published' AND c.is_sample=0) OR EXISTS(SELECT 1 FROM project_publications r WHERE r.public_profile_id=p.id AND r.status='published'))`;
function decoded(r: Row | null, version: string): Image | null {
  if (
    !r ||
    (r.mime !== 'image/png' && r.mime !== 'image/jpeg') ||
    !sha(r.sha256) ||
    r.sha256.slice(0, 16) !== version ||
    !Array.isArray(r.payload) ||
    r.payload.length < 1 ||
    r.payload.length > AVATAR_MAX_BYTES ||
    r.payload.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return null;
  return { mime: r.mime, bytes: Uint8Array.from(r.payload as number[]) };
}
async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}

/** The owner's single profile icon. Ownership comes only from the session's account mapping. */
export class ProfileAvatarStore {
  private readonly sessions: SessionStore;
  constructor(
    private readonly db: D1Database,
    origin: string,
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  /** The own icon version, or null when none. Null result = no profile or no live session. */
  async own(request: Request): Promise<{ avatar: string | null } | null> {
    if (request.method !== 'GET') return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      const r = await this.db
        .prepare(
          `SELECT m.public_profile_id profile_id,a.sha256 FROM (SELECT 1 WHERE ${live}) auth JOIN account_public_profiles m ON m.owner_account_id=? JOIN public_profiles p ON p.id=m.public_profile_id AND p.is_sample=0 LEFT JOIN profile_avatars a ON a.public_profile_id=m.public_profile_id`,
        )
        .bind(...binds(p), p.accountId)
        .first<{ profile_id: string; sha256: string | null }>();
      if (!r || !slug(r.profile_id) || (r.sha256 !== null && !sha(r.sha256))) return null;
      return { avatar: r.sha256 === null ? null : r.sha256.slice(0, 16) };
    } catch {
      return null;
    }
  }
  /** Checked before the worker spends CPU decoding attacker bytes. */
  async authorizeUpload(request: Request): Promise<boolean> {
    if (request.method !== 'PUT') return false;
    try {
      const p = await this.sessions.storageAuthorization(request);
      return (
        !!p &&
        !!(await this.db
          .prepare(
            `SELECT 1 FROM account_public_profiles m JOIN public_profiles p ON p.id=m.public_profile_id AND p.is_sample=0 WHERE m.owner_account_id=? AND ${writer}`,
          )
          .bind(p.accountId, ...writerBinds(p))
          .first())
      );
    } catch {
      return false;
    }
  }
  async replace(
    request: Request,
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ avatar: string } | null> {
    if (!(await this.authorizeUpload(request))) return null;
    try {
      const { normalizeMedia } = await import('./media-codec');
      const value = await normalizeMedia(bytes, mime);
      if (
        !value ||
        value.width !== value.height ||
        value.width < AVATAR_MIN_EDGE ||
        value.width > AVATAR_MAX_EDGE ||
        value.bytes.length > AVATAR_MAX_BYTES
      )
        return null;
      const hash = await digest(value.bytes);
      const p = await this.sessions.storageAuthorization(request);
      if (!p || p.nowMs > 253402300799999) return null;
      const r = await this.db
        .prepare(
          `INSERT INTO profile_avatars(public_profile_id,mime,width,height,payload,sha256,updated_at_ms) SELECT m.public_profile_id,?,?,?,?,?,? FROM account_public_profiles m JOIN public_profiles p ON p.id=m.public_profile_id AND p.is_sample=0 WHERE m.owner_account_id=? AND ${writer} ON CONFLICT(public_profile_id) DO UPDATE SET mime=excluded.mime,width=excluded.width,height=excluded.height,payload=excluded.payload,sha256=excluded.sha256,updated_at_ms=excluded.updated_at_ms WHERE excluded.updated_at_ms>=profile_avatars.updated_at_ms RETURNING sha256`,
        )
        .bind(
          value.mime,
          value.width,
          value.height,
          value.bytes,
          hash,
          p.nowMs,
          p.accountId,
          ...writerBinds(p),
        )
        .first<{ sha256: string }>();
      return r?.sha256 === hash ? { avatar: hash.slice(0, 16) } : null;
    } catch {
      return null;
    }
  }
  /** Removing one's own icon needs a live session only, so a graduate can still take it down. */
  async remove(request: Request): Promise<boolean> {
    if (request.method !== 'DELETE') return false;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return false;
      const [, after] = await this.db.batch([
        this.db
          .prepare(
            `DELETE FROM profile_avatars WHERE public_profile_id=(SELECT m.public_profile_id FROM account_public_profiles m WHERE m.owner_account_id=?) AND ${live}`,
          )
          .bind(p.accountId, ...binds(p)),
        // Success means "the owner now has no icon", which is also true for a repeated delete.
        this.db
          .prepare(
            `SELECT 1 ok FROM account_public_profiles m WHERE m.owner_account_id=? AND NOT EXISTS(SELECT 1 FROM profile_avatars a WHERE a.public_profile_id=m.public_profile_id) AND ${live}`,
          )
          .bind(p.accountId, ...binds(p)),
      ]);
      return after.results.length === 1;
    } catch {
      return false;
    }
  }
  async readOwn(request: Request, version: string): Promise<Image | null> {
    if (request.method !== 'GET' || !avatarVersion(version)) return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      const r = await this.db
        .prepare(
          `SELECT a.mime,a.payload,a.sha256 FROM account_public_profiles m JOIN profile_avatars a ON a.public_profile_id=m.public_profile_id WHERE m.owner_account_id=? AND substr(a.sha256,1,16)=? AND ${live}`,
        )
        .bind(p.accountId, version, ...binds(p))
        .first<Row>();
      return decoded(r, version);
    } catch {
      return null;
    }
  }
  async readPublic(id: string, version: string): Promise<Image | null> {
    if (!slug(id) || !avatarVersion(version)) return null;
    try {
      const r = await this.db
        .prepare(
          `SELECT a.mime,a.payload,a.sha256 FROM profile_avatars a JOIN public_profiles p ON ${publicAvatarVisible} WHERE a.public_profile_id=? AND substr(a.sha256,1,16)=?`,
        )
        .bind(id, version)
        .first<Row>();
      return decoded(r, version);
    } catch {
      return null;
    }
  }
  /** Public projection for /api/students: the versioned path only, never account data. */
  async readPublicPath(id: string): Promise<string | null> {
    if (!slug(id)) return null;
    const r = await this.db
      .prepare(
        `SELECT a.sha256 FROM profile_avatars a JOIN public_profiles p ON ${publicAvatarVisible} WHERE a.public_profile_id=?`,
      )
      .bind(id)
      .first<{ sha256: string }>();
    return r && sha(r.sha256) ? publicAvatarPath(id, r.sha256.slice(0, 16)) : null;
  }
}
