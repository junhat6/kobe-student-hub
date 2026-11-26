import type {
  ProfileAvatarRemovalInput,
  ProfileReportCase,
  ProfileReportCaseSummary,
  ProfileReportInput,
  ProfileReportReceipt,
} from '../profile-report-types';
import {
  ProjectReportClientError,
  projectReportRequest,
  validProjectReportInput,
} from './project-report-client';
import { publicKeys, publicText } from './public-author-client';
import { avatarVersion, validModerationAvatar } from '../shared/avatar';
import { PROFILE_LINK_SERVICES } from '../shared/profile-links';
import type { ProjectReportInput } from '../project-report-types';

const validProfileReportInput = (v: unknown): v is ProfileReportInput => validProjectReportInput(v);

/** Same bounded transport and receipt contract as project reports; only the target differs. */
export function createProfileReportClient(csrf: string, fetcher: typeof fetch = fetch) {
  const path = (id: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new ProjectReportClientError();
    return '/api/private/profile-reports/' + id;
  };
  return {
    async received(id: string, signal?: AbortSignal): Promise<ProfileReportReceipt> {
      const v = await projectReportRequest(path(id), fetcher, signal);
      if (!publicKeys(v, ['received']) || typeof v.received !== 'boolean')
        throw new ProjectReportClientError();
      return { received: v.received };
    },
    async report(
      id: string,
      input: ProfileReportInput,
      confirmed: boolean,
      signal?: AbortSignal,
    ): Promise<void> {
      if (!confirmed || !validProfileReportInput(input) || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
        throw new ProjectReportClientError();
      const v = await projectReportRequest(path(id), fetcher, signal, input, csrf);
      if (!publicKeys(v, ['received']) || v.received !== true) throw new ProjectReportClientError();
    },
  };
}

const slug = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 253402300799999;
const count = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
/** Operator evidence: bounded https text per service, not necessarily a valid public link. */
function recordedLinks(v: unknown) {
  if (!Array.isArray(v) || v.length > PROFILE_LINK_SERVICES.length) return false;
  const seen = new Set<unknown>();
  return v.every((link) => {
    if (!publicKeys(link, ['service', 'url'])) return false;
    const ok =
      (PROFILE_LINK_SERVICES as readonly unknown[]).includes(link.service) &&
      !seen.has(link.service) &&
      typeof link.url === 'string' &&
      link.url.length <= 200 &&
      /^https:\/\/[\x21-\x7e]+$/.test(link.url);
    seen.add(link.service);
    return ok;
  });
}
function reportedProfile(v: unknown) {
  return (
    publicKeys(v, ['name', 'department', 'year', 'bio', 'links']) &&
    (v.links === null || recordedLinks(v.links)) &&
    profileText({ name: v.name, department: v.department, year: v.year, bio: v.bio })
  );
}
function profileText(v: unknown) {
  return (
    publicKeys(v, ['name', 'department', 'year', 'bio']) &&
    publicText(v.name, 80) &&
    publicText(v.department, 80) &&
    publicText(v.year, 32) &&
    publicText(v.bio, 800)
  );
}
function caseDto(v: unknown): v is ProfileReportCase {
  if (!publicKeys(v, ['profile', 'avatar', 'links', 'reports', 'reportsTruncated'])) return false;
  const p = v.profile;
  return (
    publicKeys(p, ['id', 'name', 'department', 'year', 'bio', 'initials']) &&
    slug(p.id) &&
    validModerationAvatar(v.avatar, p.id) &&
    recordedLinks(v.links) &&
    profileText({ name: p.name, department: p.department, year: p.year, bio: p.bio }) &&
    publicText(p.initials, 8) &&
    typeof v.reportsTruncated === 'boolean' &&
    Array.isArray(v.reports) &&
    v.reports.length >= 1 &&
    v.reports.length <= 20 &&
    v.reports.every(
      (r) =>
        publicKeys(r, ['reason', 'detail', 'receivedAt', 'reported']) &&
        publicText(r.reason, 200) &&
        Boolean(r.reason.trim()) &&
        publicText(r.detail, 2000) &&
        time(r.receivedAt) &&
        reportedProfile(r.reported),
    )
  );
}
/** Operator read-only review; authority is decided by the server on every request. */
export function createProfileModerationClient(fetcher: typeof fetch) {
  return {
    async queue(signal?: AbortSignal): Promise<ProfileReportCaseSummary[]> {
      const v = await projectReportRequest(
        '/api/private/profile-moderation/cases',
        fetcher,
        signal,
      );
      if (
        !Array.isArray(v) ||
        v.length > 20 ||
        !v.every(
          (r) =>
            publicKeys(r, ['profileId', 'displayName', 'reportCount', 'latestReportAt']) &&
            slug(r.profileId) &&
            publicText(r.displayName, 80) &&
            count(r.reportCount) &&
            time(r.latestReportAt),
        )
      )
        throw new ProjectReportClientError();
      return v as ProfileReportCaseSummary[];
    },
    async readCase(id: string, signal?: AbortSignal): Promise<ProfileReportCase> {
      if (!slug(id)) throw new ProjectReportClientError();
      const v = await projectReportRequest(
        '/api/private/profile-moderation/cases/' + id,
        fetcher,
        signal,
      );
      if (!caseDto(v) || v.profile.id !== id) throw new ProjectReportClientError();
      return v;
    },
    /** One explicit operator decision; never retried automatically. */
    async removeAvatar(
      id: string,
      input: ProfileAvatarRemovalInput,
      csrf: string,
      signal?: AbortSignal,
    ): Promise<void> {
      if (
        !slug(id) ||
        !avatarVersion(input.avatar) ||
        !publicText(input.reason, 1000) ||
        !input.reason.trim() ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrf)
      )
        throw new ProjectReportClientError();
      const v = await projectReportRequest(
        '/api/private/profile-moderation/cases/' + id + '/avatar-removal',
        fetcher,
        signal,
        { avatar: input.avatar, reason: input.reason } as unknown as ProjectReportInput,
        csrf,
      );
      if (!publicKeys(v, ['removed']) || v.removed !== true) throw new ProjectReportClientError();
    },
  };
}
