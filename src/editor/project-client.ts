import { proofAuthorization } from '../shared/auth-proof';
import type {
  ProjectDraft,
  ProjectDraftSummary,
  ProjectFields,
  ProjectReceipt,
  PublicProjectReader,
  PublicAuthorProjects,
} from '../project-types';
import { normalizeProjectFields } from '../project-input';
import { publicKeys, publicText, publicSlug } from './public-author-client';
export class ProjectClientError extends Error {
  constructor() {
    super('作品の操作結果を確認できませんでした。');
    this.name = 'ProjectClientError';
  }
}
export const projectUUID = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const fields = ['title', 'description', 'githubUrl', 'demoUrl'];
export const sameProjectFields = (a: ProjectFields, b: ProjectFields) =>
  fields.every((key) => a[key as keyof ProjectFields] === b[key as keyof ProjectFields]);
function validFields(value: Record<string, unknown>) {
  const input = {
    title: value.title,
    description: value.description,
    githubUrl: value.githubUrl,
    demoUrl: value.demoUrl,
  };
  const normalized = normalizeProjectFields(input);
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
export function validProjectDraft(v: unknown): v is ProjectDraft {
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
    publicKeys(v.project, ['id', ...fields, 'publishedOn']) &&
    v.project.id === id &&
    projectUUID(v.project.id) &&
    date(v.project.publishedOn) &&
    validFields(v.project) &&
    Boolean(String(v.project.title).trim()) &&
    Boolean(String(v.project.description).trim())
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
        ]) &&
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
  async function request(
    path: string,
    method = 'GET',
    value?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    };
    let rejectAbort: (e: ProjectClientError) => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => {
      cancel();
      rejectAbort(new ProjectClientError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const operation = (async () => {
      if (controller.signal.aborted) throw new ProjectClientError();
      if (method !== 'GET' && !/^[A-Za-z0-9_-]{43}$/.test(csrfToken))
        throw new ProjectClientError();
      const r = await fetcher(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers:
          method === 'GET'
            ? { Accept: 'application/json' }
            : {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: proofAuthorization('csrf', csrfToken),
              },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
      if (
        controller.signal.aborted ||
        !r.body ||
        r.status !== (method === 'POST' ? 201 : 200) ||
        !/^application\/json(?:;|$)/i.test(r.headers.get('Content-Type') ?? '')
      ) {
        void r.body?.cancel().catch(() => {});
        throw new ProjectClientError();
      }
      const length = r.headers.get('Content-Length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 65536)
      ) {
        void r.body.cancel().catch(() => {});
        throw new ProjectClientError();
      }
      reader = r.body.getReader();
      const bytes = new Uint8Array(65536);
      let size = 0,
        chunks = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (controller.signal.aborted) throw new ProjectClientError();
          if (part.done) break;
          if (++chunks > 65536 || size + part.value.byteLength > bytes.length)
            throw new ProjectClientError();
          bytes.set(part.value, size);
          size += part.value.byteLength;
        }
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
        ) as unknown;
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
        reader = undefined;
      }
    })();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        cancel();
        reject(new ProjectClientError());
      }, 10000);
    });
    try {
      return await Promise.race([operation, deadline, aborted]);
    } catch {
      throw new ProjectClientError();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      cancel();
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
    ) {
      if (!version(expectedVersion)) throw new ProjectClientError();
      const v = await request(
        publicationPath(id),
        'POST',
        { expectedVersion, confirmPublic: true, ...(mediaIds.length ? { mediaIds } : {}) },
        signal,
      );
      if (!publicKeys(v, ['projectId']) || !projectUUID(v.projectId))
        throw new ProjectClientError();
      return v.projectId;
    },
  };
}
