/** Presentation helpers shared by cards and detail pages. */
export function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : value;
}

const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** The public publish time a Worker adds next to the day (#308): UTC ISO 8601 with milliseconds. */
const PUBLIC_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Japan calendar day (`YYYY-MM-DD`) of a public publish time, or null when it is not one. */
export function japanDayOf(iso: unknown): string | null {
  if (typeof iso !== 'string' || !PUBLIC_MOMENT.test(iso)) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== iso) return null;
  return new Date(ms + JAPAN_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Decoder helper: the object has exactly `wanted`, or `wanted` plus a `publishedAt` whose Japan day
 * is the object's `dayKey`. A Worker from before #308 sends no time, so both shapes stay valid.
 */
export function publicMomentKeys(
  v: unknown,
  wanted: string[],
  dayKey: string,
): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const withMoment = Object.hasOwn(v, 'publishedAt');
  const expected = withMoment ? [...wanted, 'publishedAt'] : wanted;
  const record = v as Record<string, unknown>;
  return (
    Object.keys(v).length === expected.length &&
    expected.every((key) => Object.hasOwn(v, key)) &&
    (!withMoment || japanDayOf(record.publishedAt) === record[dayKey])
  );
}

/**
 * How long ago something was published, for public cards, detail pages, journals and notices:
 * たった今 / N分前 / N時間前 / N日前, then the day (`YYYY.MM.DD`) from 7 days on.
 * A time in the future (the device clock is behind) reads as たった今. Without a time (an older
 * Worker or the sample catalog) the day is shown as before.
 */
export function formatPublicTime(day: string, iso?: string, now: number = Date.now()): string {
  const at = iso === undefined || japanDayOf(iso) === null ? NaN : Date.parse(iso);
  if (!Number.isFinite(at)) return formatDate(day);
  const elapsed = now - at;
  if (elapsed < MINUTE_MS) return 'たった今';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}分前`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}時間前`;
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}日前`;
  return formatDate(japanDayOf(iso)!);
}

/** Absolute Japan time for a `<time title>`, e.g. 2026年11月27日 15:04. */
export function japanDateTimeTitle(iso: string): string | undefined {
  const day = japanDayOf(iso);
  if (!day) return undefined;
  const local = new Date(Date.parse(iso) + JAPAN_OFFSET_MS).toISOString();
  return `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日 ${local.slice(11, 16)}`;
}

/** Stable, decorative hue per tag so cards are distinguishable without images. */
export function tagHue(text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  const hues = [212, 168, 262, 28, 340, 190, 132, 8];
  return String(hues[hash % hues.length]);
}
