import type { Catalog } from './types';
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');
export function isCatalog(v: unknown): v is Catalog {
  return (
    obj(v) &&
    v.mode === 'sample' &&
    Array.isArray(v.entries) &&
    Array.isArray(v.profiles) &&
    v.entries.every(
      (e) =>
        obj(e) &&
        [
          'id',
          'title',
          'summary',
          'body',
          'authorId',
          'audience',
          'prerequisite',
          'outcome',
          'updatedAt',
        ].every((k) => typeof e[k] === 'string') &&
        (e.kind === 'article' || e.kind === 'project') &&
        strings(e.tags) &&
        strings(e.relatedIds) &&
        typeof e.minutes === 'number' &&
        Number.isFinite(e.minutes) &&
        e.minutes > 0,
    ) &&
    v.profiles.every(
      (p) =>
        obj(p) &&
        ['id', 'name', 'department', 'year', 'bio', 'initials'].every(
          (k) => typeof p[k] === 'string',
        ),
    )
  );
}
