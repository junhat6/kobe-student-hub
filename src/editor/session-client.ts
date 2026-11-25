import { boundedReadFailure, readBoundedJson } from '../shared/http-client';
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
/** Pauses between read-only session proof attempts; see peekSteadily. */
export const PEEK_RETRY_DELAYS = [300, 1200] as const;
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new SessionClientError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(timer);
      reject(new SessionClientError());
    }
    signal?.addEventListener('abort', stop, { once: true });
  });
}
/**
 * Raw existing-cookie checks only. This client never creates a session or retries logout.
 * The bounded read (no-store, no redirects, 200 JSON only, 4 KiB, 10 s, caller abort) is the
 * shared transport; only a 401 is a confirmed sign-out, every other failure stays unverified.
 */
export function createSessionClient(fetcher: typeof fetch = fetch) {
  async function request(logoutToken?: string, signal?: AbortSignal): Promise<unknown> {
    try {
      return await readBoundedJson(logoutToken ? '/api/private/logout' : '/api/private/session', {
        fetcher,
        credentials: 'same-origin',
        method: logoutToken ? 'POST' : 'GET',
        csrf: logoutToken,
        maxBytes: 4096,
        signal,
      });
    } catch (error) {
      throw new SessionClientError(
        boundedReadFailure(error) === 'signed-out' ? 'signed-out' : 'unavailable',
      );
    }
  }
  async function peek(signal?: AbortSignal): Promise<string> {
    const result = await request(undefined, signal);
    if (!keys(result, ['csrfToken']) || !token(result.csrfToken)) throw new SessionClientError();
    return result.csrfToken;
  }
  return {
    peek,
    /**
     * The read-only proof is idempotent, so a transient failure (dropped connection,
     * 5xx, a slow reply) is retried a few times before the caller is told the session is
     * unverifiable. A confirmed sign-out (401) and a caller abort are final immediately.
     * Mutations are never retried here; only this GET is.
     */
    async peekSteadily(
      signal?: AbortSignal,
      delays: readonly number[] = PEEK_RETRY_DELAYS,
    ): Promise<string> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await peek(signal);
        } catch (error) {
          if (
            signal?.aborted ||
            attempt >= delays.length ||
            (error instanceof SessionClientError && error.kind === 'signed-out')
          )
            throw error instanceof SessionClientError ? error : new SessionClientError();
          await wait(delays[attempt], signal);
        }
      }
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
  /** Pauses before re-asking a transiently failed proof; tests pass []. */
  retryDelays?: readonly number[];
}
/**
 * A UI-consumption guard, not authentication. Bytes may reach an SDK's temporary
 * buffer, but EOF is withheld until its session proof matches. Existing server
 * CSRF/ownership checks remain mandatory and abort cannot undo a committed write.
 *
 * Proofs per request (#272): a write is proved before it is sent, so it never leaves under a
 * session that already changed. A read (GET/HEAD) is sent at once: a proof before it could not
 * stop anything the post-header proof does not, because that proof is asked only after the
 * server has read the cookie, so any change before or during the read fails it before the
 * status, headers or body reach the caller (A→B→A between proofs passes either way). Every
 * request keeps the post-header proof and the EOF proof.
 */
export function createAuthorSessionGuard({
  csrfToken,
  origin,
  fetcher = fetch,
  onMismatch,
  onUnverified,
  retryDelays = PEEK_RETRY_DELAYS,
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
  /**
   * Proofs asked for close together share one session request (#272: /account opened ~16
   * private reads at once and asked 31 times, three serial proofs per read). A batch is sent
   * in the next task after it opens, so its request always leaves after every joiner asked:
   * the shared answer is as fresh as a dedicated one would be. A proof asked once a batch has
   * been sent waits for the next batch; no answer is reused or cached. (A hidden tab may
   * throttle the timer; that only delays the proof, it never weakens it.)
   */
  interface Waiter {
    resolve: (csrfToken: string) => void;
    reject: (error: unknown) => void;
  }
  interface Batch {
    waiters: Set<Waiter>;
    /** Set once the shared request is sent; aborted when every joiner has given up. */
    controller?: AbortController;
  }
  let open: Batch | undefined;
  function startBatch(batch: Batch) {
    if (open === batch) open = undefined;
    if (!batch.waiters.size) return;
    batch.controller = new AbortController();
    const settle = (finish: (waiter: Waiter) => void) => {
      const waiters = [...batch.waiters];
      batch.waiters.clear();
      waiters.forEach(finish);
    };
    session.peekSteadily(batch.controller.signal, retryDelays).then(
      (csrf) => settle((waiter) => waiter.resolve(csrf)),
      (error: unknown) => settle((waiter) => waiter.reject(error)),
    );
  }
  function sharedProof(signal: AbortSignal) {
    return new Promise<string>((resolve, reject) => {
      if (signal.aborted) return reject(new SessionClientError());
      if (!open) {
        const fresh: Batch = { waiters: new Set() };
        open = fresh;
        setTimeout(() => startBatch(fresh), 0);
      }
      const batch = open;
      const leave = () => {
        batch.waiters.delete(waiter);
        reject(new SessionClientError());
        if (batch.controller && !batch.waiters.size) batch.controller.abort();
      };
      const waiter: Waiter = {
        resolve: (csrf: string) => {
          signal.removeEventListener('abort', leave);
          resolve(csrf);
        },
        reject: (error: unknown) => {
          signal.removeEventListener('abort', leave);
          reject(error);
        },
      };
      batch.waiters.add(waiter);
      signal.addEventListener('abort', leave, { once: true });
    });
  }
  async function verify(signal: AbortSignal) {
    if (!valid || signal.aborted) throw new SessionClientError();
    let current: string;
    try {
      current = await sharedProof(signal);
    } catch (error) {
      // The caller (an SDK timeout, a superseded request) gave up: that says nothing
      // about the session, so the editor stays open.
      if (!valid || signal.aborted) throw new SessionClientError();
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
    const callerAborted = () => parentSignal?.aborted === true;
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
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const headers = (async () => {
        if (method !== 'GET' && method !== 'HEAD') await verify(controller.signal);
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
              if (!cancelled && valid && !callerAborted()) unavailable();
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
      if (valid && !callerAborted()) unavailable();
      throw new SessionClientError();
    }
  };
  return { fetcher: guarded, invalidate };
}
