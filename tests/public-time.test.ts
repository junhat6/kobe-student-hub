import { describe, expect, it } from 'vitest';
import {
  formatPublicTime,
  japanDateTimeTitle,
  japanDayOf,
  publicMomentKeys,
} from '../src/shared/display';

// 2026-11-27 15:00 JST.
const at = '2026-11-27T06:00:00.000Z';
const base = Date.parse(at);
const S = 1000,
  M = 60 * S,
  H = 60 * M,
  D = 24 * H;
const show = (elapsed: number) => formatPublicTime('2026-11-27', at, base + elapsed);

describe('public time wording (#308)', () => {
  it('reads relative at each boundary and the day from 7 days on', () => {
    expect(show(0)).toBe('たった今');
    expect(show(59 * S)).toBe('たった今');
    expect(show(60 * S)).toBe('1分前');
    expect(show(59 * M)).toBe('59分前');
    expect(show(60 * M)).toBe('1時間前');
    expect(show(23 * H)).toBe('23時間前');
    expect(show(24 * H - 1)).toBe('23時間前');
    expect(show(24 * H)).toBe('1日前');
    expect(show(6 * D)).toBe('6日前');
    expect(show(7 * D - 1)).toBe('6日前');
    expect(show(7 * D)).toBe('2026.11.27');
  });
  it('treats a future time (device clock behind) as たった今', () => {
    expect(show(-5 * M)).toBe('たった今');
  });
  it('falls back to the day when the Worker sent no time or a malformed one', () => {
    expect(formatPublicTime('2026-11-20', undefined, base)).toBe('2026.11.20');
    expect(formatPublicTime('2026-11-20', '2026-11-27 06:00', base)).toBe('2026.11.20');
    expect(formatPublicTime('2026-11-20', '2026-02-30T00:00:00.000Z', base)).toBe('2026.11.20');
  });
  it('shows the Japan day, not the UTC day, once a week has passed', () => {
    // 2026-11-01 23:30 UTC is 2026-11-02 08:30 in Japan.
    expect(formatPublicTime('2026-11-02', '2026-11-01T23:30:00.000Z', base)).toBe('2026.11.02');
    expect(japanDayOf('2026-11-01T23:30:00.000Z')).toBe('2026-11-02');
    expect(japanDateTimeTitle('2026-11-01T23:30:00.000Z')).toBe('2026年11月2日 08:30');
  });
});

describe('public DTO time field', () => {
  const wanted = ['id', 'publishedOn'];
  it('accepts a response with or without the time (older Worker)', () => {
    expect(publicMomentKeys({ id: 'a', publishedOn: '2026-11-27' }, wanted, 'publishedOn')).toBe(
      true,
    );
    expect(
      publicMomentKeys(
        { id: 'a', publishedOn: '2026-11-27', publishedAt: at },
        wanted,
        'publishedOn',
      ),
    ).toBe(true);
  });
  it('rejects a time whose Japan day is not the shown day, or extra keys', () => {
    expect(
      publicMomentKeys(
        { id: 'a', publishedOn: '2026-11-26', publishedAt: at },
        wanted,
        'publishedOn',
      ),
    ).toBe(false);
    expect(
      publicMomentKeys(
        { id: 'a', publishedOn: '2026-11-27', publishedAt: 1764223200000 },
        wanted,
        'publishedOn',
      ),
    ).toBe(false);
    expect(
      publicMomentKeys(
        { id: 'a', publishedOn: '2026-11-27', draftSavedAt: at },
        wanted,
        'publishedOn',
      ),
    ).toBe(false);
  });
});
