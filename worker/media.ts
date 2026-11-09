import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import {
  liveStudentSessionSql as writer,
  liveStudentSessionBindings as writerBinds,
} from './auth/student-participation';
import { mediaId, type MediaReceipt } from '../src/shared/media';

type Kind = 'articles' | 'projects';
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
type Row = {
  id: string;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  payload?: number[];
};
const receipt = (r: Row): MediaReceipt => ({
  id: r.id,
  mime: r.mime,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
});
const info = 'id,mime,width,height,length(payload) bytes';
const table = (kind: Kind) => (kind === 'articles' ? 'private_article_drafts' : 'project_drafts');
const link = (kind: Kind) => (kind === 'articles' ? 'article_draft_id' : 'project_draft_id');
const body = (kind: Kind) => (kind === 'articles' ? 'body' : 'description');
const unpublished = `NOT EXISTS(SELECT 1 FROM article_publication_revisions revision,json_each(revision.media_ids_json) ref WHERE ref.value=media_assets.id) AND NOT EXISTS(SELECT 1 FROM article_publication_media WHERE media_id=media_assets.id) AND NOT EXISTS(SELECT 1 FROM project_publication_media WHERE media_id=media_assets.id)`;
const unreferenced = `NOT EXISTS(SELECT 1 FROM private_article_drafts d WHERE d.id=media_assets.article_draft_id AND instr(d.body,'/api/media/'||media_assets.id)>0) AND NOT EXISTS(SELECT 1 FROM project_drafts d WHERE d.id=media_assets.project_draft_id AND instr(d.description,'/api/media/'||media_assets.id)>0)`;
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
  ): Promise<MediaReceipt | null> {
    if (!mediaId(id) || !(await this.authorizeUpload(request, kind, draftId, version))) return null;
    try {
      const { normalizeMedia } = await import('./media-codec');
      const value = await normalizeMedia(bytes, mime);
      if (!value) return null;
      const sha = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', value.bytes)),
        (v) => v.toString(16).padStart(2, '0'),
      ).join('');
      const p = await this.proof(request);
      if (!p || p.nowMs > 253402300799999) return null;
      // Cleanup is bounded, only touches old unreferenced/private orphans, and never erases a snapshot.
      await this.cleanup(p);
      await this.db
        .prepare(
          `INSERT INTO media_assets(id,owner_account_id,article_draft_id,project_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT ?,?,?,?,?,?,?,?,?,? FROM ${table(kind)} d WHERE d.id=? AND d.owner_account_id=? AND d.version=? AND d.updated_at_ms<=? AND ${writer} AND NOT EXISTS(SELECT 1 FROM media_assets WHERE id=?)`,
        )
        .bind(
          id,
          p.accountId,
          kind === 'articles' ? draftId : null,
          kind === 'projects' ? draftId : null,
          value.mime,
          value.width,
          value.height,
          value.bytes,
          sha,
          p.nowMs,
          draftId,
          p.accountId,
          version,
          p.nowMs,
          ...writerBinds(p),
          id,
        )
        .run();
      const r = await this.db
        .prepare(
          `SELECT ${info} FROM media_assets WHERE id=? AND owner_account_id=? AND ${link(kind)}=? AND sha256=? AND mime=? AND ${writer}`,
        )
        .bind(id, p.accountId, draftId, sha, mime, ...writerBinds(p))
        .first<Row>();
      return r ? receipt(r) : null;
    } catch {
      return null;
    }
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
          `SELECT ${info} FROM media_assets WHERE ${link(kind)}=? AND owner_account_id=? AND ${live} ORDER BY created_at_ms,id LIMIT 8`,
        )
        .bind(id, p.accountId, ...binds(p))
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
        .prepare(
          `SELECT ${info},payload FROM media_assets WHERE id=? AND owner_account_id=? AND ${live}`,
        )
        .bind(id, p.accountId, ...binds(p))
        .first<Row>();
      return r ? this.decoded(r) : null;
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
        .prepare(
          `SELECT ${info},payload FROM media_assets WHERE id=? AND (EXISTS(SELECT 1 FROM article_publication_revisions revision JOIN json_each(revision.media_ids_json) map JOIN article_publications publication ON publication.content_id=revision.content_id JOIN content c ON c.id=publication.content_id AND c.author_id=publication.public_profile_id WHERE map.value=media_assets.id AND revision.revision=(SELECT MAX(current.revision) FROM article_publication_revisions current WHERE current.content_id=publication.content_id) AND c.kind='article' AND c.is_sample=0 AND c.status='published' AND NOT EXISTS(SELECT 1 FROM article_publication_stops WHERE content_id=c.id)) OR EXISTS(SELECT 1 FROM project_publication_media map JOIN project_publications publication ON publication.id=map.project_id WHERE map.media_id=media_assets.id AND publication.status='published' AND NOT EXISTS(SELECT 1 FROM project_publication_stops WHERE project_id=publication.id)))`,
        )
        .bind(id)
        .first<Row>();
      return r ? this.decoded(r) : null;
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
      return !!(await this.db
        .prepare(
          `DELETE FROM media_assets WHERE id=? AND owner_account_id=? AND ${unpublished} AND ${unreferenced} AND ${live} RETURNING id`,
        )
        .bind(id, p.accountId, ...binds(p))
        .first());
    } catch {
      return false;
    }
  }
  private async cleanup(p: Proof) {
    await this.db
      .prepare(
        `DELETE FROM media_assets WHERE id IN(SELECT id FROM media_assets WHERE owner_account_id=? AND created_at_ms<? AND ${unpublished} AND ${unreferenced} ORDER BY created_at_ms,id LIMIT 20) AND ${writer}`,
      )
      .bind(p.accountId, p.nowMs - 86400000, ...writerBinds(p))
      .run();
  }
}
