import { describe, expect, it } from 'vitest';
import { buildGrass } from '../src/community/grass';
import { validActivity } from '../src/community/student-client';
import { emptyActivity } from '../src/community/ActivityGrass';

// 2026-11-22 is a Sunday; the window is 182 days ending today.
const to = '2026-11-22';
const from = '2026-05-25';
describe('the grass layout', () => {
  it('lays days out as Monday-first weeks and pads outside the window', () => {
    const g = buildGrass({ from, to, days: [] });
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    expect(g.weeks[0][0].date).toBe('2026-05-25'); // a Monday
    expect(g.weeks.at(-1)![6].date).toBe(to);
    expect(g.weeks).toHaveLength(26);
    expect(g.total).toBe(0);
    expect(g.streakWeeks).toBe(0);
  });
  it('counts weekly streaks and keeps them alive while this week is still open', () => {
    const days = [
      { date: '2026-11-03', count: 1 },
      { date: '2026-11-10', count: 2 },
      { date: '2026-11-11', count: 5 },
    ];
    const open = buildGrass({ from, to: '2026-11-18', days });
    expect(open.thisWeek).toBe(false);
    expect(open.streakWeeks).toBe(2);
    const lit = buildGrass({
      from,
      to: '2026-11-18',
      days: [...days, { date: '2026-11-17', count: 1 }],
    });
    expect(lit.thisWeek).toBe(true);
    expect(lit.streakWeeks).toBe(3);
    expect(lit.total).toBe(9);
    expect(lit.activeDays).toBe(4);
    const cell = lit.weeks.flat().find((c) => c.date === '2026-11-11')!;
    expect(cell.level).toBe(3);
    expect(lit.weeks.flat().find((c) => c.date === '2026-11-19')!.outside).toBe(true);
  });
  it('a missed whole week ends the streak', () => {
    const g = buildGrass({ from, to, days: [{ date: '2026-11-03', count: 1 }] });
    expect(g.streakWeeks).toBe(0);
  });
  it('builds an empty window ending today in Japan', () => {
    // 2026-11-21T15:30Z is already 11-22 in Japan.
    expect(emptyActivity(Date.parse('2026-11-21T15:30:00Z'))).toEqual({ from, to, days: [] });
  });
});
describe('the grass transport', () => {
  it('accepts only bounded, ordered, in-window days', () => {
    expect(validActivity({ from, to, days: [{ date: '2026-11-10', count: 1 }] })).toBe(true);
    for (const bad of [
      { from, to, days: [], extra: 1 },
      { from, to, days: [{ date: '2026-11-10', count: 0 }] },
      { from, to, days: [{ date: '2026-11-10', count: 1, who: 'x' }] },
      { from, to, days: [{ date: '2026-12-01', count: 1 }] },
      {
        from,
        to,
        days: [
          { date: '2026-11-10', count: 1 },
          { date: '2026-11-10', count: 1 },
        ],
      },
      { from, to, days: [{ date: '2026-02-30', count: 1 }] },
      { from: to, to: from, days: [] },
    ])
      expect(validActivity(bad)).toBe(false);
  });
  it('shades the owner grass with the reading layer but keeps streaks about publishing', () => {
    const publicDays = { from, to, days: [{ date: '2026-11-20', count: 1 }] };
    const reading = {
      from,
      to,
      days: [
        { date: '2026-11-20', count: 1 },
        { date: '2026-11-21', count: 4 },
      ],
    };
    const g = buildGrass(publicDays, reading);
    const cell = (date: string) => g.weeks.flat().find((c) => c.date === date)!;
    expect(cell('2026-11-20')).toMatchObject({ count: 1, read: 1, level: 2 });
    expect(cell('2026-11-21')).toMatchObject({ count: 0, read: 4, level: 3 });
    expect(g.total).toBe(1);
    expect(g.readTotal).toBe(5);
    expect(g.streakWeeks).toBe(buildGrass(publicDays).streakWeeks);
    // A reading layer from another day's window is ignored rather than misaligned.
    expect(buildGrass(publicDays, { ...reading, to: '2026-11-21' }).readTotal).toBe(0);
    expect(
      buildGrass(publicDays)
        .weeks.flat()
        .every((c) => c.read === 0),
    ).toBe(true);
  });
});
