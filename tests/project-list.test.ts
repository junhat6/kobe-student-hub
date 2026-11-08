import { it, expect } from 'vitest';
import { mergeConfirmedProject } from '../src/editor/project-list';
const row = (id: string, version = 1, updatedAt = 1) => ({
  id,
  title: '確認済み ' + id,
  version,
  updatedAt,
});
it('merges one confirmed receipt without replacing other known rows and projects summary fields only', () => {
  const original = [row('a'), row('b', 2, 3)];
  const incoming = {
    ...row('a', 2, 4),
    title: '保存確認したタイトル',
    description: 'PRIVATE',
    githubUrl: 'PRIVATE',
    demoUrl: 'PRIVATE',
  };
  const merged = mergeConfirmedProject(original, incoming);
  expect(merged).toEqual([
    { id: 'a', title: '保存確認したタイトル', version: 2, updatedAt: 4 },
    row('b', 2, 3),
  ]);
  expect(Object.keys(merged[0]).sort()).toEqual(['id', 'title', 'updatedAt', 'version']);
  expect(original).toEqual([row('a'), row('b', 2, 3)]);
  expect(mergeConfirmedProject(original, row('c', 1, 5))).toEqual([
    row('c', 1, 5),
    row('b', 2, 3),
    row('a'),
  ]);
});
it('never regresses a known version or overwrites equal-version metadata from another response', () => {
  const current = { ...row('a', 3, 4), title: '既に確認済み' };
  for (const incoming of [
    { ...row('a', 2, 100), title: '古い応答' },
    { ...row('a', 3, 100), title: '同じ版の異なる応答' },
  ])
    expect(mergeConfirmedProject([current, row('b')], incoming)).toEqual([current, row('b')]);
  expect(mergeConfirmedProject([current], row('a', 4, 2))).toEqual([row('a', 4, 2)]);
});
it('bounds known rows to20 with updated-time order and deterministic ASCII ID ties', () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(String(i).padStart(2, '0'), 1, i));
  const result = mergeConfirmedProject(rows, row('new', 1, 100));
  expect(result).toHaveLength(20);
  expect(result[0]).toEqual(row('new', 1, 100));
  expect(result.some((r) => r.id === '00')).toBe(false);
  expect(rows).toHaveLength(20);
  expect(
    mergeConfirmedProject([row('a', 1, 5), row('A', 1, 5), row('Z', 1, 5)], row('b', 1, 5)).map(
      (r) => r.id,
    ),
  ).toEqual(['A', 'Z', 'a', 'b']);
});
