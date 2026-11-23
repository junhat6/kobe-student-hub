import type { OwnEnrollmentResult } from '../shared/enrollment';
import { readBoundedJson } from '../shared/http-client';

export interface EnrollmentInput {
  admissionYear: number;
  graduationYear: number;
  expectedVersion: number;
}
export class EnrollmentClientError extends Error {
  constructor() {
    super('年度の保存状態を確認できませんでした。');
    this.name = 'EnrollmentClientError';
  }
}
const LIMIT = 4096;
const keys = (value: unknown, wanted: readonly string[]): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).length === wanted.length &&
  wanted.every((key) => Object.hasOwn(value, key));
const year = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1900 && Number(value) <= 2199;
const integer = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
function validInput(value: unknown): value is EnrollmentInput {
  return (
    keys(value, ['admissionYear', 'graduationYear', 'expectedVersion']) &&
    year(value.admissionYear) &&
    year(value.graduationYear) &&
    value.graduationYear >= value.admissionYear &&
    integer(value.expectedVersion, 0) &&
    value.expectedVersion < Number.MAX_SAFE_INTEGER
  );
}
function result(value: unknown): value is OwnEnrollmentResult {
  if (!keys(value, ['enrollment', 'participation'])) return false;
  if (value.enrollment === null) return value.participation === 'missing';
  const record = value.enrollment;
  return (
    keys(record, ['admissionYear', 'graduationYear', 'version', 'updatedAtMs']) &&
    year(record.admissionYear) &&
    year(record.graduationYear) &&
    record.graduationYear >= record.admissionYear &&
    integer(record.version, 1) &&
    integer(record.updatedAtMs, 0) &&
    typeof value.participation === 'string' &&
    ['upcoming', 'current', 'ended'].includes(value.participation)
  );
}

/** Private account data only. No persistence, identity defaults, or mutation retries. */
export function createEnrollmentClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  async function request(
    value?: EnrollmentInput,
    signal?: AbortSignal,
  ): Promise<OwnEnrollmentResult> {
    let parsed: unknown;
    try {
      parsed = await readBoundedJson('/api/private/enrollment', {
        fetcher,
        credentials: 'same-origin',
        method: value ? 'PUT' : 'GET',
        maxBytes: LIMIT,
        exactLength: true,
        signal,
        ...(value ? { body: value, csrf: csrfToken } : {}),
      });
    } catch {
      throw new EnrollmentClientError();
    }
    if (
      !result(parsed) ||
      (value &&
        (!parsed.enrollment ||
          parsed.enrollment.admissionYear !== value.admissionYear ||
          parsed.enrollment.graduationYear !== value.graduationYear ||
          parsed.enrollment.version !== value.expectedVersion + 1))
    )
      throw new EnrollmentClientError();
    return parsed;
  }
  return {
    read: (signal?: AbortSignal) => request(undefined, signal),
    save: (value: EnrollmentInput, signal?: AbortSignal) => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(csrfToken) || !validInput(value))
        return Promise.reject(new EnrollmentClientError());
      return request({ ...value }, signal);
    },
  };
}
