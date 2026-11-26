import { publicReadMissing, readAnonymousJson } from '../editor/anonymous-public-read';
import {
  publicKeys,
  publicSlug,
  validPublicProfile,
  validPublicSummary,
} from '../editor/public-author-client';
import { validProjectAuthor } from '../editor/project-client';
import { validPublicAvatar } from '../shared/avatar';
import { validProfileLinks } from '../shared/profile-links';
import type {
  PublicAuthorCard,
  PublicReceivedLikes,
  PublicStudent,
  PublicStudentActivity,
} from '../public-student-types';

class PublicStudentClientError extends Error {
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
    !publicKeys(value, ['author', 'avatar', 'links', 'entries', 'projects']) ||
    !validPublicProfile(value.author, id) ||
    !validPublicAvatar(value.avatar, id) ||
    !validProfileLinks(value.links) ||
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
const ARTICLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validReceivedLikes(value: unknown): value is PublicReceivedLikes {
  if (!publicKeys(value, ['articles']) || !Array.isArray(value.articles)) return false;
  if (value.articles.length > 20) return false;
  const ids = new Set<string>();
  let previous = Infinity;
  for (const row of value.articles) {
    if (!publicKeys(row, ['id', 'title', 'likes'])) return false;
    const { id, title, likes } = row;
    if (typeof id !== 'string' || !ARTICLE_ID.test(id) || ids.has(id)) return false;
    if (typeof title !== 'string' || !title.trim() || title.length > 200) return false;
    if (!Number.isSafeInteger(likes) || (likes as number) < 1 || (likes as number) > previous)
      return false;
    ids.add(id);
    previous = likes as number;
  }
  return true;
}
const PROJECT_ID = ARTICLE_ID;
export function validAuthorCard(value: unknown): value is PublicAuthorCard {
  if (
    !publicKeys(value, ['articles', 'projects', 'recent', 'links']) ||
    !Array.isArray(value.recent) ||
    !validProfileLinks(value.links)
  )
    return false;
  const { articles, projects, recent } = value;
  for (const n of [articles, projects])
    if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > 100000) return false;
  if (recent.length > 4) return false;
  const seen = new Set<string>();
  const shown = { article: 0, project: 0 };
  for (const row of recent) {
    if (!publicKeys(row, ['kind', 'id', 'title'])) return false;
    const { kind, id, title } = row;
    if (kind !== 'article' && kind !== 'project') return false;
    if (typeof id !== 'string' || !(kind === 'article' ? ARTICLE_ID : PROJECT_ID).test(id))
      return false;
    if (seen.has(kind + id)) return false;
    if (typeof title !== 'string' || !title.trim() || title.length > 200) return false;
    seen.add(kind + id);
    shown[kind]++;
  }
  // A listed item is a counted one; a list longer than the counts is an inconsistent read.
  return shown.article <= (articles as number) && shown.project <= (projects as number);
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
    /** The author card beside an article or project (#312). Its failure leaves the card plain. */
    async readCard(id: string, signal?: AbortSignal): Promise<PublicAuthorCard> {
      if (!publicSlug(id)) throw new PublicStudentClientError(true);
      try {
        const value = await readAnonymousJson(
          '/api/students/' + id + '/card',
          fetcher,
          signal,
          8192,
        );
        if (!validAuthorCard(value)) throw new PublicStudentClientError();
        return value;
      } catch (error) {
        throw new PublicStudentClientError(publicReadMissing(error));
      }
    },
    /** Likes each public article has received. Shown only on one's own page. */
    async readReceivedLikes(id: string, signal?: AbortSignal): Promise<PublicReceivedLikes> {
      if (!publicSlug(id)) throw new PublicStudentClientError(true);
      try {
        const value = await readAnonymousJson(
          '/api/students/' + id + '/received-likes',
          fetcher,
          signal,
          32768,
        );
        if (!validReceivedLikes(value)) throw new PublicStudentClientError();
        return value;
      } catch (error) {
        throw new PublicStudentClientError(publicReadMissing(error));
      }
    },
  };
}
