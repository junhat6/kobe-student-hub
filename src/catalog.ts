import type { Catalog, Entry } from './types';
export function searchCatalog(catalog: Catalog, query: string, kind = 'all', tag = '') {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja');
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const authors = new Map(catalog.profiles.map(p => [p.id, `${p.name} ${p.department}`]));
  return catalog.entries.filter(e => {
    if ((kind !== 'all' && e.kind !== kind) || (tag && !e.tags.includes(tag))) return false;
    const searchable = normalize(`${e.title} ${e.summary} ${e.tags.join(' ')} ${e.audience} ${e.prerequisite} ${authors.get(e.authorId) ?? ''}`);
    return terms.every(term => searchable.includes(term));
  }).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function relatedEntries(entry: Entry, entries: Entry[]) {
  return entries.filter(e => e.id !== entry.id).map(e => ({entry:e, score:entry.relatedIds.includes(e.id) ? 100 : e.tags.filter(t => entry.tags.includes(t)).length})).filter(e => e.score > 0).sort((a,b) => b.score-a.score).slice(0,3).map(e => e.entry);
}
