import { publicPaths, type PublicSurface } from '../shared/public-paths';
import { boundedReadFailure, readBoundedJson } from '../shared/http-client';
import { validMediaIds } from '../shared/media';
import type { Entry, Profile, PublishedArticleDetail } from '../types';
import type { EditorDraft } from './draft-client';
import type { PublicProfile } from './profile-client';
import { publicMomentKeys } from '../shared/display';
export interface PublicationMetadata {
  summary: string;
  tags: string[];
  /**
   * Reading time in minutes. Left out by the publish panel (#307): the server derives it from the
   * draft body. Still sent when an agent suggested one, so existing routes keep working.
   */
  minutes?: number;
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
  /** Absent or not public (404 / impossible id), as opposed to a failed read. */
  readonly missing: boolean;
  constructor(missing = false) {
    super('記事の公開状態を確認できませんでした。');
    this.name = 'PublicationClientError';
    this.missing = missing;
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
  const fields = ['summary', 'tags', 'audience', 'prerequisite', 'outcome'];
  if (
    !(keys(v, fields) || keys(v, [...fields, 'minutes'])) ||
    !text(v.summary, 300) ||
    (v.minutes !== undefined &&
      (!Number.isInteger(v.minutes) || Number(v.minutes) < 1 || Number(v.minutes) > 240)) ||
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
        ...(v.minutes === undefined ? {} : { minutes: v.minutes as number }),
        audience: v.audience,
        prerequisite: v.prerequisite,
        outcome: v.outcome,
      }
    : null;
}
function publicationDates(v: unknown, updatedAt: unknown): boolean {
  return (
    publicMomentKeys(v, ['publishedOn', 'revised'], 'publishedOn') &&
    typeof v.publishedOn === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.publishedOn) &&
    typeof updatedAt === 'string' &&
    v.publishedOn <= updatedAt &&
    typeof v.revised === 'boolean'
  );
}
function article(v: unknown): v is PublishedArticleDetail {
  if (
    !(
      keys(v, ['entry', 'author']) ||
      (keys(v, ['entry', 'author', 'publication']) &&
        typeof v.entry === 'object' &&
        v.entry !== null &&
        publicationDates(v.publication, (v.entry as Record<string, unknown>).updatedAt))
    ) ||
    !publicMomentKeys(
      v.entry,
      [
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
      ],
      'updatedAt',
    ) ||
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
    (m.minutes === undefined || e.minutes === m.minutes) &&
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
export function createPublicationClient(
  csrfToken: string,
  fetcher: typeof fetch = fetch,
  surface: PublicSurface = 'lab',
) {
  /** Private reads/writes and the anonymous article read go through the one bounded transport (#189). */
  async function request(path: string, value?: unknown, anonymous = false): Promise<unknown> {
    try {
      return await readBoundedJson(path, {
        fetcher,
        credentials: anonymous ? 'omit' : 'same-origin',
        method: value === undefined ? 'GET' : 'POST',
        status: value === undefined ? 200 : 201,
        // A published body is up to 256 KiB, and JSON escaping can multiply it; keep the 2 MiB cap.
        maxBytes: 2097152,
        // Only a publication carries a body and the CSRF proof; reads carry neither.
        ...(value === undefined ? {} : { csrf: csrfToken, body: value }),
      });
    } catch (error) {
      // Only the anonymous reader distinguishes "absent or not public"; private reads stay opaque.
      throw new PublicationClientError(
        anonymous && value === undefined && boundedReadFailure(error) === 'missing',
      );
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
      mediaIds: string[] = [],
      expectedPublicationVersion?: number,
    ): Promise<string> {
      const metadata = checkedMetadata(value);
      if (
        !confirmed ||
        !Number.isSafeInteger(version) ||
        version < 1 ||
        !metadata ||
        !validMediaIds(mediaIds) ||
        (expectedPublicationVersion !== undefined &&
          (!Number.isSafeInteger(expectedPublicationVersion) || expectedPublicationVersion < 1))
      )
        throw new PublicationClientError();
      const result = await request(privatePath(id), {
        expectedVersion: version,
        ...(expectedPublicationVersion === undefined ? {} : { expectedPublicationVersion }),
        confirmPublic: true,
        ...metadata,
        ...(mediaIds.length ? { mediaIds } : {}),
      });
      if (!keys(result, ['contentId']) || !uuid(result.contentId))
        throw new PublicationClientError();
      return result.contentId;
    },
    async readArticle(id: string): Promise<PublishedArticleDetail> {
      if (!uuid(id)) throw new PublicationClientError(true);
      const result = await request(publicPaths(surface).articleApi(id), undefined, true);
      if (!article(result) || result.entry.id !== id) throw new PublicationClientError();
      return result;
    },
  };
}
