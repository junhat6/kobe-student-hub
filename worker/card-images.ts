import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import {
  liveStudentSessionSql as writer,
  liveStudentSessionBindings as writerBinds,
} from './auth/student-participation';
import { canonicalOrigin, readBoundedJson } from './http-boundary';
import { publicMediaGrantSql } from './media';
import { mediaId, publicMediaPath } from '../src/shared/media';
import { validCardImageChoice, type CardImageChoice } from '../src/shared/card-image';

type Kind = 'articles' | 'projects';
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
const drafts = (kind: Kind) => (kind === 'articles' ? 'private_article_drafts' : 'project_drafts');
const choices = (kind: Kind) =>
  kind === 'articles' ? 'article_card_images' : 'project_card_images';
const link = (kind: Kind) => (kind === 'articles' ? 'article_draft_id' : 'project_draft_id');
/** Far above any one list (home 20+6, search 20, related 4+3+3); keeps every IN list bounded. */
export const CARD_IMAGE_LOOKUP_LIMIT = 40;
/** The owner's pick, only while it is one of the current public version's images. */
const articleChoiceSql = `(SELECT ci.media_id FROM article_publications pub JOIN article_card_images ci ON ci.draft_id=pub.draft_id AND ci.owner_account_id=pub.owner_account_id WHERE pub.content_id=rev.content_id AND EXISTS(SELECT 1 FROM json_each(rev.media_ids_json) ref WHERE ref.value=ci.media_id))`;
const projectChoiceSql = `(SELECT ci.media_id FROM project_card_images ci JOIN project_publication_media map ON map.project_id=r.id AND map.media_id=ci.media_id WHERE ci.draft_id=r.draft_id AND ci.owner_account_id=r.owner_account_id)`;
export type ChooseResult = 'ok' | 'unauthorized' | 'missing' | 'invalid' | 'not_enrolled';

/**
 * The picture on a public card (#311, C26 condition 5). The owner picks one of the images already
 * attached to the draft; the card shows it only while it is in the publication's current public
 * images, otherwise the first public image in the body (a project: in the description). No image:
 * no `image`, and the card draws its own picture (#310). Every chosen path is re-checked with the
 * same grant the public media route uses, so a stopped or hidden publication yields no path.
 */
export class CardImageStore {
  private readonly sessions: SessionStore;
  constructor(
    private readonly db: D1Database,
    origin: string,
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  private async proof(request: Request) {
    return this.sessions.storageAuthorization(request);
  }
  /** The owner's current choice. Null when the draft is not the live owner's. */
  async read(request: Request, kind: Kind, draftId: string): Promise<CardImageChoice | null> {
    if (request.method !== 'GET' || !mediaId(draftId)) return null;
    const p = await this.proof(request);
    if (!p) return null;
    const row = await this.db
      .prepare(
        `SELECT d.id,ci.media_id FROM ${drafts(kind)} d LEFT JOIN ${choices(kind)} ci ON ci.draft_id=d.id AND ci.owner_account_id=d.owner_account_id WHERE d.id=? AND d.owner_account_id=? AND ${live}`,
      )
      .bind(draftId, p.accountId, ...binds(p))
      .first<{ id: string; media_id: string | null }>();
    if (!row) return null;
    return { mediaId: mediaId(row.media_id) ? row.media_id : null };
  }
  /**
   * Picks one attached image, or returns to the default (null). The draft and session are checked
   * before the body is read. Picking is participation (enrollment period); going back to the
   * default is cleanup and stays available after it.
   */
  async choose(
    request: Request,
    kind: Kind,
    draftId: string,
    body: () => Promise<unknown>,
  ): Promise<ChooseResult> {
    if (request.method !== 'PUT' || !mediaId(draftId)) return 'missing';
    const p = await this.proof(request);
    if (!p) return 'unauthorized';
    const owned = await this.db
      .prepare(`SELECT 1 FROM ${drafts(kind)} WHERE id=? AND owner_account_id=? AND ${live}`)
      .bind(draftId, p.accountId, ...binds(p))
      .first();
    if (!owned) return 'missing';
    const value = await body();
    if (!validCardImageChoice(value)) return 'invalid';
    if (value.mediaId !== null) {
      const written = await this.db
        .prepare(
          `INSERT INTO ${choices(kind)}(draft_id,owner_account_id,media_id,updated_at_ms) SELECT d.id,d.owner_account_id,m.id,? FROM ${drafts(kind)} d JOIN media_assets m ON m.id=? AND m.owner_account_id=d.owner_account_id AND m.${link(kind)}=d.id WHERE d.id=? AND d.owner_account_id=? AND ${writer} ON CONFLICT(draft_id) DO UPDATE SET media_id=excluded.media_id,updated_at_ms=excluded.updated_at_ms`,
        )
        .bind(p.nowMs, value.mediaId, draftId, p.accountId, ...writerBinds(p))
        .run();
      if (written.meta.changes === 1) return 'ok';
      return (await this.attached(p, kind, draftId, value.mediaId)) ? 'not_enrolled' : 'invalid';
    }
    await this.db
      .prepare(
        `DELETE FROM ${choices(kind)} WHERE draft_id=? AND owner_account_id=? AND EXISTS(SELECT 1 FROM ${drafts(kind)} d WHERE d.id=? AND d.owner_account_id=?) AND ${live}`,
      )
      .bind(draftId, p.accountId, draftId, p.accountId, ...binds(p))
      .run();
    return 'ok';
  }
  /** Whether a refused pick named the owner's own attached image (then only enrollment refused it). */
  private async attached(p: Proof, kind: Kind, draftId: string, id: string) {
    return !!(await this.db
      .prepare(
        `SELECT 1 FROM media_assets WHERE id=? AND owner_account_id=? AND ${link(kind)}=? AND ${live}`,
      )
      .bind(id, p.accountId, draftId, ...binds(p))
      .first());
  }
  /**
   * Public card picture paths for published articles and projects, keyed by their id. Anonymous:
   * no draft id, account or choice leaves this method, only `/api/media/<id>` of a public image.
   * Before migration 0053 reaches a database (an older schema) the default image is still found.
   */
  async readPublicPaths(articleIds: string[], projectIds: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const articles = [...new Set(articleIds.filter(mediaId))].slice(0, CARD_IMAGE_LOOKUP_LIMIT);
    const projects = [...new Set(projectIds.filter(mediaId))].slice(0, CARD_IMAGE_LOOKUP_LIMIT);
    if (!articles.length && !projects.length) return found;
    let rows: { id: string; media: string | null }[] = [];
    for (const chosen of [true, false]) {
      try {
        const [a, r] = await this.db.batch<{ id: string; media: string | null }>([
          this.db
            .prepare(
              `SELECT rev.content_id id,COALESCE(${chosen ? articleChoiceSql : 'NULL'},(SELECT ref.value FROM json_each(rev.media_ids_json) ref WHERE instr(rev.body,'/api/media/'||ref.value)>0 ORDER BY instr(rev.body,'/api/media/'||ref.value),ref.value LIMIT 1)) media FROM article_publication_revisions rev WHERE rev.content_id IN (SELECT value FROM json_each(?)) AND rev.revision=(SELECT MAX(cur.revision) FROM article_publication_revisions cur WHERE cur.content_id=rev.content_id)`,
            )
            .bind(JSON.stringify(articles)),
          this.db
            .prepare(
              `SELECT r.id,COALESCE(${chosen ? projectChoiceSql : 'NULL'},(SELECT map.media_id FROM project_publication_media map WHERE map.project_id=r.id AND instr(r.description,'/api/media/'||map.media_id)>0 ORDER BY instr(r.description,'/api/media/'||map.media_id),map.media_id LIMIT 1)) media FROM project_publications r WHERE r.id IN (SELECT value FROM json_each(?))`,
            )
            .bind(JSON.stringify(projects)),
        ]);
        rows = [...a.results, ...r.results];
        break;
      } catch {
        if (!chosen) return found;
      }
    }
    const candidates = rows.filter((row) => mediaId(row.id) && mediaId(row.media));
    if (!candidates.length) return found;
    // Pictures are supplementary: a failed check leaves every card without one, never fails the list.
    const granted = await this.db
      .prepare(
        `SELECT id FROM media_assets WHERE id IN (SELECT value FROM json_each(?)) AND ${publicMediaGrantSql}`,
      )
      .bind(JSON.stringify([...new Set(candidates.map((row) => row.media))]))
      .all<{ id: string }>()
      .catch(() => ({ results: [] as { id: string }[] }));
    const open = new Set(granted.results.map((row) => row.id));
    for (const row of candidates)
      if (open.has(row.media!)) found.set(row.id, publicMediaPath(row.media!));
    return found;
  }
}

const PRIVATE_PATH = /^\/api\/private\/card-images\/(articles|projects)\/([0-9a-f-]{36})$/;
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });

/** The owner's card picture choice: GET reads it, PUT `{ mediaId: <attached id> | null }` sets it. */
export function createCardImageHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const store = new CardImageStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/private/card-images')) return null;
    if (!canonicalOrigin(origin)) return json({ error: 'card_image_unavailable' }, 503);
    const match = PRIVATE_PATH.exec(url.pathname);
    if (!match || !mediaId(match[2]) || url.search || url.hash)
      return json({ error: 'card_image_unavailable' }, 404);
    if (request.method !== 'GET' && request.method !== 'PUT') {
      const response = json({ error: 'method_not_allowed' }, 405);
      response.headers.set('Allow', 'GET, PUT');
      return response;
    }
    const kind = match[1] as Kind;
    try {
      if (request.method === 'PUT') {
        let refused = 0;
        const result = await store.choose(request, kind, match[2], async () => {
          const body = await readBoundedJson(request, { bytes: 256, chunks: 64 });
          if (!body.ok) refused = body.status;
          return body.ok ? body.value : undefined;
        });
        if (result === 'unauthorized') return json({ error: 'authentication_required' }, 401);
        if (result === 'missing') return json({ error: 'card_image_unavailable' }, 404);
        if (result === 'invalid')
          return json(
            { error: 'invalid_request' },
            refused === 413 || refused === 415 ? refused : 400,
          );
        if (result === 'not_enrolled') return json({ error: 'not_enrolled' }, 403);
      }
      const value = await store.read(
        request.method === 'PUT' ? new Request(request.url, { headers: request.headers }) : request,
        kind,
        match[2],
      );
      return value ? json(value) : json({ error: 'card_image_unavailable' }, 404);
    } catch {
      return json({ error: 'card_image_unavailable' }, 503);
    }
  };
}
