import type { PublicProjectDiscovery } from '../project-types';
import { readAnonymousJson } from './anonymous-public-read';
import { publicKeys, publicText, publicSlug } from './public-author-client';
import { projectUUID } from './project-client';
export class PublicWorksClientError extends Error {
  constructor() {
    super('公開作品を確認できませんでした。');
    this.name = 'PublicWorksClientError';
  }
}
function date(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}
function valid(value: unknown): value is PublicProjectDiscovery {
  if (!publicKeys(value, ['cards']) || !Array.isArray(value.cards) || value.cards.length > 20)
    return false;
  const seen = new Set<string>();
  return value.cards.every((card) => {
    if (
      !publicKeys(card, ['project', 'author']) ||
      !publicKeys(card.project, ['id', 'title', 'descriptionPreview', 'publishedOn']) ||
      !publicKeys(card.author, ['id', 'name', 'department', 'year', 'initials'])
    )
      return false;
    const p = card.project,
      a = card.author;
    if (
      !projectUUID(p.id) ||
      seen.has(p.id) ||
      !publicText(p.title, 200) ||
      !p.title.trim() ||
      !publicText(p.descriptionPreview, 300) ||
      !date(p.publishedOn) ||
      !publicSlug(a.id) ||
      !publicText(a.name, 80) ||
      !a.name.trim() ||
      !publicText(a.department, 80) ||
      !publicText(a.year, 32) ||
      !publicText(a.initials, 8)
    )
      return false;
    seen.add(p.id);
    return true;
  });
}
export function createPublicWorksClient(fetcher: typeof fetch = fetch) {
  return {
    async read(signal?: AbortSignal): Promise<PublicProjectDiscovery> {
      try {
        const value = await readAnonymousJson('/__lab/project-discovery', fetcher, signal);
        if (!valid(value)) throw new PublicWorksClientError();
        return value;
      } catch {
        throw new PublicWorksClientError();
      }
    },
  };
}
