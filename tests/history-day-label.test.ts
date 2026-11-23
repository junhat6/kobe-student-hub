import { describe, expect, it } from 'vitest';
import { dayLabel } from '../src/history/HistoryPage';

// #229: the history groups rows under 今日・昨日・date headings like YouTube・Chrome.
describe('history day label', () => {
  const now = new Date(2026, 10, 23, 9, 30).getTime();
  it('names today and yesterday, including just after midnight', () => {
    expect(dayLabel(new Date(2026, 10, 23, 0, 0).getTime(), now)).toBe('今日');
    expect(dayLabel(new Date(2026, 10, 22, 23, 59).getTime(), now)).toBe('昨日');
    expect(dayLabel(new Date(2026, 10, 22, 0, 0).getTime(), now)).toBe('昨日');
  });
  it('uses the month and day this year and adds the year otherwise', () => {
    expect(dayLabel(new Date(2026, 10, 20, 12).getTime(), now)).toBe('11月20日');
    expect(dayLabel(new Date(2025, 10, 23, 12).getTime(), now)).toBe('2025年11月23日');
  });
  it('treats the last day of the previous month and year as yesterday', () => {
    expect(dayLabel(new Date(2026, 9, 31, 20).getTime(), new Date(2026, 10, 1, 8).getTime())).toBe(
      '昨日',
    );
    expect(dayLabel(new Date(2025, 11, 31, 20).getTime(), new Date(2026, 0, 1, 8).getTime())).toBe(
      '昨日',
    );
  });
});
