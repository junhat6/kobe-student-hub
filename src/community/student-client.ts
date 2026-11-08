import { readAnonymousJson } from '../editor/anonymous-public-read';
import {
  publicKeys,
  publicSlug,
  validPublicProfile,
  validPublicSummary,
} from '../editor/public-author-client';
import { validProjectAuthor } from '../editor/project-client';
import type { PublicStudent } from '../public-student-types';

export class PublicStudentClientError extends Error {
  constructor() {
    super('投稿者の公開情報を確認できませんでした。');
    this.name = 'PublicStudentClientError';
  }
}
function valid(value: unknown, id: string): value is PublicStudent {
  if (
    !publicKeys(value, ['author', 'entries', 'projects']) ||
    !validPublicProfile(value.author, id) ||
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
/** Ordinary anonymous profile, with both bounded public activity selections in one DTO. */
export function createPublicStudentClient(fetcher: typeof fetch = fetch) {
  return {
    async read(id: string, signal?: AbortSignal): Promise<PublicStudent> {
      try {
        if (!publicSlug(id)) throw new PublicStudentClientError();
        const value = await readAnonymousJson('/api/students/' + id, fetcher, signal);
        if (!valid(value, id)) throw new PublicStudentClientError();
        return value;
      } catch {
        throw new PublicStudentClientError();
      }
    },
  };
}
