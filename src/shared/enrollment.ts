/** App participation convention, not a school enrollment verification or official calendar. */
export const ENROLLMENT_POLICY_VERSION = 1;
export interface EnrollmentYears {
  admissionYear: number;
  graduationYear: number;
}
export interface OwnEnrollmentRecord extends EnrollmentYears {
  version: number;
  updatedAtMs: number;
}
export type EnrollmentParticipation = 'missing' | 'upcoming' | 'current' | 'ended';
export interface OwnEnrollmentResult {
  enrollment: OwnEnrollmentRecord | null;
  participation: EnrollmentParticipation;
}
const year = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= 2199;

/** Only the two self-declared academic years; no client identity or eligibility flag. */
export function canonicalEnrollmentYears(value: unknown): EnrollmentYears | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return null;
  const input = value as Record<string, unknown>,
    keys = Reflect.ownKeys(input);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(input, 'admissionYear') ||
    !Object.hasOwn(input, 'graduationYear') ||
    !year(input.admissionYear) ||
    !year(input.graduationYear) ||
    input.graduationYear < input.admissionYear
  )
    return null;
  return { admissionYear: input.admissionYear, graduationYear: input.graduationYear };
}

/** Apr 1 00:00 Asia/Tokyo inclusive, through Apr 1 after graduation AY exclusive. */
export function enrollmentWindow(
  value: EnrollmentYears,
): { startsAtMs: number; endsAtMs: number } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const years = canonicalEnrollmentYears({
    admissionYear: value.admissionYear,
    graduationYear: value.graduationYear,
  });
  if (!years) return null;
  return {
    startsAtMs: Date.UTC(years.admissionYear, 3, 1) - 9 * 60 * 60 * 1000,
    endsAtMs: Date.UTC(years.graduationYear + 1, 3, 1) - 9 * 60 * 60 * 1000,
  };
}

/** Invalid clocks or records cannot be treated as participation. */
export function enrollmentParticipation(
  years: EnrollmentYears | null,
  nowMs: number,
): EnrollmentParticipation | null {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  if (years === null) return 'missing';
  const window = enrollmentWindow(years);
  if (!window) return null;
  return nowMs < window.startsAtMs ? 'upcoming' : nowMs < window.endsAtMs ? 'current' : 'ended';
}
