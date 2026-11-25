import { readBoundedJson } from '../shared/http-client';
import { isProjectStage, PROJECT_JOURNAL_LIMIT, type ProjectStage } from '../project-types';
import type {
  ProjectDraft,
  ProjectDraftSummary,
  ProjectFields,
  ProjectJournal,
  ProjectReceipt,
  PublicProjectArticleLink,
  PublicProjectJournalEntry,
  PublicProjectReader,
  PublicAuthorProjects,
} from '../project-types';
import { normalizeProjectFields } from '../project-input';
import { publicKeys, publicText, publicSlug } from './public-author-client';
export class ProjectClientError extends Error {
  /** Absent or not public (404 / impossible id), as opposed to a failed read. */
  readonly missing: boolean;
  constructor(missing = false) {
    super('作品の操作結果を確認できませんでした。');
    this.name = 'ProjectClientError';
    this.missing = missing;
  }
}
export const projectUUID = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const fields = ['title', 'description', 'githubUrl', 'demoUrl', 'technologies'];
export const sameProjectFields = (a: ProjectFields, b: ProjectFields) =>
  fields.every((key) => a[key as keyof ProjectFields] === b[key as keyof ProjectFields]);
function validFields(value: Record<string, unknown>) {
  const input = {
    title: value.title,
    description: value.description,
    githubUrl: value.githubUrl,
    demoUrl: value.demoUrl,
    technologies: value.technologies,
  };
  // Server responses may carry a draft saved before the one-line rule; it must still load.
  const normalized = normalizeProjectFields(input, 'stored');
  return normalized !== null && sameProjectFields(normalized, input as ProjectFields);
}
function summary(v: unknown): v is ProjectDraftSummary {
  return (
    publicKeys(v, ['id', 'title', 'version', 'updatedAt']) &&
    projectUUID(v.id) &&
    publicText(v.title, 200) &&
    version(v.version) &&
    Number.isSafeInteger(v.updatedAt) &&
    Number(v.updatedAt) >= 0
  );
}
function validProjectDraft(v: unknown): v is ProjectDraft {
  return (
    publicKeys(v, ['id', ...fields, 'version', 'updatedAt']) &&
    validFields(v) &&
    summary({ id: v.id, title: v.title, version: v.version, updatedAt: v.updatedAt })
  );
}
function author(v: unknown): boolean {
  return (
    publicKeys(v, ['id', 'name', 'department', 'year', 'bio', 'initials']) &&
    publicSlug(v.id) &&
    publicText(v.name, 80) &&
    Boolean(v.name.trim()) &&
    publicText(v.department, 80) &&
    publicText(v.year, 32) &&
    publicText(v.bio, 800) &&
    publicText(v.initials, 8)
  );
}
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export function validProjectReader(v: unknown, id: string): v is PublicProjectReader {
  return (
    publicKeys(v, ['project', 'author']) &&
    author(v.author) &&
    publicKeys(v.project, ['id', ...fields, 'publishedOn', 'stage']) &&
    isProjectStage(v.project.stage) &&
    v.project.id === id &&
    projectUUID(v.project.id) &&
    date(v.project.publishedOn) &&
    validFields(v.project) &&
    Boolean(String(v.project.title).trim()) &&
    Boolean(String(v.project.description).trim())
  );
}
/**
 * Public project page; the lab read omits `articles`, the ordinary read always includes it (possibly empty).
 * `journal` (#273) is optional so this page still reads a Worker from before the journal links.
 */
export function validProjectPage(
  v: unknown,
  id: string,
): v is PublicProjectReader & {
  articles?: PublicProjectArticleLink[];
  journal?: PublicProjectJournalEntry[];
} {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const { articles, journal, ...reader } = v as Record<string, unknown>;
  if (!Object.hasOwn(v, 'articles')) return validProjectReader(v, id);
  return (
    validProjectReader(reader, id) &&
    Array.isArray(articles) &&
    articles.length <= 3 &&
    articles.every(
      (a) =>
        publicKeys(a, ['id', 'title']) &&
        projectUUID(a.id) &&
        publicText(a.title, 200) &&
        Boolean(a.title.trim()),
    ) &&
    new Set(articles.map((a) => (a as { id: string }).id)).size === articles.length &&
    (!Object.hasOwn(v, 'journal') ||
      (Array.isArray(journal) &&
        journal.length <= PROJECT_JOURNAL_LIMIT &&
        journal.every(
          (a) =>
            publicKeys(a, ['id', 'title', 'publishedOn']) &&
            projectUUID(a.id) &&
            publicText(a.title, 200) &&
            Boolean(a.title.trim()) &&
            date(a.publishedOn),
        ) &&
        new Set([...articles, ...journal].map((a) => (a as { id: string }).id)).size ===
          articles.length + journal.length))
  );
}
function validJournal(v: unknown): v is ProjectJournal {
  return (
    publicKeys(v, ['projectId', 'fixedArticleIds', 'articleIds', 'articles']) &&
    projectUUID(v.projectId) &&
    Array.isArray(v.fixedArticleIds) &&
    v.fixedArticleIds.length <= 3 &&
    v.fixedArticleIds.every(projectUUID) &&
    Array.isArray(v.articleIds) &&
    v.articleIds.length <= PROJECT_JOURNAL_LIMIT &&
    v.articleIds.every(projectUUID) &&
    new Set(v.articleIds).size === v.articleIds.length &&
    Array.isArray(v.articles) &&
    v.articles.length === v.articleIds.length &&
    v.articles.every(
      (a, n) =>
        publicKeys(a, ['id', 'title', 'isPublic']) &&
        a.id === (v.articleIds as string[])[n] &&
        publicText(a.title, 200) &&
        typeof a.isPublic === 'boolean',
    )
  );
}
export function validProjectAuthor(v: unknown, id: string): v is PublicAuthorProjects {
  return (
    publicKeys(v, ['author', 'projects']) &&
    author(v.author) &&
    (v.author as Record<string, unknown>).id === id &&
    Array.isArray(v.projects) &&
    v.projects.length > 0 &&
    v.projects.length <= 20 &&
    new Set(v.projects.map((p) => p?.id)).size === v.projects.length &&
    v.projects.every(
      (p) =>
        publicKeys(p, [
          'id',
          'title',
          'descriptionPreview',
          'githubUrl',
          'demoUrl',
          'publishedOn',
          'stage',
        ]) &&
        isProjectStage(p.stage) &&
        projectUUID(p.id) &&
        date(p.publishedOn) &&
        publicText(p.title, 200) &&
        Boolean(p.title.trim()) &&
        publicText(p.descriptionPreview, 300) &&
        validFields({
          title: p.title,
          description: p.descriptionPreview,
          githubUrl: p.githubUrl,
          demoUrl: p.demoUrl,
          technologies: '',
        }),
    )
  );
}
function receipt(v: unknown): v is ProjectReceipt {
  return (
    publicKeys(v, ['publication']) &&
    (v.publication === null ||
      (publicKeys(v.publication, ['projectId', 'sourceVersion', 'project', 'author']) &&
        version(v.publication.sourceVersion) &&
        projectUUID(v.publication.projectId) &&
        validProjectReader(
          { project: v.publication.project, author: v.publication.author },
          v.publication.projectId,
        )))
  );
}
export function createProjectClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  /** Private owner reads and writes go through the one bounded transport (#189). */
  async function request(
    path: string,
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    value?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      return await readBoundedJson(path, {
        fetcher,
        credentials: 'same-origin',
        method,
        status: method === 'POST' ? 201 : 200,
        maxBytes: 65536,
        signal,
        // Every write carries a body and the CSRF proof; a read carries neither.
        ...(method === 'GET' ? {} : { csrf: csrfToken, body: value }),
      });
    } catch {
      throw new ProjectClientError();
    }
  }
  const draftPath = (id: string) => {
    if (!projectUUID(id)) throw new ProjectClientError();
    return '/api/private/project-drafts/' + id;
  };
  const publicationPath = (id: string) => {
    draftPath(id);
    return '/api/private/project-publications/' + id;
  };
  const journalPath = (id: string) => {
    draftPath(id);
    return '/api/private/project-journal/' + id;
  };
  return {
    async list(signal?: AbortSignal) {
      const v = await request('/api/private/project-drafts', 'GET', undefined, signal);
      if (
        !Array.isArray(v) ||
        v.length > 20 ||
        !v.every(summary) ||
        new Set(v.map((d) => d.id)).size !== v.length
      )
        throw new ProjectClientError();
      return v as ProjectDraftSummary[];
    },
    async read(id: string, signal?: AbortSignal) {
      const v = await request(draftPath(id), 'GET', undefined, signal);
      if (!validProjectDraft(v) || v.id !== id) throw new ProjectClientError();
      return v;
    },
    async save(
      id: string | null,
      input: ProjectFields,
      expectedVersion?: number,
      signal?: AbortSignal,
    ) {
      const normalized = normalizeProjectFields(input);
      if (!normalized || (id !== null && !version(expectedVersion))) throw new ProjectClientError();
      const v = await request(
        id ? draftPath(id) : '/api/private/project-drafts',
        id ? 'PUT' : 'POST',
        id ? { ...normalized, expectedVersion } : normalized,
        signal,
      );
      if (
        !validProjectDraft(v) ||
        (id === null && v.version !== 1) ||
        (id !== null && (v.id !== id || v.version !== expectedVersion! + 1)) ||
        !sameProjectFields(v, normalized)
      )
        throw new ProjectClientError();
      return v;
    },
    async receipt(id: string, signal?: AbortSignal) {
      const v = await request(publicationPath(id), 'GET', undefined, signal);
      if (!receipt(v)) throw new ProjectClientError();
      return v;
    },
    async publish(
      id: string,
      expectedVersion: number,
      signal?: AbortSignal,
      mediaIds: string[] = [],
      articleIds: string[] = [],
      stage: ProjectStage = 'complete',
    ) {
      if (
        !version(expectedVersion) ||
        !isProjectStage(stage) ||
        articleIds.length > 3 ||
        !articleIds.every(projectUUID) ||
        new Set(articleIds).size !== articleIds.length
      )
        throw new ProjectClientError();
      const v = await request(
        publicationPath(id),
        'POST',
        {
          expectedVersion,
          confirmPublic: true,
          ...(mediaIds.length ? { mediaIds } : {}),
          ...(articleIds.length ? { articleIds } : {}),
          stage,
        },
        signal,
      );
      if (!publicKeys(v, ['projectId']) || !projectUUID(v.projectId))
        throw new ProjectClientError();
      return v.projectId;
    },
    /** Owner-only 制作中／完成 switch on the published snapshot; returns the confirmed receipt (#275). */
    async setStage(id: string, stage: ProjectStage, signal?: AbortSignal) {
      if (!isProjectStage(stage)) throw new ProjectClientError();
      const v = await request(publicationPath(id), 'PUT', { stage }, signal);
      if (!receipt(v) || v.publication?.project.stage !== stage) throw new ProjectClientError();
      return v.publication;
    },
    /** Owner-only journal links of an own published project, addressed by its draft id (#273). */
    async journal(id: string, signal?: AbortSignal) {
      const v = await request(journalPath(id), 'GET', undefined, signal);
      if (!validJournal(v)) throw new ProjectClientError();
      return v;
    },
    /** Adds or removes one own public article as a journal entry; returns the confirmed links. */
    async setJournalLink(id: string, articleId: string, linked: boolean, signal?: AbortSignal) {
      if (!projectUUID(articleId) || typeof linked !== 'boolean') throw new ProjectClientError();
      const v = await request(journalPath(id), 'PUT', { articleId, linked }, signal);
      if (!validJournal(v) || v.articleIds.includes(articleId) !== linked)
        throw new ProjectClientError();
      return v;
    },
  };
}
