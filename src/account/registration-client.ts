import { proofAuthorization } from '../shared/auth-proof';
import {
  canonicalEnrollmentYears,
  type EnrollmentYears,
  type OwnEnrollmentResult,
} from '../shared/enrollment';
import {
  createSessionClient,
  createAuthorSessionGuard,
  SessionClientError,
} from '../editor/session-client';
import { createEnrollmentClient } from '../editor/enrollment-client';

export type RegistrationInspection = { csrfToken: string } & OwnEnrollmentResult;
export type RegistrationClientErrorKind =
  'invalid-input' | 'unknown' | 'signed-out' | 'unavailable';
export class RegistrationClientError extends Error {
  constructor(readonly kind: RegistrationClientErrorKind = 'unavailable') {
    super('登録・ログインの状態を確認できませんでした。');
    this.name = 'RegistrationClientError';
  }
}
const LIMIT = 4096,
  MAX_CHUNKS = 4096,
  DEADLINE_MS = 10000;
const token = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const keys = (value: unknown, wanted: readonly string[]): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).length === wanted.length &&
  wanted.every((key) => Object.hasOwn(value, key));
interface Operation {
  signal: AbortSignal;
  readers: Set<ReadableStreamDefaultReader<Uint8Array>>;
}

/** A bounded browser transport only. It neither navigates nor stores identity/proofs/years. */
export function createRegistrationClient({
  origin,
  fetcher = fetch,
}: {
  origin: string;
  fetcher?: typeof fetch;
}) {
  try {
    if (
      typeof origin !== 'string' ||
      new URL(origin).protocol !== 'https:' ||
      new URL(origin).origin !== origin
    )
      throw Error();
  } catch {
    throw new RegistrationClientError();
  }

  async function bounded<T>(
    failure: 'unknown' | 'unavailable',
    signal: AbortSignal | undefined,
    run: (operation: Operation) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController(),
      readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (error: RegistrationClientError) => void = () => {};
    const cancel = () => {
      controller.abort();
      for (const reader of readers) void reader.cancel().catch(() => {});
    };
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const externalAbort = () => {
      cancel();
      rejectAbort(new RegistrationClientError(failure));
    };
    signal?.addEventListener('abort', externalAbort, { once: true });
    if (signal?.aborted) externalAbort();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        cancel();
        reject(new RegistrationClientError(failure));
      }, DEADLINE_MS);
    });
    const operation = (async () => {
      if (controller.signal.aborted) throw new RegistrationClientError(failure);
      return run({ signal: controller.signal, readers });
    })();
    try {
      const result = await Promise.race([operation, deadline, aborted]);
      if (controller.signal.aborted) throw new RegistrationClientError(failure);
      return result;
    } catch (error) {
      if (error instanceof RegistrationClientError) throw error;
      throw new RegistrationClientError(failure);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbort);
      cancel();
    }
  }

  async function response(
    operation: Operation,
    path: string,
    headers: Record<string, string> = {},
    body?: string,
  ) {
    if (operation.signal.aborted) throw new RegistrationClientError('unknown');
    const result = await fetcher(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      signal: operation.signal,
      headers: { Accept: 'application/json', ...headers },
      ...(body === undefined ? {} : { body }),
    });
    let valid =
      !operation.signal.aborted &&
      !result.redirected &&
      !['opaque', 'opaqueredirect'].includes(result.type);
    try {
      if (result.url && new URL(result.url).href !== new URL(path, origin).href) valid = false;
    } catch {
      valid = false;
    }
    if (!valid) {
      void result.body?.cancel().catch(() => {});
      throw new RegistrationClientError('unknown');
    }
    return result;
  }

  async function json(operation: Operation, result: Response): Promise<unknown> {
    if (
      operation.signal.aborted ||
      !result.body ||
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
        result.headers.get('Content-Type') ?? '',
      )
    ) {
      void result.body?.cancel().catch(() => {});
      throw new RegistrationClientError('unknown');
    }
    const length = result.headers.get('Content-Length');
    if (
      length !== null &&
      (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > LIMIT)
    ) {
      void result.body.cancel().catch(() => {});
      throw new RegistrationClientError('unknown');
    }
    const reader = result.body.getReader();
    operation.readers.add(reader);
    try {
      const bytes = new Uint8Array(LIMIT);
      let size = 0,
        count = 0;
      for (;;) {
        const part = await reader.read();
        if (operation.signal.aborted) throw new RegistrationClientError('unknown');
        if (part.done) break;
        if (++count > MAX_CHUNKS || size + part.value.byteLength > LIMIT)
          throw new RegistrationClientError('unknown');
        bytes.set(part.value, size);
        size += part.value.byteLength;
      }
      if (length !== null && Number(length) !== size) throw new RegistrationClientError('unknown');
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
      ) as unknown;
    } finally {
      operation.readers.delete(reader);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  function authorization(value: unknown): { authorizationUrl: string } {
    if (
      !keys(value, ['authorizationUrl']) ||
      typeof value.authorizationUrl !== 'string' ||
      value.authorizationUrl.length > LIMIT
    )
      throw new RegistrationClientError('unknown');
    const url = new URL(value.authorizationUrl),
      wanted = [
        'client_id',
        'redirect_uri',
        'response_type',
        'scope',
        'hd',
        'state',
        'nonce',
        'code_challenge',
        'code_challenge_method',
        'prompt',
      ];
    if (
      url.href !== value.authorizationUrl ||
      url.protocol !== 'https:' ||
      url.hostname !== 'accounts.google.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== '/o/oauth2/v2/auth' ||
      value.authorizationUrl.includes('#') ||
      [...url.searchParams.keys()].some((key) => !wanted.includes(key)) ||
      wanted.some((key) => url.searchParams.getAll(key).length !== 1)
    )
      throw new RegistrationClientError('unknown');
    if (
      !/^[A-Za-z0-9_-]{1,220}\.apps\.googleusercontent\.com$/.test(
        url.searchParams.get('client_id') ?? '',
      ) ||
      url.searchParams.get('redirect_uri') !== origin + '/api/auth/callback' ||
      url.searchParams.get('response_type') !== 'code' ||
      url.searchParams.get('scope') !== 'openid email' ||
      url.searchParams.get('hd') !== 'st.kobedenshi.ac.jp' ||
      url.searchParams.get('code_challenge_method') !== 'S256' ||
      url.searchParams.get('prompt') !== 'select_account' ||
      !['state', 'nonce', 'code_challenge'].every((key) => token(url.searchParams.get(key)))
    )
      throw new RegistrationClientError('unknown');
    return { authorizationUrl: url.href };
  }

  function start(
    action: 'login' | 'self-registration',
    years: EnrollmentYears | undefined,
    signal?: AbortSignal,
  ) {
    return bounded('unknown', signal, async (operation) => {
      const boot = await response(operation, '/api/auth/bootstrap');
      if (boot.status === 409) {
        const value = await json(operation, boot);
        if (!keys(value, ['error']) || value.error !== 'authentication_restart_required')
          throw new RegistrationClientError('unknown');
      } else if (boot.status !== 204) {
        void boot.body?.cancel().catch(() => {});
        throw new RegistrationClientError('unknown');
      }
      const command = await response(operation, '/api/auth/command?action=' + action);
      if (command.status !== 200) {
        void command.body?.cancel().catch(() => {});
        throw new RegistrationClientError('unknown');
      }
      const proof = await json(operation, command);
      if (!keys(proof, ['commandToken']) || !token(proof.commandToken))
        throw new RegistrationClientError('unknown');
      const headers = {
        Authorization: proofAuthorization('command', proof.commandToken),
        ...(years ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      };
      const started = await response(
        operation,
        years ? '/api/auth/register' : '/api/auth/start',
        headers,
        years ? JSON.stringify(years) : undefined,
      );
      if (started.status !== 200) {
        void started.body?.cancel().catch(() => {});
        throw new RegistrationClientError('unknown');
      }
      return authorization(await json(operation, started));
    });
  }

  return {
    startRegistration(
      input: EnrollmentYears,
      signal?: AbortSignal,
    ): Promise<{ authorizationUrl: string }> {
      let years: EnrollmentYears | null;
      try {
        years = canonicalEnrollmentYears(input);
      } catch {
        years = null;
      }
      return years
        ? start('self-registration', years, signal)
        : Promise.reject(new RegistrationClientError('invalid-input'));
    },
    startLogin: (signal?: AbortSignal) => start('login', undefined, signal),
    inspect(signal?: AbortSignal): Promise<RegistrationInspection> {
      return bounded('unavailable', signal, async (operation) => {
        let failure: 'signed-out' | 'unavailable' = 'unavailable';
        try {
          const csrfToken = await createSessionClient(fetcher).peek(operation.signal);
          const guard = createAuthorSessionGuard({
            csrfToken,
            origin,
            fetcher,
            onMismatch: (kind) => {
              failure = kind === 'signed-out' ? 'signed-out' : 'unavailable';
            },
            onUnverified: () => {
              failure = 'unavailable';
            },
          });
          try {
            const enrollment = await createEnrollmentClient(csrfToken, guard.fetcher).read(
              operation.signal,
            );
            if (operation.signal.aborted) throw new RegistrationClientError();
            return { csrfToken, ...enrollment };
          } finally {
            guard.invalidate();
          }
        } catch (error) {
          if (error instanceof SessionClientError && error.kind === 'signed-out')
            failure = 'signed-out';
          throw new RegistrationClientError(failure);
        }
      });
    },
  };
}
