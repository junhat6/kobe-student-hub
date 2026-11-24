import { boundedReadFailure, readBoundedJson } from '../shared/http-client';
export interface ProfileInput {
  displayName: string;
  department: string;
  yearLabel: string;
  bio: string;
}
export interface PublicProfile extends ProfileInput {
  id: string;
  initials: string;
}
export class ProfileClientError extends Error {
  constructor() {
    super('プロフィールの操作結果を確認できませんでした。');
    this.name = 'ProfileClientError';
  }
}
export class ProfileConflictError extends ProfileClientError {
  constructor() {
    super();
    this.name = 'ProfileConflictError';
  }
}
const fields = ['displayName', 'department', 'yearLabel', 'bio'] as const;
function keys(v: unknown, expected: readonly string[]): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === expected.length &&
    expected.every((k) => Object.hasOwn(v, k))
  );
}
const bounded = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length <= max * 2 &&
  !v.includes('\0') &&
  Array.from(v).length <= max &&
  new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(v)) === v;
function input(v: Record<string, unknown>) {
  return (
    bounded(v.displayName, 80) &&
    Boolean(v.displayName.trim()) &&
    bounded(v.department, 80) &&
    bounded(v.yearLabel, 32) &&
    bounded(v.bio, 800)
  );
}
function profile(v: unknown): v is PublicProfile {
  return (
    keys(v, [...fields, 'id', 'initials']) &&
    input(v) &&
    typeof v.id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v.id) &&
    bounded(v.initials, 8)
  );
}
export const sameProfileInput = (a: ProfileInput, b: ProfileInput) =>
  fields.every((key) => a[key] === b[key]);
/** Local editor client. No identity defaults, persistence or automatic mutation retry. */
export function createProfileClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  async function request(
    value?: ProfileInput,
    expected?: PublicProfile,
  ): Promise<PublicProfile | null> {
    let result: unknown;
    try {
      result = await readBoundedJson('/api/private/profile', {
        fetcher,
        credentials: 'same-origin',
        method: expected ? 'PATCH' : value ? 'POST' : 'GET',
        status: value && !expected ? 201 : 200,
        maxBytes: 16384,
        ...(value
          ? {
              csrf: csrfToken,
              body: {
                ...value,
                confirmPublic: true,
                ...(expected ? { expectedProfile: expected } : {}),
              },
            }
          : {}),
      });
    } catch (error) {
      // Only an update names the snapshot it replaces, so only an update can be stale.
      if (expected && boundedReadFailure(error) === 'conflict') throw new ProfileConflictError();
      throw new ProfileClientError();
    }
    if (
      !keys(result, ['profile']) ||
      (result.profile !== null && !profile(result.profile)) ||
      (value &&
        (result.profile === null ||
          !sameProfileInput(result.profile as PublicProfile, value) ||
          (expected
            ? (result.profile as PublicProfile).id !== expected.id
            : !/^profile-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                (result.profile as PublicProfile).id,
              )) ||
          (result.profile as PublicProfile).initials !== Array.from(value.displayName.trim())[0]))
    )
      throw new ProfileClientError();
    return result.profile as PublicProfile | null;
  }
  return {
    read: () => request(),
    create: async (value: ProfileInput, confirmed: boolean) => {
      if (!confirmed || !keys(value, fields) || !input(value)) throw new ProfileClientError();
      return (await request(value)) as PublicProfile;
    },
    update: async (value: ProfileInput, expected: PublicProfile, confirmed: boolean) => {
      if (!confirmed || !keys(value, fields) || !input(value) || !profile(expected))
        throw new ProfileClientError();
      return (await request(value, expected)) as PublicProfile;
    },
  };
}
