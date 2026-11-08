import { publicPaths, type PublicSurface } from '../shared/public-paths';
import type { PublicLikedArticles } from '../types';
import { readAnonymousJson } from './anonymous-public-read';
import { publicKeys, publicSlug, publicText, validPublicSummary } from './public-author-client';
export class PublicLikesClientError extends Error {
  constructor() {
    super('公開いいねを確認できませんでした。');
    this.name = 'PublicLikesClientError';
  }
}
function valid(value: unknown, id: string): value is PublicLikedArticles {
  if (
    !publicKeys(value, ['profile', 'entries']) ||
    !publicKeys(value.profile, ['id', 'name', 'department', 'year', 'initials']) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 20
  )
    return false;
  const p = value.profile;
  return (
    p.id === id &&
    publicSlug(p.id) &&
    publicText(p.name, 80) &&
    Boolean(p.name.trim()) &&
    publicText(p.department, 80) &&
    publicText(p.year, 32) &&
    publicText(p.initials, 8) &&
    new Set(value.entries.map((e) => e?.id)).size === value.entries.length &&
    value.entries.every(validPublicSummary)
  );
}
export function createPublicLikesClient(
  fetcher: typeof fetch = fetch,
  surface: PublicSurface = 'lab',
) {
  return {
    async read(id: string, signal?: AbortSignal): Promise<PublicLikedArticles> {
      try {
        if (!publicSlug(id)) throw new PublicLikesClientError();
        const value = await readAnonymousJson(publicPaths(surface).likesApi(id), fetcher, signal);
        if (!valid(value, id)) throw new PublicLikesClientError();
        return value;
      } catch {
        throw new PublicLikesClientError();
      }
    },
  };
}
