import type { Catalog, Entry } from './types';
export function searchCatalog(catalog: Catalog, query: string, kind = 'all', tag = '') {
  const terms = query.trim().normalize('NFKC').toLocaleLowerCase('ja').split(/\s+/).filter(Boolean);
  const profileIds = new Set(catalog.profiles.filter(p => terms.every(t => `${p.name} ${p.department}`.toLocaleLowerCase('ja').includes(t))).map(p => p.id));
  return catalog.entries.filter(e => (kind === 'all' || e.kind === kind) && (!tag || e.tags.includes(tag)) && (terms.every(t => `${e.title} ${e.summary} ${e.tags.join(' ')} ${e.audience} ${e.prerequisite}`.normalize('NFKC').toLocaleLowerCase('ja').includes(t)) || profileIds.has(e.authorId))).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function relatedEntries(entry: Entry, entries: Entry[]) {
  return entries.filter(e => e.id !== entry.id).map(e => ({entry:e, score:entry.relatedIds.includes(e.id) ? 100 : e.tags.filter(t => entry.tags.includes(t)).length})).filter(e => e.score > 0).sort((a,b) => b.score-a.score).slice(0,3).map(e => e.entry);
}
