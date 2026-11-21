import { describe, expect, it } from 'vitest';
import { japanDate, MAX_JAPAN_DATE_MS } from '../worker/japan-date';

describe('japanDate (#142)', () => {
  it('uses the calendar day in Japan, not UTC', () => {
    expect(japanDate(Date.UTC(2026, 10, 20, 14, 59, 59, 999))).toBe('2026-11-20');
    expect(japanDate(Date.UTC(2026, 10, 20, 15))).toBe('2026-11-21');
    expect(japanDate(Date.UTC(2026, 10, 20, 18, 2))).toBe('2026-11-21');
    expect(japanDate(Date.UTC(2026, 11, 31, 15))).toBe('2027-01-01');
  });
  it('rejects values that cannot be a stored publication instant', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_JAPAN_DATE_MS + 1])
      expect(japanDate(bad)).toBeNull();
    expect(japanDate(MAX_JAPAN_DATE_MS)).toBe('9999-12-31');
    expect(japanDate(0)).toBe('1970-01-01');
  });
});
