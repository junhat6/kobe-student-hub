import { readAnonymousJson } from '../editor/anonymous-public-read';
import {
  publicKeys,
  publicSlug,
  publicText,
  validPublicSummary,
} from '../editor/public-author-client';
import type { PublicDiscoveryCard } from '../types';
import type { OrdinaryDiscovery, RelatedDiscovery } from './discovery-types';
import { publicMomentKeys } from '../shared/display';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function author(value: unknown): boolean {
  return (
    publicKeys(value, ['id', 'name', 'department', 'year', 'initials']) &&
    publicSlug(value.id) &&
    publicText(value.name, 80) &&
    !!value.name.trim() &&
    publicText(value.department, 80) &&
    publicText(value.year, 32) &&
    publicText(value.initials, 8)
  );
}
function article(value: unknown): value is PublicDiscoveryCard {
  return (
    publicKeys(value, ['entry', 'author']) &&
    validPublicSummary(value.entry) &&
    author(value.author)
  );
}
function unique(values: PublicDiscoveryCard[]): boolean {
  return new Set(values.map((value) => value.entry.id)).size === values.length;
}
export function validOrdinaryDiscovery(value: unknown): value is OrdinaryDiscovery {
  if (
    !publicKeys(value, ['recent', 'popular']) ||
    !Array.isArray(value.recent) ||
    value.recent.length > 20 ||
    !value.recent.every(article) ||
    !unique(value.recent) ||
    !Array.isArray(value.popular) ||
    value.popular.length > 6
  )
    return false;
  const popular = value.popular;
  return (
    popular.every(
      (row) =>
        publicKeys(row, ['entry', 'author', 'likeCount']) &&
        article({ entry: row.entry, author: row.author }) &&
        Number.isSafeInteger(row.likeCount) &&
        Number(row.likeCount) > 0,
    ) &&
    new Set(popular.map((row) => row.entry.id)).size === popular.length &&
    popular.every((row, i) => i === 0 || popular[i - 1].likeCount >= row.likeCount)
  );
}
export function validRelatedDiscovery(value: unknown, id: string): value is RelatedDiscovery {
  if (
    !publicKeys(value, ['articles', 'projects', 'linkedProjects']) ||
    !Array.isArray(value.articles) ||
    value.articles.length > 4 ||
    !Array.isArray(value.projects) ||
    value.projects.length > 3
  )
    return false;
  if (
    !value.articles.every(
      (row) =>
        publicKeys(row, ['entry', 'author', 'matchingTag']) &&
        validPublicSummary(row.entry) &&
        author(row.author) &&
        row.entry.id !== id &&
        publicText(row.matchingTag, 32) &&
        !!row.matchingTag.trim() &&
        row.entry.tags.includes(row.matchingTag),
    ) ||
    !unique(value.articles)
  )
    return false;
  const linked = value.linkedProjects;
  return (
    value.projects.every(
      (row) =>
        publicKeys(row, ['project', 'author', 'matchingTag']) &&
        projectCard(row) &&
        publicText(row.matchingTag, 32) &&
        !!row.matchingTag.trim(),
    ) &&
    Array.isArray(linked) &&
    linked.length <= 3 &&
    linked.every((row) => publicKeys(row, ['project', 'author']) && projectCard(row)) &&
    new Set([...linked, ...value.projects].map((row) => row.project.id)).size ===
      linked.length + value.projects.length
  );
}
function projectCard(row: Record<string, unknown>): boolean {
  return (
    publicMomentKeys(
      row.project,
      ['id', 'title', 'descriptionPreview', 'publishedOn'],
      'publishedOn',
    ) &&
    uuid(row.project.id) &&
    publicText(row.project.title, 200) &&
    !!row.project.title.trim() &&
    publicText(row.project.descriptionPreview, 300) &&
    typeof row.project.publishedOn === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.project.publishedOn) &&
    author(row.author)
  );
}
export function createOrdinaryDiscoveryClient(fetcher: typeof fetch = fetch) {
  return {
    async home(signal?: AbortSignal): Promise<OrdinaryDiscovery> {
      const value = await readAnonymousJson('/api/discovery', fetcher, signal);
      if (!validOrdinaryDiscovery(value)) throw Error('discovery_unavailable');
      return value;
    },
    async related(id: string, signal?: AbortSignal): Promise<RelatedDiscovery> {
      if (!uuid(id)) throw Error('discovery_unavailable');
      const value = await readAnonymousJson('/api/discovery/articles/' + id, fetcher, signal);
      if (!validRelatedDiscovery(value, id)) throw Error('discovery_unavailable');
      return value;
    },
  };
}
