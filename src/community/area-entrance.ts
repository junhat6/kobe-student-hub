import type { PublicDiscoveryCard } from '../types';

// DECISIONS 2026-11-22「北野川線沿い」3: the area entrance appears only once enough published
// reviews exist, so it never promises an empty list. The count comes from the existing public
// home read (newest 20 articles); no new API or column is added.
export const AREA_ENTRANCE = {
  areaTag: '北野川線沿い',
  kindTag: 'ごはん',
  minimum: 3,
  title: '北野川線沿いのごはん',
  description: '三宮の北、加納町・生田のあたりを南北に走る通り沿いの店のレビュー',
} as const;

const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ja');

export function areaEntranceCount(cards: readonly PublicDiscoveryCard[]): number {
  const area = normalized(AREA_ENTRANCE.areaTag),
    kind = normalized(AREA_ENTRANCE.kindTag);
  return cards.filter(({ entry }) => {
    const tags = entry.tags.map(normalized);
    return tags.includes(area) && tags.includes(kind);
  }).length;
}

export const areaEntrancePath = '/search?' + new URLSearchParams({ tag: AREA_ENTRANCE.areaTag });
