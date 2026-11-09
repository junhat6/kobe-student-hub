import { validMediaIds } from '../src/shared/media';
import {
  liveStudentSessionSql as writerLive,
  liveStudentSessionBindings as writerBindings,
} from './auth/student-participation';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { SessionStore } from './auth/sessions';
import type { Profile } from '../src/types';
import { normalizeProjectFields } from '../src/project-input';
import { decodePublicProfile, publicProfileSqlBounds } from './publication';
import type {
  ProjectDraft,
  ProjectDraftSummary,
  ProjectReceipt,
  PublicProjectReader,
  PublicAuthorProjects,
  PublicProjectDiscovery,
  PublicProjectSummary,
} from '../src/project-types';
const uuid = (x: unknown): x is string =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const version = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) > 0;
const exact = (x: unknown, keys: string[]): x is Record<string, unknown> =>
  !!x &&
  typeof x === 'object' &&
  Object.getPrototypeOf(x) === Object.prototype &&
  Reflect.ownKeys(x).length === keys.length &&
  keys.every((k) => Object.hasOwn(x, k));
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
type Row = {
  id: string;
  title: string;
  description: string;
  github_url: string;
  demo_url: string;
  version: number;
  updated_at_ms: number;
  source_version: number;
  published_at_ms: number;
  media_ids_json: string;
  author_id: string;
  display_name: string;
  department: string;
  year_label: string;
  bio: string;
  initials: string;
};
const columns = 'p.id author_id,p.display_name,p.department,p.year_label,p.bio,p.initials';
const profile = `${publicProfileSqlBounds} AND NOT EXISTS(SELECT 1 FROM private_accounts a WHERE a.id=p.id OR a.google_subject=p.id)`;
const draftBounds = `length(CAST(title AS BLOB))<=800 AND length(CAST(description AS BLOB))<=16384 AND length(CAST(github_url AS BLOB))<=2048 AND length(CAST(demo_url AS BLOB))<=2048`;
const bounded = `length(CAST(r.title AS BLOB))<=800 AND length(CAST(r.description AS BLOB))<=16384 AND length(CAST(r.github_url AS BLOB))<=2048 AND length(CAST(r.demo_url AS BLOB))<=2048`;
/** Shared public snapshot predicate; aliases r (publication) and p (profile). */
export const publicProjectSqlBounds = `r.status='published' AND ${bounded} AND ${profile}`;
const fields = (r: Pick<Row, 'title' | 'description' | 'github_url' | 'demo_url'>) =>
  normalizeProjectFields({
    title: r.title,
    description: r.description,
    githubUrl: r.github_url,
    demoUrl: r.demo_url,
  });
const draft = (r: Row): ProjectDraft | null => {
  const f = fields(r);
  return f &&
    uuid(r.id) &&
    version(r.version) &&
    Number.isSafeInteger(r.updated_at_ms) &&
    r.updated_at_ms >= 0
    ? { ...f, id: r.id, version: r.version, updatedAt: r.updated_at_ms }
    : null;
};
export type ProjectSnapshotRow = Pick<
  Row,
  | 'id'
  | 'title'
  | 'description'
  | 'github_url'
  | 'demo_url'
  | 'published_at_ms'
  | 'author_id'
  | 'display_name'
  | 'department'
  | 'year_label'
  | 'bio'
  | 'initials'
>;
export function decodeProjectSnapshot(r: ProjectSnapshotRow): PublicProjectReader | null {
  const f = fields(r),
    author = decodePublicProfile(r);
  return f &&
    f.githubUrl === r.github_url &&
    f.demoUrl === r.demo_url &&
    f.title.trim() &&
    f.description.trim() &&
    uuid(r.id) &&
    author &&
    Number.isSafeInteger(r.published_at_ms) &&
    r.published_at_ms >= 0 &&
    r.published_at_ms <= 253402300799999
    ? {
        project: {
          ...f,
          id: r.id,
          publishedOn: new Date(r.published_at_ms).toISOString().slice(0, 10),
        },
        author,
      }
    : null;
}
/** Local-only saved project and immutable publication boundary. */
export class ProjectStore {
  private sessions: SessionStore;
  constructor(
    private db: D1Database,
    origin: string,
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  async createDraft(req: Request, input: unknown): Promise<ProjectDraft | null> {
    const f = normalizeProjectFields(input);
    if (req.method !== 'POST' || !f) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const r = await this.db
        .prepare(
          `INSERT INTO project_drafts SELECT ?,?,?,?,?,?,1,? WHERE ${writerLive} RETURNING *`,
        )
        .bind(
          crypto.randomUUID(),
          p.accountId,
          f.title,
          f.description,
          f.githubUrl,
          f.demoUrl,
          p.nowMs,
          ...writerBindings(p),
        )
        .first<Row>();
      return r ? draft(r) : null;
    } catch {
      return null;
    }
  }
  async getDraft(req: Request, id: unknown): Promise<ProjectDraft | null> {
    if (req.method !== 'GET' || !uuid(id)) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const r = await this.db
        .prepare(
          `SELECT * FROM project_drafts WHERE id=? AND owner_account_id=? AND ${draftBounds} AND ${live}`,
        )
        .bind(id, p.accountId, ...binds(p))
        .first<Row>();
      return r ? draft(r) : null;
    } catch {
      return null;
    }
  }
  async listDrafts(req: Request): Promise<ProjectDraftSummary[] | null> {
    if (req.method !== 'GET') return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const rs = await this.db
        .prepare(
          `SELECT d.id,CASE WHEN length(CAST(d.title AS BLOB))<=800 THEN d.title ELSE NULL END title,d.version,d.updated_at_ms FROM (SELECT 1 WHERE ${live}) auth LEFT JOIN project_drafts d ON d.owner_account_id=? ORDER BY d.updated_at_ms DESC,d.id ASC LIMIT 20`,
        )
        .bind(...binds(p), p.accountId)
        .all<Row>();
      if (!rs.results.length) return null;
      const result: ProjectDraftSummary[] = [];
      for (const r of rs.results) {
        if (r.id === null) continue;
        if (
          !uuid(r.id) ||
          !version(r.version) ||
          typeof r.title !== 'string' ||
          r.title.length > 400 ||
          r.title.includes('\0') ||
          Array.from(r.title).length > 200
        )
          return null;
        result.push({ id: r.id, title: r.title, version: r.version, updatedAt: r.updated_at_ms });
      }
      return result;
    } catch {
      return null;
    }
  }
  async saveDraft(req: Request, id: unknown, input: unknown): Promise<ProjectDraft | null> {
    if (
      req.method !== 'PUT' ||
      !uuid(id) ||
      !exact(input, ['title', 'description', 'githubUrl', 'demoUrl', 'expectedVersion']) ||
      !version(input.expectedVersion) ||
      input.expectedVersion >= Number.MAX_SAFE_INTEGER
    )
      return null;
    const { expectedVersion, ...rest } = input;
    const f = normalizeProjectFields(rest);
    if (!f) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const r = await this.db
        .prepare(
          `UPDATE project_drafts SET title=?,description=?,github_url=?,demo_url=?,version=version+1,updated_at_ms=? WHERE id=? AND owner_account_id=? AND version=? AND updated_at_ms<=? AND ${writerLive} RETURNING *`,
        )
        .bind(
          f.title,
          f.description,
          f.githubUrl,
          f.demoUrl,
          p.nowMs,
          id,
          p.accountId,
          expectedVersion,
          p.nowMs,
          ...writerBindings(p),
        )
        .first<Row>();
      return r ? draft(r) : null;
    } catch {
      return null;
    }
  }
  async publish(req: Request, id: unknown, input: unknown): Promise<{ projectId: string } | null> {
    if (
      req.method !== 'POST' ||
      !uuid(id) ||
      !(
        exact(input, ['expectedVersion', 'confirmPublic']) ||
        exact(input, ['expectedVersion', 'confirmPublic', 'mediaIds'])
      ) ||
      !version(input.expectedVersion) ||
      input.confirmPublic !== true ||
      (Object.hasOwn(input, 'mediaIds') && !validMediaIds(input.mediaIds))
    )
      return null;
    try {
      const early = await this.sessions.storageAuthorization(req);
      if (!early) return null;
      const d = await this.db
        .prepare(
          `SELECT * FROM project_drafts WHERE id=? AND owner_account_id=? AND ${draftBounds} AND ${writerLive}`,
        )
        .bind(id, early.accountId, ...writerBindings(early))
        .first<Row>();
      if (!d) return null;
      const valid = draft(d);
      if (!valid) return null;
      const p = await this.sessions.storageAuthorization(req);
      if (!p || p.nowMs > 253402300799999) return null;
      const replay = await this.receiptRow(p, id);
      if (replay) {
        const decoded = decodeProjectSnapshot(replay);
        return decoded &&
          version(replay.source_version) &&
          replay.source_version === input.expectedVersion &&
          replay.media_ids_json === JSON.stringify(input.mediaIds ?? [])
          ? { projectId: replay.id }
          : null;
      }
      if (
        valid.version !== input.expectedVersion ||
        !valid.title.trim() ||
        !valid.description.trim()
      )
        return null;
      const r = await this.db
        .prepare(
          `INSERT INTO project_publications(id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,published_at_ms,status,media_ids_json) SELECT ?,d.owner_account_id,d.id,p.id,d.version,d.title,d.description,d.github_url,d.demo_url,?,'published',? FROM project_drafts d JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id JOIN public_profiles p ON p.id=m.public_profile_id WHERE d.id=? AND d.owner_account_id=? AND d.version=? AND d.updated_at_ms<=? AND d.title=? AND d.description=? AND d.github_url=? AND d.demo_url=? AND ${profile} AND ${writerLive} ON CONFLICT(draft_id) DO NOTHING RETURNING id`,
        )
        .bind(
          crypto.randomUUID(),
          p.nowMs,
          JSON.stringify(input.mediaIds ?? []),
          id,
          p.accountId,
          input.expectedVersion,
          p.nowMs,
          valid.title,
          valid.description,
          valid.githubUrl,
          valid.demoUrl,
          ...writerBindings(p),
        )
        .first<{ id: string }>();
      if (r) return { projectId: r.id };
      const existing = await this.receiptRow(p, id);
      return existing &&
        decodeProjectSnapshot(existing) &&
        existing.source_version === input.expectedVersion &&
        existing.media_ids_json === JSON.stringify(input.mediaIds ?? [])
        ? { projectId: existing.id }
        : null;
    } catch {
      return null;
    }
  }
  private async receiptRow(p: Proof, id: string) {
    return this.db
      .prepare(
        `SELECT r.*,${columns} FROM project_publications r JOIN project_drafts d ON d.id=r.draft_id AND d.owner_account_id=r.owner_account_id JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id AND m.public_profile_id=r.public_profile_id JOIN public_profiles p ON p.id=r.public_profile_id WHERE d.id=? AND d.owner_account_id=? AND r.status='published' AND ${bounded} AND ${profile} AND ${writerLive}`,
      )
      .bind(id, p.accountId, ...writerBindings(p))
      .first<Row>();
  }
  async getOwnReceipt(req: Request, id: unknown): Promise<ProjectReceipt | null> {
    if (req.method !== 'GET' || !uuid(id)) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const r = await this.db
        .prepare(
          `SELECT d.id draft_exists,r.id publication_id,r.*,${columns} FROM project_drafts d LEFT JOIN project_publications r ON r.draft_id=d.id LEFT JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id LEFT JOIN public_profiles p ON p.id=r.public_profile_id WHERE d.id=? AND d.owner_account_id=? AND ${live} AND (r.id IS NULL OR (r.owner_account_id=d.owner_account_id AND m.public_profile_id=r.public_profile_id AND r.status='published' AND ${bounded} AND ${profile}))`,
        )
        .bind(id, p.accountId, ...binds(p))
        .first<Row & { publication_id: string | null }>();
      if (!r) return null;
      if (r.publication_id === null) return { publication: null };
      const v = decodeProjectSnapshot(r);
      return v && version(r.source_version)
        ? { publication: { projectId: r.id, sourceVersion: r.source_version, ...v } }
        : null;
    } catch {
      return null;
    }
  }
  async readPublished(id: unknown): Promise<PublicProjectReader | null> {
    if (!uuid(id)) return null;
    try {
      const r = await this.db
        .prepare(
          `SELECT r.*,${columns} FROM project_publications r JOIN public_profiles p ON p.id=r.public_profile_id WHERE r.id=? AND r.status='published' AND ${bounded} AND ${profile}`,
        )
        .bind(id)
        .first<Row>();
      return r ? decodeProjectSnapshot(r) : null;
    } catch {
      return null;
    }
  }
  async readAuthorSelection(
    id: unknown,
  ): Promise<{ author: Profile | null; projects: PublicProjectSummary[] } | null> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) return null;
    try {
      const candidates = await this.db
        .prepare(
          `SELECT id FROM project_publications WHERE public_profile_id=? AND status='published' ORDER BY published_at_ms DESC,id ASC LIMIT 20`,
        )
        .bind(id)
        .all<{ id: string }>();
      if (!candidates.results.length) return { author: null, projects: [] };
      if (candidates.results.some((r) => !uuid(r.id))) return null;
      const ids = candidates.results.map((r) => r.id);
      const rows = await this.db
        .prepare(
          `SELECT r.*,${columns} FROM project_publications r JOIN public_profiles p ON p.id=r.public_profile_id WHERE r.id IN (${ids.map(() => '?').join(',')}) AND r.public_profile_id=? AND r.status='published' AND ${bounded} AND ${profile} ORDER BY r.published_at_ms DESC,r.id ASC`,
        )
        .bind(...ids, id)
        .all<Row>();
      if (rows.results.length !== ids.length) return null;
      const decoded = rows.results.map(decodeProjectSnapshot);
      if (decoded.some((r) => !r)) return null;
      const result = {
        author: decoded[0]!.author,
        projects: decoded.map((r) => {
          const p = r!.project;
          return {
            id: p.id,
            title: p.title,
            descriptionPreview: Array.from(p.description).slice(0, 300).join(''),
            githubUrl: p.githubUrl,
            demoUrl: p.demoUrl,
            publishedOn: p.publishedOn,
          };
        }),
      };
      return new TextEncoder().encode(JSON.stringify(result)).length <= 262144 ? result : null;
    } catch {
      return null;
    }
  }
  /** Preserve the existing single-kind author contract for lab and project-only clients. */
  async readAuthor(id: unknown): Promise<PublicAuthorProjects | null> {
    const value = await this.readAuthorSelection(id);
    return value?.author && value.projects.length
      ? { author: value.author, projects: value.projects }
      : null;
  }
  /** Anonymous local recent projects. A malformed selected snapshot fails the whole bounded projection. */
  async readRecentPublished(): Promise<PublicProjectDiscovery | null> {
    try {
      const candidates = await this.db
        .prepare(
          "SELECT id FROM project_publications WHERE status='published' ORDER BY published_at_ms DESC,id ASC LIMIT 20",
        )
        .all<{ id: string }>();
      const ids = candidates.results.map((r) => r.id);
      if (ids.some((id) => !uuid(id)) || new Set(ids).size !== ids.length) return null;
      if (!ids.length) return { cards: [] };
      const rows = await this.db
        .prepare(
          `SELECT r.*,${columns} FROM project_publications r JOIN public_profiles p ON p.id=r.public_profile_id WHERE r.id IN (${ids.map(() => '?').join(',')}) AND r.status='published' AND ${bounded} AND ${profile} ORDER BY r.published_at_ms DESC,r.id ASC`,
        )
        .bind(...ids)
        .all<Row>();
      if (rows.results.length !== ids.length || rows.results.some((r, i) => r.id !== ids[i]))
        return null;
      const decoded = rows.results.map(decodeProjectSnapshot);
      if (decoded.some((r) => !r)) return null;
      const result: PublicProjectDiscovery = {
        cards: decoded.map((row) => {
          const { project: p, author: a } = row!;
          return {
            project: {
              id: p.id,
              title: p.title,
              descriptionPreview: Array.from(p.description).slice(0, 300).join(''),
              publishedOn: p.publishedOn,
            },
            author: {
              id: a.id,
              name: a.name,
              department: a.department,
              year: a.year,
              initials: a.initials,
            },
          };
        }),
      };
      return new TextEncoder().encode(JSON.stringify(result)).length <= 262144 ? result : null;
    } catch {
      return null;
    }
  }
}
