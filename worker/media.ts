import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import {
  liveStudentSessionSql as writer,
  liveStudentSessionBindings as writerBinds,
} from './auth/student-participation';
import {
  mediaId,
  MEDIA_GLOBAL_BYTES,
  MEDIA_GLOBAL_COUNT,
  MEDIA_OWNER_BYTES,
  MEDIA_OWNER_COUNT,
  MEDIA_PER_DRAFT,
  type MediaLimit,
  type MediaReceipt,
} from '../src/shared/media';
import { deleteMediaObjects, getMediaObject, putMediaObject, sha256Hex } from './media-objects';

type Kind = 'articles' | 'projects';
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
type Row = {
  id: string;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  payload?: number[];
};
const receipt = (r: Row): MediaReceipt => ({
  id: r.id,
  mime: r.mime,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
});
// The size column (#260) stays correct after the contract of #12 empties payload; the fallback only
// covers a row the 0039 fill trigger has not reached, which cannot exist once 0039 is applied.
// Quotas sum the column from the covering index media_bytes: read from the table, the column sits
// after the payload BLOB and every row would walk its overflow pages.
const sizeSql = 'COALESCE(bytes,length(payload))';
const info = `id,mime,width,height,${sizeSql} bytes,sha256`;
const table = (kind: Kind) => (kind === 'articles' ? 'private_article_drafts' : 'project_drafts');
const link = (kind: Kind) => (kind === 'articles' ? 'article_draft_id' : 'project_draft_id');
const body = (kind: Kind) => (kind === 'articles' ? 'body' : 'description');
const unpublished = `NOT EXISTS(SELECT 1 FROM article_publication_revisions revision,json_each(revision.media_ids_json) ref WHERE ref.value=media_assets.id) AND NOT EXISTS(SELECT 1 FROM article_publication_media WHERE media_id=media_assets.id) AND NOT EXISTS(SELECT 1 FROM project_publication_media WHERE media_id=media_assets.id)`;
const unreferenced = `NOT EXISTS(SELECT 1 FROM private_article_drafts d WHERE d.id=media_assets.article_draft_id AND instr(d.body,'/api/media/'||media_assets.id)>0) AND NOT EXISTS(SELECT 1 FROM project_drafts d WHERE d.id=media_assets.project_draft_id AND instr(d.description,'/api/media/'||media_assets.id)>0)`;
/** A current, unstopped publication grants anonymous reads. Checked on every read, including the D1 fallback. */
const publicGrant = `(EXISTS(SELECT 1 FROM article_publication_revisions revision JOIN json_each(revision.media_ids_json) map JOIN article_publications publication ON publication.content_id=revision.content_id JOIN content c ON c.id=publication.content_id AND c.author_id=publication.public_profile_id WHERE map.value=media_assets.id AND revision.revision=(SELECT MAX(current.revision) FROM article_publication_revisions current WHERE current.content_id=publication.content_id) AND c.kind='article' AND c.is_sample=0 AND c.status='published' AND NOT EXISTS(SELECT 1 FROM article_publication_stops WHERE content_id=c.id)) OR EXISTS(SELECT 1 FROM project_publication_media map JOIN project_publications publication ON publication.id=map.project_id WHERE map.media_id=media_assets.id AND publication.status='published' AND NOT EXISTS(SELECT 1 FROM project_publication_stops WHERE project_id=publication.id)))`;
/** Codec setup is shared; request bytes and identity are never cached in application state. */
export const warmMediaCodec = () =>
  import('./media-codec').then(
    (module) => module.warmMediaCodec(),
    () => false,
  );

export class MediaStore {
  private readonly sessions: SessionStore;
  constructor(
    private readonly db: D1Database,
    origin: string,
    private readonly clock: () => number = Date.now,
    /** Optional private R2 bucket. Absent: bytes stay in D1 only (local preview, older config). */
    private readonly bucket?: R2Bucket,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  private async proof(request: Request) {
    return this.sessions.storageAuthorization(request);
  }
  /** Authorization and current enrollment are checked before spending CPU on attacker bytes. */
  async authorizeUpload(
    request: Request,
    kind: Kind,
    draftId: string,
    version: number,
  ): Promise<boolean> {
    if (
      request.method !== 'PUT' ||
      !mediaId(draftId) ||
      !Number.isSafeInteger(version) ||
      version < 1
    )
      return false;
    try {
      const p = await this.proof(request);
      return (
        !!p &&
        !!(await this.db
          .prepare(
            `SELECT 1 FROM ${table(kind)} WHERE id=? AND owner_account_id=? AND version=? AND updated_at_ms<=? AND ${writer}`,
          )
          .bind(draftId, p.accountId, version, p.nowMs, ...writerBinds(p))
          .first())
      );
    } catch {
      return false;
    }
  }
  async upload(
    request: Request,
    kind: Kind,
    draftId: string,
    id: string,
    version: number,
    bytes: Uint8Array,
    mime: string,
  ): Promise<MediaReceipt | MediaLimit | null> {
    if (!mediaId(id) || !(await this.authorizeUpload(request, kind, draftId, version))) return null;
    try {
      const { normalizeMedia } = await import('./media-codec');
      const value = await normalizeMedia(bytes, mime);
      if (!value) return null;
      const sha = await sha256Hex(value.bytes);
      const p = await this.proof(request);
      if (!p || p.nowMs > 253402300799999) return null;
      // Cleanup is bounded, only touches old unreferenced/private orphans, and never erases a snapshot.
      await this.cleanup(p);
      // Checked before R2 so a full draft costs no object write. The trigger stays authoritative.
      const full = await this.limit(p, kind, draftId, id, value.bytes.length);
      if (full) return full;
      let r: Row | null = null;
      try {
        // R2 first: if it refuses the bytes or stores another size, no D1 row is created. If the D1
        // insert then fails, the object is left to the scheduled sweep, which removes objects without
        // a row only after a grace period. Removing it here would race a resend of the same id and
        // bytes: the key is the same, so the resend's row could land after this delete and point at
        // nothing (#12). Without a row the object is never reachable: every read starts in D1. The
        // key holds the sha256, so a repeated or colliding upload never replaces other bytes. With a bucket the row holds no payload (#12 contract): the size
        // column is the normalized length R2 confirmed, and reads match the object against it.
        if (this.bucket)
          await putMediaObject(this.bucket, { id, sha256: sha }, value.bytes, value.mime);
        await this.db
          .prepare(
            `INSERT INTO media_assets(id,owner_account_id,article_draft_id,project_draft_id,mime,width,height,payload,bytes,sha256,created_at_ms,object_stored_at_ms) SELECT ?,?,?,?,?,?,?,?,?,?,?,? FROM ${table(kind)} d WHERE d.id=? AND d.owner_account_id=? AND d.version=? AND d.updated_at_ms<=? AND ${writer} AND NOT EXISTS(SELECT 1 FROM media_assets WHERE id=?)`,
          )
          .bind(
            id,
            p.accountId,
            kind === 'articles' ? draftId : null,
            kind === 'projects' ? draftId : null,
            value.mime,
            value.width,
            value.height,
            this.bucket ? null : value.bytes,
            value.bytes.length,
            sha,
            p.nowMs,
            this.bucket ? p.nowMs : null,
            draftId,
            p.accountId,
            version,
            p.nowMs,
            ...writerBinds(p),
            id,
          )
          .run();
        r = await this.db
          .prepare(
            `SELECT ${info} FROM media_assets WHERE id=? AND owner_account_id=? AND ${link(kind)}=? AND sha256=? AND mime=? AND ${writer}`,
          )
          .bind(id, p.accountId, draftId, sha, mime, ...writerBinds(p))
          .first<Row>();
      } catch (error) {
        // A concurrent upload can fill the last slot between the check and the insert.
        const raced = await this.limit(p, kind, draftId, id, value.bytes.length);
        if (raced) return raced;
        throw error;
      }
      return r ? receipt(r) : null;
    } catch {
      return null;
    }
  }
  /**
   * The same limits as the media_assets_insert trigger, named so the owner knows what to change.
   * A resend of an existing id is not a new image; it falls through to the idempotent receipt.
   */
  private async limit(p: Proof, kind: Kind, draftId: string, id: string, size: number) {
    const row = await this.db
      .prepare(
        `SELECT CASE WHEN EXISTS(SELECT 1 FROM media_assets WHERE id=?) THEN NULL WHEN (SELECT COUNT(*) FROM media_assets WHERE ${link(kind)}=?)>=? THEN 'draft' WHEN (SELECT COUNT(*) FROM media_assets WHERE owner_account_id=?)>=? OR (SELECT COALESCE(SUM(bytes),0) FROM media_assets INDEXED BY media_bytes WHERE owner_account_id=?)+?>? THEN 'owner' WHEN (SELECT COUNT(*) FROM media_assets)>=? OR (SELECT COALESCE(SUM(bytes),0) FROM media_assets INDEXED BY media_bytes)+?>? THEN 'site' END reason WHERE ${writer}`,
      )
      .bind(
        id,
        draftId,
        MEDIA_PER_DRAFT,
        p.accountId,
        MEDIA_OWNER_COUNT,
        p.accountId,
        size,
        MEDIA_OWNER_BYTES,
        MEDIA_GLOBAL_COUNT,
        size,
        MEDIA_GLOBAL_BYTES,
        ...writerBinds(p),
      )
      .first<{ reason: MediaLimit | null }>();
    return row?.reason ?? null;
  }
  async list(request: Request, kind: Kind, id: string): Promise<MediaReceipt[] | null> {
    if (request.method !== 'GET' || !mediaId(id)) return null;
    try {
      const p = await this.proof(request);
      if (!p) return null;
      const authorized = await this.db
        .prepare(`SELECT 1 FROM ${table(kind)} WHERE id=? AND owner_account_id=? AND ${live}`)
        .bind(id, p.accountId, ...binds(p))
        .first();
      if (!authorized) return null;
      const rows = await this.db
        .prepare(
          `SELECT ${info} FROM media_assets WHERE ${link(kind)}=? AND owner_account_id=? AND ${live} ORDER BY created_at_ms,id LIMIT ?`,
        )
        .bind(id, p.accountId, ...binds(p), MEDIA_PER_DRAFT)
        .all<Row>();
      return rows.results.map(receipt);
    } catch {
      return null;
    }
  }
  async readOwn(
    request: Request,
    id: string,
  ): Promise<{ receipt: MediaReceipt; bytes: Uint8Array<ArrayBuffer> } | null> {
    if (request.method !== 'GET' || !mediaId(id)) return null;
    try {
      const p = await this.proof(request);
      if (!p) return null;
      const r = await this.db
        .prepare(`SELECT ${info} FROM media_assets WHERE id=? AND owner_account_id=? AND ${live}`)
        .bind(id, p.accountId, ...binds(p))
        .first<Row>();
      if (!r) return null;
      const stored = await getMediaObject(this.bucket, r);
      if (stored) return { receipt: receipt(r), bytes: stored };
      // D1 fallback (expand stage) re-checks the same authorization with the bytes.
      const full = await this.db
        .prepare(
          `SELECT ${info},payload FROM media_assets WHERE id=? AND owner_account_id=? AND ${live}`,
        )
        .bind(id, p.accountId, ...binds(p))
        .first<Row>();
      return full ? this.decoded(full) : null;
    } catch {
      return null;
    }
  }
  async readPublic(
    id: string,
  ): Promise<{ receipt: MediaReceipt; bytes: Uint8Array<ArrayBuffer> } | null> {
    if (!mediaId(id)) return null;
    try {
      const r = await this.db
        .prepare(`SELECT ${info} FROM media_assets WHERE id=? AND ${publicGrant}`)
        .bind(id)
        .first<Row>();
      if (!r) return null;
      const stored = await getMediaObject(this.bucket, r);
      if (stored) return { receipt: receipt(r), bytes: stored };
      const full = await this.db
        .prepare(`SELECT ${info},payload FROM media_assets WHERE id=? AND ${publicGrant}`)
        .bind(id)
        .first<Row>();
      return full ? this.decoded(full) : null;
    } catch {
      return null;
    }
  }
  private decoded(r: Row) {
    if (
      !Array.isArray(r.payload) ||
      r.payload.length !== r.bytes ||
      r.bytes < 1 ||
      r.bytes > 524288 ||
      r.payload.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    )
      return null;
    return { receipt: receipt(r), bytes: Uint8Array.from(r.payload) };
  }
  async remove(request: Request, id: string): Promise<boolean> {
    if (request.method !== 'DELETE' || !mediaId(id)) return false;
    try {
      const p = await this.proof(request);
      if (!p) return false;
      const deleted = await this.db
        .prepare(
          `DELETE FROM media_assets WHERE id=? AND owner_account_id=? AND ${unpublished} AND ${unreferenced} AND ${live} RETURNING id,sha256`,
        )
        .bind(id, p.accountId, ...binds(p))
        .first<{ id: string; sha256: string }>();
      if (deleted) await deleteMediaObjects(this.bucket, [deleted]);
      return !!deleted;
    } catch {
      return false;
    }
  }
  private async cleanup(p: Proof) {
    const deleted = await this.db
      .prepare(
        `DELETE FROM media_assets WHERE id IN(SELECT id FROM media_assets WHERE owner_account_id=? AND created_at_ms<? AND ${unpublished} AND ${unreferenced} ORDER BY created_at_ms,id LIMIT 20) AND ${writer} RETURNING id,sha256`,
      )
      .bind(p.accountId, p.nowMs - 86400000, ...writerBinds(p))
      .all<{ id: string; sha256: string }>();
    await deleteMediaObjects(this.bucket, deleted.results);
  }
}
