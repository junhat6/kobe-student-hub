/**
 * Public dates are shown as the calendar day in Japan (UTC+9, no daylight saving time).
 * Storage keeps UTC milliseconds; only the displayed day is shifted, so a 03:00 JST
 * publication is not shown as the previous day.
 */
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;
/** Largest stored timestamp whose Japan day still has a four-digit year. */
export const MAX_JAPAN_DATE_MS = 253402300799999 - JAPAN_OFFSET_MS;

export function japanDate(ms: number): string | null {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_JAPAN_DATE_MS) return null;
  return new Date(ms + JAPAN_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Public publish time (#308) for a DTO, as UTC ISO 8601. Only returned when it is the time behind
 * the `day` already shown, so a reader never sees a time that disagrees with the public day.
 */
export function publicMoment(ms: unknown, day: string): string | undefined {
  return typeof ms === 'number' && japanDate(ms) === day ? new Date(ms).toISOString() : undefined;
}
