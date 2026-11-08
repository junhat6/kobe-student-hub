import { publicPaths, type PublicSurface } from '../shared/public-paths';
import type { PublicDiscovery } from '../types';
import { readAnonymousJson } from './anonymous-public-read';
import { publicKeys, publicSlug, publicText, validPublicSummary } from './public-author-client';
export class PublicDiscoveryClientError extends Error {
  constructor() {
    super('公開記事を確認できませんでした。');
    this.name = 'PublicDiscoveryClientError';
  }
}
function valid(value: unknown): value is PublicDiscovery {
  if (!publicKeys(value, ['cards']) || !Array.isArray(value.cards) || value.cards.length > 20)
    return false;
  const ids = new Set<string>();
  return value.cards.every((card) => {
    if (
      !publicKeys(card, ['entry', 'author']) ||
      !validPublicSummary(card.entry) ||
      !publicKeys(card.author, ['id', 'name', 'department', 'year', 'initials'])
    )
      return false;
    const author = card.author;
    if (
      ids.has(card.entry.id) ||
      !publicSlug(author.id) ||
      !publicText(author.name, 80) ||
      !author.name.trim() ||
      !publicText(author.department, 80) ||
      !publicText(author.year, 32) ||
      !publicText(author.initials, 8)
    )
      return false;
    ids.add(card.entry.id);
    return true;
  });
}
export function createPublicDiscoveryClient(
  fetcher: typeof fetch = fetch,
  surface: PublicSurface = 'lab',
) {
  return {
    async read(signal?: AbortSignal): Promise<PublicDiscovery> {
      try {
        const value = await readAnonymousJson(publicPaths(surface).articlesApi, fetcher, signal);
        if (!valid(value)) throw new PublicDiscoveryClientError();
        return value;
      } catch {
        throw new PublicDiscoveryClientError();
      }
    },
  };
}
