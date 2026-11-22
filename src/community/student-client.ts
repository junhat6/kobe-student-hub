import { publicReadMissing, readAnonymousJson } from '../editor/anonymous-public-read';
import {
  publicKeys,
  publicSlug,
  validPublicProfile,
  validPublicSummary,
} from '../editor/public-author-client';
import { validProjectAuthor } from '../editor/project-client';
import { validPublicAvatar } from '../shared/avatar';
import type { PublicStudent, PublicStudentActivity } from '../public-student-types';

export class PublicStudentClientError extends Error {
  /** Absent or not public (404 / impossible id), as opposed to a failed read. */
  readonly missing: boolean;
  constructor(missing = false) {
    super('投稿者の公開情報を確認できませんでした。');
    this.name = 'PublicStudentClientError';
    this.missing = missing;
  }
}
function valid(value: unknown, id: string): value is PublicStudent {
  if (
    !publicKeys(value, ['author', 'avatar', 'entries', 'projects']) ||
    !validPublicProfile(value.author, id) ||
    !validPublicAvatar(value.avatar, id) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.projects) ||
    value.entries.length > 20 ||
    value.projects.length > 20 ||
    value.entries.length + value.projects.length === 0
  )
    return false;
  return (
    value.entries.every(validPublicSummary) &&
    new Set(value.entries.map((entry) => entry?.id)).size === value.entries.length &&
    (value.projects.length === 0 ||
      validProjectAuthor({ author: value.author, projects: value.projects }, id))
  );
}
const isoDay = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
export function validActivity(value: unknown): value is PublicStudentActivity {
  if (!publicKeys(value, ['from', 'to', 'days'])) return false;
  const { from, to, days } = value;
  if (!isoDay(from) || !isoDay(to) || from > to || !Array.isArray(days) || days.length > 400)
    return false;
  let previous = '';
  for (const day of days) {
    if (!publicKeys(day, ['date', 'count']) || !isoDay(day.date)) return false;
    if (day.date <= previous || day.date < from || day.date > to) return false;
    if (!Number.isSafeInteger(day.count) || (day.count as number) < 1 || (day.count as number) > 99)
      return false;
    previous = day.date;
  }
  return true;
}
/** Ordinary anonymous profile, with both bounded public activity selections in one DTO. */
export function createPublicStudentClient(fetcher: typeof fetch = fetch) {
  return {
    async read(id: string, signal?: AbortSignal): Promise<PublicStudent> {
      if (!publicSlug(id)) throw new PublicStudentClientError(true);
      try {
        const value = await readAnonymousJson('/api/students/' + id, fetcher, signal);
        if (!valid(value, id)) throw new PublicStudentClientError();
        return value;
      } catch (error) {
        throw new PublicStudentClientError(publicReadMissing(error));
      }
    },
    /** The public grass. Kept apart so a failed grass never hides the profile itself. */
    async readActivity(id: string, signal?: AbortSignal): Promise<PublicStudentActivity> {
      if (!publicSlug(id)) throw new PublicStudentClientError(true);
      try {
        const value = await readAnonymousJson(
          '/api/students/' + id + '/activity',
          fetcher,
          signal,
          32768,
        );
        if (!validActivity(value)) throw new PublicStudentClientError();
        return value;
      } catch (error) {
        throw new PublicStudentClientError(publicReadMissing(error));
      }
    },
  };
}
