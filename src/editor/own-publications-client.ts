import { readBoundedJson } from '../shared/http-client';
import type { OwnPublications } from '../own-publication-types';
import { publicKeys, publicText } from './public-author-client';
import { projectUUID } from './project-client';
export class OwnPublicationsClientError extends Error {
  constructor() {
    super('自分の公開記録を確認できませんでした。');
    this.name = 'OwnPublicationsClientError';
  }
}
function valid(value: unknown): value is OwnPublications {
  if (
    !publicKeys(value, ['publications', 'moreExists']) ||
    typeof value.moreExists !== 'boolean' ||
    !Array.isArray(value.publications) ||
    value.publications.length > 20 ||
    (value.moreExists && value.publications.length !== 20)
  )
    return false;
  const seen = new Set<string>();
  return value.publications.every((row) => {
    if (
      !publicKeys(row, ['kind', 'publicId', 'title', 'status', 'publishedAt', 'sourceVersion']) ||
      (row.kind !== 'article' && row.kind !== 'project') ||
      !projectUUID(row.publicId) ||
      !publicText(row.title, 200) ||
      !row.title.trim() ||
      (row.status !== 'published' && row.status !== 'hidden' && row.status !== 'deleted') ||
      !Number.isSafeInteger(row.publishedAt) ||
      Number(row.publishedAt) < 0 ||
      Number(row.publishedAt) > 253402300799999 ||
      !Number.isSafeInteger(row.sourceVersion) ||
      Number(row.sourceVersion) < 1
    )
      return false;
    const key = row.kind + ':' + row.publicId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function createOwnPublicationsClient(fetcher: typeof fetch = fetch) {
  return {
    async read(signal?: AbortSignal): Promise<OwnPublications> {
      let result: unknown;
      try {
        result = await readBoundedJson('/api/private/own-publications', {
          fetcher,
          credentials: 'same-origin',
          method: 'GET',
          maxBytes: 65536,
          signal,
        });
      } catch {
        throw new OwnPublicationsClientError();
      }
      if (!valid(result)) throw new OwnPublicationsClientError();
      return result;
    },
  };
}
