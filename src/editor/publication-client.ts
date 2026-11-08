import { proofAuthorization } from '../shared/auth-proof';
import type { Entry, Profile } from '../types';
import type { EditorDraft } from './draft-client';
import type { PublicProfile } from './profile-client';
export interface PublicationMetadata {
  summary: string;
  tags: string[];
  minutes: number;
  audience: string;
  prerequisite: string;
  outcome: string;
}
export interface PublicationReceipt {
  contentId: string;
  sourceVersion: number;
  entry: Entry;
  author: Profile;
}
export interface PublicationAttempt {
  draft: EditorDraft;
  metadata: PublicationMetadata;
  author: PublicProfile;
}
export class PublicationClientError extends Error {
  constructor() {
    super('記事の公開状態を確認できませんでした。');
    this.name = 'PublicationClientError';
  }
}
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const slug = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const keys = (v: unknown, wanted: string[]): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === wanted.length &&
  wanted.every((k) => Object.hasOwn(v, k));
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length <= max * 2 &&
  !v.includes('\0') &&
  Array.from(v).length <= max &&
  new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(v)) === v;
export function canonicalTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || raw.length > 128) return null;
    const tag = raw.normalize('NFKC').trim();
    if (!tag.trim() || !text(tag, 24) || /[\p{Cc}\p{Cf}]/u.test(tag) || tags.includes(tag))
      return null;
    tags.push(tag);
  }
  return tags.sort();
}
export function checkedMetadata(v: unknown): PublicationMetadata | null {
  if (
    !keys(v, ['summary', 'tags', 'minutes', 'audience', 'prerequisite', 'outcome']) ||
    !text(v.summary, 300) ||
    !Number.isInteger(v.minutes) ||
    Number(v.minutes) < 1 ||
    Number(v.minutes) > 240 ||
    !text(v.audience, 200) ||
    !text(v.prerequisite, 200) ||
    !text(v.outcome, 200)
  )
    return null;
  const tags = canonicalTags(v.tags);
  return tags
    ? {
        summary: v.summary,
        tags,
        minutes: v.minutes as number,
        audience: v.audience,
        prerequisite: v.prerequisite,
        outcome: v.outcome,
      }
    : null;
}
function article(v: unknown): v is { entry: Entry; author: Profile } {
  if (
    !keys(v, ['entry', 'author']) ||
    !keys(v.entry, [
      'id',
      'kind',
      'title',
      'summary',
      'body',
      'tags',
      'authorId',
      'audience',
      'prerequisite',
      'outcome',
      'updatedAt',
      'minutes',
      'relatedIds',
    ]) ||
    !keys(v.author, ['id', 'name', 'department', 'year', 'bio', 'initials'])
  )
    return false;
  const e = v.entry,
    a = v.author;
  const tags = canonicalTags(e.tags);
  return (
    uuid(e.id) &&
    e.kind === 'article' &&
    text(e.title, 200) &&
    Boolean(e.title.trim()) &&
    typeof e.body === 'string' &&
    e.body.length <= 262144 &&
    new TextEncoder().encode(e.body).byteLength <= 262144 &&
    new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(e.body)) === e.body &&
    !e.body.includes('\0') &&
    text(e.summary, 300) &&
    tags !== null &&
    JSON.stringify(tags) === JSON.stringify(e.tags) &&
    slug(e.authorId) &&
    text(e.audience, 200) &&
    text(e.prerequisite, 200) &&
    text(e.outcome, 200) &&
    typeof e.updatedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.updatedAt) &&
    Number.isInteger(e.minutes) &&
    Number(e.minutes) >= 1 &&
    Number(e.minutes) <= 240 &&
    Array.isArray(e.relatedIds) &&
    e.relatedIds.length <= 20 &&
    e.relatedIds.every(slug) &&
    slug(a.id) &&
    e.authorId === a.id &&
    text(a.name, 80) &&
    Boolean(a.name.trim()) &&
    text(a.department, 80) &&
    text(a.year, 32) &&
    text(a.bio, 800) &&
    text(a.initials, 8)
  );
}
function receipt(v: unknown): v is PublicationReceipt {
  return (
    keys(v, ['contentId', 'sourceVersion', 'entry', 'author']) &&
    uuid(v.contentId) &&
    Number.isSafeInteger(v.sourceVersion) &&
    Number(v.sourceVersion) >= 1 &&
    article({ entry: v.entry, author: v.author }) &&
    v.contentId === (v.entry as Entry).id
  );
}
export function matchesPublication(value: PublicationReceipt, attempt: PublicationAttempt) {
  const e = value.entry,
    m = attempt.metadata,
    a = attempt.author;
  return (
    value.sourceVersion === attempt.draft.version &&
    e.title === attempt.draft.title &&
    e.body === attempt.draft.body &&
    e.summary === m.summary &&
    JSON.stringify(e.tags) === JSON.stringify(m.tags) &&
    e.minutes === m.minutes &&
    e.audience === m.audience &&
    e.prerequisite === m.prerequisite &&
    e.outcome === m.outcome &&
    value.author.id === a.id &&
    value.author.name === a.displayName &&
    value.author.department === a.department &&
    value.author.year === a.yearLabel &&
    value.author.bio === a.bio &&
    value.author.initials === a.initials
  );
}
/** Relative bounded transport, with no automatic publication retry or private title/body in POST. */
export function createPublicationClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  async function request(path: string, value?: unknown, anonymous = false): Promise<unknown> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    };
    const work = (async () => {
      const response = await fetcher(path, {
        method: value === undefined ? 'GET' : 'POST',
        credentials: anonymous ? 'omit' : 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers:
          value === undefined
            ? { Accept: 'application/json' }
            : {
                Accept: 'application/json',
                'Content-Type': 'application/json; charset=utf-8',
                Authorization: proofAuthorization('csrf', csrfToken),
              },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
      if (
        expired ||
        response.status !== (value === undefined ? 200 : 201) ||
        !response.body ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new PublicationClientError();
      }
      const length = response.headers.get('Content-Length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 2097152)
      ) {
        void response.body.cancel().catch(() => {});
        throw new PublicationClientError();
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(2097152);
      let size = 0;
      let count = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (expired) throw new PublicationClientError();
          if (next.done) break;
          if (++count > 65536 || size + next.value.byteLength > bytes.length)
            throw new PublicationClientError();
          bytes.set(next.value, size);
          size += next.value.byteLength;
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
        expired = true;
        cancel();
        reject(new PublicationClientError());
      }, 10000);
    });
    try {
      return await Promise.race([work, deadline]);
    } catch {
      throw new PublicationClientError();
    } finally {
      clearTimeout(timer);
      cancel();
    }
  }
  const privatePath = (id: string) => {
    if (!uuid(id)) throw new PublicationClientError();
    return '/api/private/publications/' + id;
  };
  return {
    async read(id: string): Promise<PublicationReceipt | null> {
      const result = await request(privatePath(id));
      if (
        !keys(result, ['publication']) ||
        (result.publication !== null && !receipt(result.publication))
      )
        throw new PublicationClientError();
      return result.publication as PublicationReceipt | null;
    },
    async publish(
      id: string,
      version: number,
      value: PublicationMetadata,
      confirmed: boolean,
    ): Promise<string> {
      const metadata = checkedMetadata(value);
      if (!confirmed || !Number.isSafeInteger(version) || version < 1 || !metadata)
        throw new PublicationClientError();
      const result = await request(privatePath(id), {
        expectedVersion: version,
        confirmPublic: true,
        ...metadata,
      });
      if (!keys(result, ['contentId']) || !uuid(result.contentId))
        throw new PublicationClientError();
      return result.contentId;
    },
    async readArticle(id: string): Promise<{ entry: Entry; author: Profile }> {
      if (!uuid(id)) throw new PublicationClientError();
      const result = await request('/__lab/articles/' + id, undefined, true);
      if (!article(result) || result.entry.id !== id) throw new PublicationClientError();
      return result;
    },
  };
}
