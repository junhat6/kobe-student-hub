import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { mediaId, MEDIA_MAX_BYTES } from '../src/shared/media';
/** Separate operator projection; owner-private and anonymous media endpoints never fall back to it. */
export class ModerationMediaStore {
  private sessions: SessionStore;
  private operators: readonly string[];
  constructor(
    private db: D1Database,
    origin: string,
    operatorIds: readonly string[] = [],
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
    this.operators =
      Array.isArray(operatorIds) &&
      operatorIds.length <= 10 &&
      operatorIds.every((v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))
        ? Object.freeze([...operatorIds])
        : [];
  }
  async read(req: Request, kind: unknown, target: string, id: string) {
    if (
      req.method !== 'GET' ||
      (kind !== 'articles' && kind !== 'projects') ||
      !mediaId(target) ||
      !mediaId(id)
    )
      return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p || !this.operators.includes(p.accountId)) return null;
      const relation =
        kind === 'articles'
          ? `EXISTS(SELECT 1 FROM article_publication_media map JOIN article_publications publication ON publication.content_id=map.content_id JOIN content c ON c.id=publication.content_id AND c.author_id=publication.public_profile_id WHERE map.media_id=media_assets.id AND c.id=? AND c.kind='article' AND c.is_sample=0 AND c.status IN ('published','hidden','deleted') AND EXISTS(SELECT 1 FROM article_reports WHERE content_id=c.id))`
          : `EXISTS(SELECT 1 FROM project_publication_media map JOIN project_publications publication ON publication.id=map.project_id WHERE map.media_id=media_assets.id AND publication.id=? AND publication.status IN ('published','hidden','deleted') AND EXISTS(SELECT 1 FROM project_reports WHERE project_id=publication.id))`;
      const row = await this.db
        .prepare(`SELECT mime,payload FROM media_assets WHERE id=? AND ${relation} AND ${live}`)
        .bind(id, target, ...binds(p))
        .first<{ mime: string; payload: number[] }>();
      if (
        !row ||
        !['image/png', 'image/jpeg'].includes(row.mime) ||
        !Array.isArray(row.payload) ||
        !row.payload.length ||
        row.payload.length > MEDIA_MAX_BYTES ||
        row.payload.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
      )
        return null;
      return { mime: row.mime, bytes: Uint8Array.from(row.payload) };
    } catch {
      return null;
    }
  }
}
