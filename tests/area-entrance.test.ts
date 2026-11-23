import { describe, it, expect } from 'vitest';
import { AREA_ENTRANCE, areaEntranceCount, areaEntrancePath } from '../src/community/area-entrance';
import type { PublicDiscoveryCard } from '../src/types';

// #194: fictional cards only; no sample review is shipped or stored.
const card = (n: number, tags: string[]): PublicDiscoveryCard => ({
  entry: {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    title: '架空の記事' + n,
    summary: '架空の要約',
    tags,
    audience: '',
    prerequisite: '',
    outcome: '',
    updatedAt: '2026-11-24',
    minutes: 1,
  },
  author: { id: 'fictional-author', name: '架空投稿者', department: '', year: '', initials: '架' },
});

describe('北野川線沿いのごはん entrance threshold', () => {
  const both = ['北野川線沿い', 'ごはん'];
  it('counts only articles carrying both the area and the meal tag', () => {
    const cards = [card(1, both), card(2, ['北野川線沿い']), card(3, ['ごはん', 'ラーメン'])];
    expect(areaEntranceCount(cards)).toBe(1);
  });
  it('stays below the minimum with two and reaches it with three', () => {
    const two = [card(1, both), card(2, both), card(3, ['ごはん'])];
    expect(areaEntranceCount(two)).toBe(2);
    expect(areaEntranceCount(two) >= AREA_ENTRANCE.minimum).toBe(false);
    const three = [...two, card(4, ['ごはん', 'ラーメン', '北野川線沿い'])];
    expect(areaEntranceCount(three)).toBe(3);
    expect(areaEntranceCount(three) >= AREA_ENTRANCE.minimum).toBe(true);
  });
  it('links to the area tag search', () => {
    expect(decodeURIComponent(areaEntrancePath)).toBe('/search?tag=北野川線沿い');
  });
});
