import { validMediaIds } from '../src/shared/media';
import {
  liveStudentSessionSql as writerLive,
  liveStudentSessionBindings as writerBindings,
} from './auth/student-participation';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { SessionStore } from './auth/sessions';
import { japanDate } from './japan-date';
import type { Profile } from '../src/types';
import { hasVisibleCharacter, normalizeProjectFields } from '../src/project-input';
import { decodePublicProfile, publicArticleSqlBounds, publicProfileSqlBounds } from './publication';
import { isProjectStage, PROJECT_JOURNAL_LIMIT } from '../src/project-types';
import type {
  ProjectStage,
  ProjectDraft,
  ProjectJournal,
  PublicProjectJournalEntry,
  ProjectDraftSummary,
  ProjectReceipt,
  PublicProjectReader,
  PublicAuthorProjects,
  PublicProjectDiscovery,
  PublicProjectPage,
  PublicProjectSummary,
} from '../src/project-types';
const uuid = (x: unknown): x is string =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
/** Optional owner-chosen article links: 1-3 distinct UUIDs. Ownership is enforced by the insert trigger. */
const validArticleIds = (x: unknown): x is string[] =>
  Array.isArray(x) &&
  x.length >= 1 &&
  x.length <= 3 &&
  x.every(uuid) &&
  new Set(x).size === x.length;
const version = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) > 0;
const exact = (x: unknown, keys: string[]): x is Record<string, unknown> =>
  !!x &&
  typeof x === 'object' &&
  Object.getPrototypeOf(x) === Object.prototype &&
  Reflect.ownKeys(x).length === keys.length &&
  keys.every((k) => Object.hasOwn(x, k));
const publishOptional = ['mediaIds', 'articleIds', 'stage'];
const publishKeys = (x: unknown): x is Record<string, unknown> =>
  !!x &&
  typeof x === 'object' &&
  Object.getPrototypeOf(x) === Object.prototype &&
  Object.hasOwn(x, 'expectedVersion') &&
  Object.hasOwn(x, 'confirmPublic') &&
  Reflect.ownKeys(x).every(
    (k) =>
      typeof k === 'string' &&
      (k === 'expectedVersion' || k === 'confirmPublic' || publishOptional.includes(k)),
  );
type Proof = NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
type Row = {
  id: string;
  title: string;
  description: string;
  github_url: string;
  demo_url: string;
  technologies: string;
  /** Absent only while migration 0043 has not reached the database. */
  stage?: string;
  version: number;
  updated_at_ms: number;
  source_version: number;
  published_at_ms: number;
  media_ids_json: string;
  article_ids_json: string;
  author_id: string;
  display_name: string;
  department: string;
  year_label: string;
  bio: string;
  initials: string;
};
const columns = 'p.id author_id,p.display_name,p.department,p.year_label,p.bio,p.initials';
const profile = `${publicProfileSqlBounds} AND NOT EXISTS(SELECT 1 FROM private_accounts a WHERE a.id=p.id OR a.google_subject=p.id)`;
const draftBounds = `length(CAST(title AS BLOB))<=800 AND length(CAST(description AS BLOB))<=16384 AND length(CAST(github_url AS BLOB))<=2048 AND length(CAST(demo_url AS BLOB))<=2048 AND length(CAST(technologies AS BLOB))<=400`;
const bounded = `length(CAST(r.title AS BLOB))<=800 AND length(CAST(r.description AS BLOB))<=16384 AND length(CAST(r.github_url AS BLOB))<=2048 AND length(CAST(r.demo_url AS BLOB))<=2048 AND length(CAST(r.technologies AS BLOB))<=400`;
/** Shared public snapshot predicate; aliases r (publication) and p (profile). */
export const publicProjectSqlBounds = `r.status='published' AND ${bounded} AND ${profile}`;
const fields = (
  r: Pick<Row, 'title' | 'description' | 'github_url' | 'demo_url' | 'technologies'>,
) =>
  normalizeProjectFields(
    {
      title: r.title,
      description: r.description,
      githubUrl: r.github_url,
      demoUrl: r.demo_url,
      technologies: r.technologies,
    },
    // Rows saved before the one-line rule stay readable; new input is checked strictly on save.
    'stored',
  );
/** Decodes a saved project draft row; null when a column is out of its bounds. Shared with the MCP store (#298). */
export const decodeProjectDraftRow = (r: Row): ProjectDraft | null => draft(r);
function draft(r: Row): ProjectDraft | null {
  const f = fields(r);
  return f &&
    uuid(r.id) &&
    version(r.version) &&
    Number.isSafeInteger(r.updated_at_ms) &&
    r.updated_at_ms >= 0
    ? { ...f, id: r.id, version: r.version, updatedAt: r.updated_at_ms }
    : null;
}
export type ProjectSnapshotRow = Pick<
  Row,
  | 'id'
  | 'title'
  | 'description'
  | 'github_url'
  | 'demo_url'
  | 'technologies'
  | 'stage'
  | 'published_at_ms'
  | 'author_id'
  | 'display_name'
  | 'department'
  | 'year_label'
  | 'bio'
  | 'initials'
>;
/** A snapshot read before migration 0043 has no stage column: it is shown as complete, as before. */
const snapshotStage = (r: Pick<Row, 'stage'>): ProjectStage | null =>
  r.stage === undefined ? 'complete' : isProjectStage(r.stage) ? r.stage : null;
export function decodeProjectSnapshot(r: ProjectSnapshotRow): PublicProjectReader | null {
  const f = fields(r),
    author = decodePublicProfile(r),
    publishedOn = japanDate(r.published_at_ms),
    stage = snapshotStage(r);
  return f &&
    stage &&
    f.githubUrl === r.github_url &&
    f.demoUrl === r.demo_url &&
    f.technologies === r.technologies &&
    f.title.trim() &&
    f.description.trim() &&
    uuid(r.id) &&
    author &&
    publishedOn
    ? {
        project: {
          ...f,
          id: r.id,
          publishedOn,
          stage,
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
          `INSERT INTO project_drafts(id,owner_account_id,title,description,github_url,demo_url,version,updated_at_ms,technologies) SELECT ?,?,?,?,?,?,1,?,? WHERE ${writerLive} RETURNING *`,
        )
        .bind(
          crypto.randomUUID(),
          p.accountId,
          f.title,
          f.description,
          f.githubUrl,
          f.demoUrl,
          p.nowMs,
          f.technologies,
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
          `SELECT d.id,CASE WHEN length(CAST(d.title AS BLOB))<=800 THEN d.title ELSE NULL END title,d.version,d.updated_at_ms,r.id publication_id FROM (SELECT 1 WHERE ${live}) auth LEFT JOIN project_drafts d ON d.owner_account_id=? LEFT JOIN project_publications r ON r.draft_id=d.id AND r.owner_account_id=d.owner_account_id AND r.status='published' ORDER BY d.updated_at_ms DESC,d.id ASC LIMIT 20`,
        )
        .bind(...binds(p), p.accountId)
        .all<Row & { publication_id: string | null }>();
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
          Array.from(r.title).length > 200 ||
          (r.publication_id !== null && !uuid(r.publication_id))
        )
          return null;
        // #289: the owner's own public page id, so 「作品を編集」 there can open this draft.
        result.push({
          id: r.id,
          title: r.title,
          version: r.version,
          updatedAt: r.updated_at_ms,
          publicationId: r.publication_id,
        });
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
      !(
        exact(input, ['title', 'description', 'githubUrl', 'demoUrl', 'expectedVersion']) ||
        exact(input, [
          'title',
          'description',
          'githubUrl',
          'demoUrl',
          'technologies',
          'expectedVersion',
        ])
      ) ||
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
          `UPDATE project_drafts SET title=?,description=?,github_url=?,demo_url=?,technologies=?,version=version+1,updated_at_ms=? WHERE id=? AND owner_account_id=? AND version=? AND updated_at_ms<=? AND ${writerLive} RETURNING *`,
        )
        .bind(
          f.title,
          f.description,
          f.githubUrl,
          f.demoUrl,
          f.technologies,
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
      !publishKeys(input) ||
      !version(input.expectedVersion) ||
      input.confirmPublic !== true ||
      (Object.hasOwn(input, 'mediaIds') && !validMediaIds(input.mediaIds)) ||
      (Object.hasOwn(input, 'articleIds') && !validArticleIds(input.articleIds)) ||
      (Object.hasOwn(input, 'stage') && !isProjectStage(input.stage))
    )
      return null;
    // Older pages publish without a stage; their projects are complete, as before #275.
    const stage: ProjectStage = isProjectStage(input.stage) ? input.stage : 'complete';
    const mediaJson = JSON.stringify(input.mediaIds ?? []),
      articleJson = JSON.stringify(input.articleIds ?? []);
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
          replay.media_ids_json === mediaJson &&
          replay.article_ids_json === articleJson
          ? { projectId: replay.id }
          : null;
      }
      if (
        valid.version !== input.expectedVersion ||
        !hasVisibleCharacter(valid.title) ||
        !valid.description.trim()
      )
        return null;
      const r = await this.db
        .prepare(
          `INSERT INTO project_publications(id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,technologies,published_at_ms,status,media_ids_json,article_ids_json,stage) SELECT ?,d.owner_account_id,d.id,p.id,d.version,d.title,d.description,d.github_url,d.demo_url,d.technologies,?,'published',?,?,? FROM project_drafts d JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id JOIN public_profiles p ON p.id=m.public_profile_id WHERE d.id=? AND d.owner_account_id=? AND d.version=? AND d.updated_at_ms<=? AND d.title=? AND d.description=? AND d.github_url=? AND d.demo_url=? AND d.technologies=? AND ${profile} AND ${writerLive} ON CONFLICT(draft_id) DO NOTHING RETURNING id`,
        )
        .bind(
          crypto.randomUUID(),
          p.nowMs,
          mediaJson,
          articleJson,
          stage,
          id,
          p.accountId,
          input.expectedVersion,
          p.nowMs,
          valid.title,
          valid.description,
          valid.githubUrl,
          valid.demoUrl,
          valid.technologies,
          ...writerBindings(p),
        )
        .first<{ id: string }>();
      if (r) return { projectId: r.id };
      const existing = await this.receiptRow(p, id);
      return existing &&
        decodeProjectSnapshot(existing) &&
        existing.source_version === input.expectedVersion &&
        existing.media_ids_json === mediaJson &&
        existing.article_ids_json === articleJson
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
      return p ? await this.ownReceipt(p, id) : null;
    } catch {
      return null;
    }
  }
  private async ownReceipt(p: Proof, id: string): Promise<ProjectReceipt | null> {
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
  }
  /**
   * The owner switches 制作中／完成 on their own published snapshot (#275). Only the stage column changes;
   * the snapshot text stays immutable (0038). A stopped, hidden or deleted snapshot, another person's
   * project and a project never published here all return the same null.
   */
  async setStage(req: Request, id: unknown, input: unknown): Promise<ProjectReceipt | null> {
    if (
      req.method !== 'PUT' ||
      !uuid(id) ||
      !exact(input, ['stage']) ||
      !isProjectStage(input.stage)
    )
      return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      // Only a snapshot the owner can read back as a receipt is changed, so a refused request never
      // leaves a written stage behind: first the decoded receipt, then the same SQL bounds in one UPDATE.
      const before = await this.ownReceipt(p, id);
      if (!before?.publication) return null;
      const r = await this.db
        .prepare(
          `UPDATE project_publications SET stage=? WHERE id=? AND draft_id=? AND owner_account_id=? AND status='published' AND EXISTS(SELECT 1 FROM project_publications r JOIN project_drafts d ON d.id=r.draft_id AND d.owner_account_id=r.owner_account_id JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id AND m.public_profile_id=r.public_profile_id JOIN public_profiles p ON p.id=r.public_profile_id WHERE r.id=project_publications.id AND r.status='published' AND ${bounded} AND ${profile}) AND ${writerLive} RETURNING id`,
        )
        .bind(input.stage, before.publication.projectId, id, p.accountId, ...writerBindings(p))
        .first<{ id: string }>();
      if (!r) return null;
      const receipt = await this.ownReceipt(p, id);
      return receipt?.publication?.project.stage === input.stage ? receipt : null;
    } catch {
      return null;
    }
  }
  /** Owner view of the journal links of their own published project (#273); null for anything else. */
  async readJournal(req: Request, id: unknown): Promise<ProjectJournal | null> {
    if (req.method !== 'GET' || !uuid(id)) return null;
    try {
      const p = await this.sessions.storageAuthorization(req);
      return p ? await this.ownJournal(p, id) : null;
    } catch {
      return null;
    }
  }
  private async ownJournal(p: Proof, id: string): Promise<ProjectJournal | null> {
    const rs = await this.db
      .prepare(
        `SELECT r.id project_id,r.article_ids_json,l.article_id,CASE WHEN length(c.title)<=200 AND length(CAST(c.title AS BLOB))<=800 THEN c.title ELSE '' END title,CASE WHEN c.kind='article' AND c.status='published' AND c.is_sample=0 THEN 1 ELSE 0 END is_public FROM project_drafts d JOIN project_publications r ON r.draft_id=d.id AND r.owner_account_id=d.owner_account_id LEFT JOIN project_journal_links l ON l.project_id=r.id AND l.owner_account_id=d.owner_account_id LEFT JOIN content c ON c.id=l.article_id WHERE d.id=? AND d.owner_account_id=? AND r.status='published' AND ${live} ORDER BY l.linked_at_ms ASC,l.article_id ASC LIMIT ${PROJECT_JOURNAL_LIMIT + 1}`,
      )
      .bind(id, p.accountId, ...binds(p))
      .all<{
        project_id: string;
        article_ids_json: string;
        article_id: string | null;
        title: string | null;
        is_public: number;
      }>();
    const first = rs.results[0];
    if (!first || !uuid(first.project_id) || rs.results.length > PROJECT_JOURNAL_LIMIT) return null;
    let fixed: unknown;
    try {
      fixed = JSON.parse(first.article_ids_json);
    } catch {
      return null;
    }
    if (!Array.isArray(fixed) || fixed.length > 3 || !fixed.every(uuid)) return null;
    const articleIds: string[] = [],
      articles: ProjectJournal['articles'] = [];
    for (const r of rs.results) {
      if (r.project_id !== first.project_id) return null;
      if (r.article_id === null) continue;
      if (!uuid(r.article_id)) return null;
      articleIds.push(r.article_id);
      // The owner's own titles and whether each linked article is still public, decided here and not
      // from the client's newest-20 publication list (#273 verifier N1). The page re-checks in full.
      articles.push({
        id: r.article_id,
        title: typeof r.title === 'string' ? r.title : '',
        isPublic: r.is_public === 1,
      });
    }
    return { projectId: first.project_id, fixedArticleIds: fixed, articleIds, articles };
  }
  /**
   * The owner adds or removes one of their own public articles as a journal entry of their own published
   * project (#273). Another person's article, a draft, a stopped article, an article already fixed at
   * publish time, a stopped project and a project never published all return the same null; the 0046
   * insert trigger re-checks the ownership and public state, so a refused link writes nothing.
   */
  async setJournalLink(req: Request, id: unknown, input: unknown): Promise<ProjectJournal | null> {
    if (
      req.method !== 'PUT' ||
      !uuid(id) ||
      !exact(input, ['articleId', 'linked']) ||
      !uuid(input.articleId) ||
      typeof input.linked !== 'boolean'
    )
      return null;
    const articleId = input.articleId,
      linked = input.linked;
    try {
      const p = await this.sessions.storageAuthorization(req);
      if (!p) return null;
      const before = await this.ownJournal(p, id);
      if (!before) return null;
      if (linked && before.fixedArticleIds.includes(articleId)) return null;
      if (linked && !before.articleIds.includes(articleId)) {
        const r = await this.db
          .prepare(
            `INSERT INTO project_journal_links(project_id,article_id,owner_account_id,linked_at_ms) SELECT r.id,?,d.owner_account_id,? FROM project_drafts d JOIN project_publications r ON r.draft_id=d.id AND r.owner_account_id=d.owner_account_id WHERE d.id=? AND d.owner_account_id=? AND r.id=? AND r.status='published' AND ${writerLive} ON CONFLICT(project_id,article_id) DO NOTHING RETURNING article_id`,
          )
          .bind(articleId, p.nowMs, id, p.accountId, before.projectId, ...writerBindings(p))
          .first<{ article_id: string }>();
        if (!r) return null;
      } else if (!linked && before.articleIds.includes(articleId)) {
        await this.db
          .prepare(
            `DELETE FROM project_journal_links WHERE project_id=? AND article_id=? AND owner_account_id=? AND EXISTS(SELECT 1 FROM project_drafts d JOIN project_publications r ON r.draft_id=d.id AND r.owner_account_id=d.owner_account_id WHERE d.id=? AND d.owner_account_id=? AND r.id=project_journal_links.project_id) AND ${live}`,
          )
          .bind(before.projectId, articleId, p.accountId, id, p.accountId, ...binds(p))
          .run();
      }
      const after = await this.ownJournal(p, id);
      return after && after.articleIds.includes(articleId) === linked ? after : null;
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
  /**
   * Public project page: the snapshot, the articles linked at publish time and the journal articles the
   * owner linked later (#273). Every article is re-checked as public by the same author on each read.
   */
  async readPublishedPage(id: unknown): Promise<PublicProjectPage | null> {
    const value = await this.readPublished(id);
    if (!value) return null;
    let articles: PublicProjectPage['articles'] = [];
    try {
      const rows = await this.db
        .prepare(
          `SELECT c.id,c.title FROM project_publications r JOIN json_each(CASE WHEN json_valid(r.article_ids_json) THEN r.article_ids_json ELSE '[]' END) link JOIN content c ON c.id=link.value JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id WHERE r.id=? AND r.status='published' AND c.author_id=r.public_profile_id AND ${publicArticleSqlBounds} ORDER BY link.key ASC LIMIT 3`,
        )
        .bind(value.project.id)
        .all<{ id: string; title: string }>();
      articles = rows.results.map((r) => ({ id: r.id, title: r.title }));
      if (!articles.every((a) => uuid(a.id) && typeof a.title === 'string' && a.title.trim()))
        return null;
    } catch {
      // Links are supplementary: before migration 0024 reaches a database, keep the project page readable.
    }
    let journal: PublicProjectJournalEntry[] = [];
    try {
      const rows = await this.db
        .prepare(
          `SELECT c.id,c.title,publication.published_at_ms FROM project_journal_links l JOIN project_publications r ON r.id=l.project_id AND r.owner_account_id=l.owner_account_id JOIN content c ON c.id=l.article_id JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id AND publication.owner_account_id=l.owner_account_id JOIN public_profiles p ON p.id=c.author_id WHERE l.project_id=? AND r.status='published' AND c.author_id=r.public_profile_id AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(r.article_ids_json) THEN r.article_ids_json ELSE '[]' END) fixed WHERE fixed.value=c.id) AND ${publicArticleSqlBounds} ORDER BY publication.published_at_ms ASC,c.id ASC LIMIT ${PROJECT_JOURNAL_LIMIT}`,
        )
        .bind(value.project.id)
        .all<{ id: string; title: string; published_at_ms: number }>();
      journal = [];
      for (const r of rows.results) {
        const publishedOn = japanDate(r.published_at_ms);
        if (!uuid(r.id) || typeof r.title !== 'string' || !r.title.trim() || !publishedOn)
          return null;
        journal.push({ id: r.id, title: r.title, publishedOn });
      }
    } catch {
      // Before migration 0046 reaches a database the page simply has no journal yet.
      journal = [];
    }
    return { ...value, articles, journal };
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
            stage: p.stage,
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
              stage: p.stage,
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
