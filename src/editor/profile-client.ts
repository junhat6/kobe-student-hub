import { proofAuthorization } from '../shared/auth-proof';
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
  async function request(value?: ProfileInput): Promise<PublicProfile | null> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const cancel = () => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    };
    const operation = (async () => {
      const response = await fetcher('/api/private/profile', {
        method: value ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: value
          ? {
              Accept: 'application/json',
              'Content-Type': 'application/json; charset=utf-8',
              Authorization: proofAuthorization('csrf', csrfToken),
            }
          : { Accept: 'application/json' },
        ...(value ? { body: JSON.stringify({ ...value, confirmPublic: true }) } : {}),
      });
      if (
        expired ||
        response.status !== (value ? 201 : 200) ||
        !response.body ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new ProfileClientError();
      }
      const length = response.headers.get('Content-Length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 16384)
      ) {
        void response.body.cancel().catch(() => {});
        throw new ProfileClientError();
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(16384);
      let size = 0;
      let count = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (expired) throw new ProfileClientError();
          if (next.done) break;
          if (++count > 16384 || size + next.value.byteLength > bytes.length)
            throw new ProfileClientError();
          bytes.set(next.value, size);
          size += next.value.byteLength;
        }
        const result: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
        );
        if (
          !keys(result, ['profile']) ||
          (result.profile !== null && !profile(result.profile)) ||
          (value &&
            (result.profile === null ||
              !sameProfileInput(result.profile as PublicProfile, value) ||
              !/^profile-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                (result.profile as PublicProfile).id,
              ) ||
              (result.profile as PublicProfile).initials !==
                Array.from(value.displayName.trim())[0]))
        )
          throw new ProfileClientError();
        return result.profile as PublicProfile | null;
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
        reader = undefined;
      }
    })();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        cancel();
        reject(new ProfileClientError());
      }, 10000);
    });
    try {
      return await Promise.race([operation, deadline]);
    } catch {
      throw new ProfileClientError();
    } finally {
      clearTimeout(timer);
      cancel();
    }
  }
  return {
    read: () => request(),
    create: async (value: ProfileInput, confirmed: boolean) => {
      if (!confirmed || !keys(value, fields) || !input(value)) throw new ProfileClientError();
      return (await request(value)) as PublicProfile;
    },
  };
}
