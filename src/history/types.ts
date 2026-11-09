export type ReadingKind = 'article' | 'project';
export interface ReadingReference {
  kind: ReadingKind;
  contentId: string;
}
export interface ReadingHistoryEntry extends ReadingReference {
  lastViewedAt: number;
  title: string | null;
  isSample: boolean | null;
}
export interface ReadingHistoryPage {
  entries: ReadingHistoryEntry[];
  enabled: boolean;
  nextOffset: number | null;
  capacity: 500;
}
export function isReadingReference(value: unknown): value is ReadingReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join(',') === 'contentId,kind' &&
    (v.kind === 'article' || v.kind === 'project') &&
    typeof v.contentId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v.contentId)
  );
}
