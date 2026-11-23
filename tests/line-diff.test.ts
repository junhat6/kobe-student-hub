import { describe, expect, it } from 'vitest';
import { lineDiff } from '../src/shared/line-diff';

describe('bounded line diff (C23 materials)', () => {
  it('reports added and removed lines in order around unchanged ones', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual({
      added: 1,
      removed: 1,
      changes: [
        { op: '+', line: 'x' },
        { op: '-', line: 'b' },
      ],
      truncated: false,
      approximate: false,
    });
    expect(lineDiff('same', 'same')).toMatchObject({ added: 0, removed: 0, changes: [] });
    expect(lineDiff('', 'a\nb')).toMatchObject({ added: 2, removed: 0 });
  });
  it('caps returned lines and line length', () => {
    const many = Array.from({ length: 300 }, (_, i) => 'line ' + i).join('\n');
    const d = lineDiff('', many);
    expect(d.added).toBe(300);
    expect(d.changes).toHaveLength(120);
    expect(d.truncated).toBe(true);
    const long = lineDiff('', 'あ'.repeat(500));
    expect(Array.from(long.changes[0].line)).toHaveLength(201);
    expect(long.truncated).toBe(true);
  });
  it('stays bounded on large, fully different inputs', () => {
    const a = Array.from({ length: 5000 }, (_, i) => 'a' + i).join('\n');
    const b = Array.from({ length: 5000 }, (_, i) => 'b' + i).join('\n');
    const start = Date.now();
    const d = lineDiff(a, b);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(d).toMatchObject({ added: 2000, removed: 2000, truncated: true, approximate: true });
    expect(d.changes).toHaveLength(120);
  });
});
