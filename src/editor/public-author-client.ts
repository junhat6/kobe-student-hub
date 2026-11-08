import { publicPaths, type PublicSurface } from '../shared/public-paths';
import { readAnonymousJson } from './anonymous-public-read';
import type { PublicAuthorArticles } from '../types';
import { canonicalTags } from './publication-client';
export class PublicAuthorClientError extends Error {
  constructor() {
    super('投稿者の公開情報を確認できませんでした。');
    this.name = 'PublicAuthorClientError';
  }
}
export const publicSlug = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export const publicKeys = (v: unknown, wanted: string[]): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === wanted.length &&
  wanted.every((key) => Object.hasOwn(v, key));
export const publicText = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length <= max * 2 &&
  !v.includes('\0') &&
  Array.from(v).length <= max &&
  new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(v)) === v;
export function validPublicSummary(
  entry: unknown,
): entry is import('../types').PublishedArticleSummary {
  if (
    !publicKeys(entry, [
      'id',
      'title',
      'summary',
      'tags',
      'audience',
      'prerequisite',
      'outcome',
      'updatedAt',
      'minutes',
    ])
  )
    return false;
  const tags = canonicalTags(entry.tags);
  return (
    uuid(entry.id) &&
    publicText(entry.title, 200) &&
    Boolean(entry.title.trim()) &&
    publicText(entry.summary, 300) &&
    tags !== null &&
    JSON.stringify(tags) === JSON.stringify(entry.tags) &&
    publicText(entry.audience, 200) &&
    publicText(entry.prerequisite, 200) &&
    publicText(entry.outcome, 200) &&
    typeof entry.updatedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.updatedAt) &&
    Number.isInteger(entry.minutes) &&
    Number(entry.minutes) >= 1 &&
    Number(entry.minutes) <= 240
  );
}
export function validPublicProfile(
  author: unknown,
  authorId: string,
): author is import('../types').Profile {
  return (
    publicKeys(author, ['id', 'name', 'department', 'year', 'bio', 'initials']) &&
    author.id === authorId &&
    publicSlug(author.id) &&
    publicText(author.name, 80) &&
    Boolean(author.name.trim()) &&
    publicText(author.department, 80) &&
    publicText(author.year, 32) &&
    publicText(author.bio, 800) &&
    publicText(author.initials, 8)
  );
}
function valid(value: unknown, authorId: string): value is PublicAuthorArticles {
  if (
    !publicKeys(value, ['author', 'entries']) ||
    !validPublicProfile(value.author, authorId) ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > 20
  )
    return false;
  return (
    new Set(value.entries.map((entry) => entry?.id)).size === value.entries.length &&
    value.entries.every(validPublicSummary)
  );
}
/** Anonymous, bounded read only. No session bootstrap, CSRF or cookie transmission. */
export function createPublicAuthorClient(
  fetcher: typeof fetch = fetch,
  surface: PublicSurface = 'lab',
) {
  return {
    async read(authorId: string, signal?: AbortSignal): Promise<PublicAuthorArticles> {
      try {
        if (!publicSlug(authorId)) throw new PublicAuthorClientError();
        const result = await readAnonymousJson(
          publicPaths(surface).authorApi(authorId),
          fetcher,
          signal,
        );
        if (!valid(result, authorId)) throw new PublicAuthorClientError();
        return result;
      } catch {
        throw new PublicAuthorClientError();
      }
    },
  };
}
