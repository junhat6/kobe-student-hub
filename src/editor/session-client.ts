import { proofAuthorization } from '../shared/auth-proof';
export class SessionClientError extends Error {
  constructor(readonly kind: 'signed-out' | 'unavailable' = 'unavailable') {
    super('セッションの確認結果を取得できませんでした。');
    this.name = 'SessionClientError';
  }
}
const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const keys = (v: unknown, wanted: string[]): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === wanted.length &&
  wanted.every((k) => Object.hasOwn(v, k));
/** Raw existing-cookie checks only. This client never creates a session or retries logout. */
export function createSessionClient(fetcher: typeof fetch = fetch) {
  async function request(logoutToken?: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    let rejectAbort: (error: SessionClientError) => void = () => {};
    const cancel = () => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    };
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const externalAbort = () => {
      cancel();
      rejectAbort(new SessionClientError());
    };
    signal?.addEventListener('abort', externalAbort, { once: true });
    if (signal?.aborted) externalAbort();
    const operation = (async () => {
      if (controller.signal.aborted) throw new SessionClientError();
      const response = await fetcher(logoutToken ? '/api/private/logout' : '/api/private/session', {
        method: logoutToken ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: logoutToken
          ? { Accept: 'application/json', Authorization: proofAuthorization('csrf', logoutToken) }
          : { Accept: 'application/json' },
      });
      if (
        expired ||
        controller.signal.aborted ||
        response.status !== 200 ||
        !response.body ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new SessionClientError(response.status === 401 ? 'signed-out' : 'unavailable');
      }
      const length = response.headers.get('Content-Length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 4096)
      ) {
        void response.body.cancel().catch(() => {});
        throw new SessionClientError();
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(4096);
      let size = 0,
        count = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (expired || controller.signal.aborted) throw new SessionClientError();
          if (next.done) break;
          if (++count > 4096 || size + next.value.byteLength > bytes.length)
            throw new SessionClientError();
          bytes.set(next.value, size);
          size += next.value.byteLength;
        }
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
        ) as unknown;
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
        reject(new SessionClientError());
      }, 10000);
    });
    try {
      return await Promise.race([operation, deadline, aborted]);
    } catch (error) {
      if (error instanceof SessionClientError) throw error;
      throw new SessionClientError();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbort);
      cancel();
    }
  }
  return {
    async peek(signal?: AbortSignal): Promise<string> {
      const result = await request(undefined, signal);
      if (!keys(result, ['csrfToken']) || !token(result.csrfToken)) throw new SessionClientError();
      return result.csrfToken;
    },
    async logout(csrfToken: string, signal?: AbortSignal): Promise<void> {
      if (!token(csrfToken)) throw new SessionClientError();
      const result = await request(csrfToken, signal);
      if (!keys(result, ['loggedOut']) || result.loggedOut !== true) throw new SessionClientError();
    },
  };
}

export interface AuthorSessionGuard {
  fetcher: typeof fetch;
  invalidate: () => void;
}
interface GuardOptions {
  csrfToken: string;
  origin: string;
  fetcher?: typeof fetch;
  onMismatch: (kind: 'signed-out' | 'changed') => void;
  onUnverified: () => void;
}
/**
 * A UI-consumption guard, not authentication. Bytes may reach an SDK's temporary
 * buffer, but EOF is withheld until its session proof matches. Existing server
 * CSRF/ownership checks remain mandatory and abort cannot undo a committed write.
 */
export function createAuthorSessionGuard({
  csrfToken,
  origin,
  fetcher = fetch,
  onMismatch,
  onUnverified,
}: GuardOptions): AuthorSessionGuard {
  const session = createSessionClient(fetcher);
  const requests = new Set<AbortController>();
  let valid = true;
  const invalidate = () => {
    if (!valid) return;
    valid = false;
    for (const request of requests) request.abort();
    requests.clear();
  };
  function unavailable() {
    if (valid) {
      invalidate();
      onUnverified();
    }
    return new SessionClientError();
  }
  async function verify(signal: AbortSignal) {
    if (!valid || signal.aborted) throw new SessionClientError();
    let current: string;
    try {
      current = await session.peek(signal);
    } catch (error) {
      if (!valid) throw new SessionClientError();
      if (error instanceof SessionClientError && error.kind === 'signed-out') {
        invalidate();
        onMismatch('signed-out');
        throw new SessionClientError();
      }
      throw unavailable();
    }
    if (!valid || signal.aborted) throw new SessionClientError();
    if (current !== csrfToken) {
      invalidate();
      onMismatch('changed');
      throw new SessionClientError();
    }
  }
  const guarded: typeof fetch = async (input, init) => {
    let url: URL;
    try {
      url = new URL(
        typeof input === 'string' || input instanceof URL ? String(input) : input.url,
        origin,
      );
      if (
        !token(csrfToken) ||
        new URL(origin).protocol !== 'https:' ||
        new URL(origin).origin !== origin ||
        url.origin !== origin ||
        !url.pathname.startsWith('/api/private/')
      )
        throw new Error();
    } catch {
      throw new SessionClientError();
    }
    if (!valid) throw new SessionClientError();
    const controller = new AbortController();
    requests.add(controller);
    let upstream: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let settled = false,
      cancelled = false;
    let rejectAbort: (error: SessionClientError) => void = () => {};
    const parentSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const onParentAbort = () => {
      controller.abort();
      rejectAbort(new SessionClientError());
    };
    const onControllerAbort = () => rejectAbort(new SessionClientError());
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    // Response body consumption may outlive the initial fetch promise.
    void aborted.catch(() => {});
    controller.signal.addEventListener('abort', onControllerAbort, { once: true });
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    if (parentSignal?.aborted) onParentAbort();
    const cleanup = () => {
      if (settled) return;
      settled = true;
      requests.delete(controller);
      parentSignal?.removeEventListener('abort', onParentAbort);
      controller.signal.removeEventListener('abort', onControllerAbort);
    };
    const cancelBody = () => {
      if (reader) void reader.cancel().catch(() => {});
      else void upstream?.body?.cancel().catch(() => {});
    };
    try {
      const headers = (async () => {
        await verify(controller.signal);
        if (!valid) throw new SessionClientError();
        upstream = await fetcher(input, {
          ...init,
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        try {
          await verify(controller.signal);
        } catch {
          void upstream.body?.cancel().catch(() => {});
          throw new SessionClientError();
        }
        return upstream;
      })();
      const response = await Promise.race([headers, aborted]);
      if (!response.body) {
        await verify(controller.signal);
        cleanup();
        return new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(output) {
            try {
              if (!valid || controller.signal.aborted) throw new SessionClientError();
              const next = await Promise.race([reader!.read(), aborted]);
              if (!valid || controller.signal.aborted) throw new SessionClientError();
              if (next.done) {
                await verify(controller.signal);
                if (!valid) throw new SessionClientError();
                output.close();
                cleanup();
                reader!.releaseLock();
                reader = undefined;
              } else output.enqueue(next.value);
            } catch {
              if (!cancelled && valid) unavailable();
              output.error(new SessionClientError());
              cancelBody();
              cleanup();
            }
          },
          cancel() {
            cancelled = true;
            cancelBody();
            controller.abort();
            cleanup();
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      cancelBody();
      cleanup();
      if (valid) unavailable();
      throw new SessionClientError();
    }
  };
  return { fetcher: guarded, invalidate };
}
