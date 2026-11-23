import { proofAuthorization } from './auth-proof';

/**
 * Why a bounded read failed. Callers map this to their own error class; the reason never
 * carries a URL, body, header or identity.
 * - `missing`: the server answered 404 (absent or not public, reason withheld)
 * - `signed-out`: the server answered 401
 * - `unavailable`: anything else (network, timeout, abort, wrong status/type/size, bad JSON)
 */
export type BoundedReadFailure = 'missing' | 'signed-out' | 'unavailable';
export class BoundedReadError extends Error {
  constructor(readonly kind: BoundedReadFailure = 'unavailable') {
    super('応答を確認できませんでした。');
    this.name = 'BoundedReadError';
  }
}
export function boundedReadFailure(error: unknown): BoundedReadFailure {
  return error instanceof BoundedReadError ? error.kind : 'unavailable';
}

export interface BoundedJsonRequest {
  fetcher: typeof fetch;
  /** `omit` for anonymous public reads; `same-origin` sends the existing session cookie. */
  credentials: 'omit' | 'same-origin';
  /** Left out of the request entirely when undefined (anonymous reads send no method). */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Serialized as JSON. A body always requires `csrf`. */
  body?: unknown;
  /** Sent as the CSRF proof. Invalid tokens throw before any request. */
  csrf?: string;
  /** The only accepted status (default 200). */
  status?: number;
  /** Upper bound on the decoded body (1..262144). */
  maxBytes: number;
  /** Upper bound on stream chunks (default min(maxBytes, 65536)). */
  maxChunks?: number;
  /** When the server sent Content-Length, require the streamed size to equal it. */
  exactLength?: boolean;
  signal?: AbortSignal;
  /** Called once the server answered at all, before the status is checked. */
  onResponse?: () => void;
}

const MAX_BYTES = 262144;
const TIMEOUT_MS = 10000;

/**
 * The one bounded JSON transport for browser clients: no-store, no redirects, exact status,
 * `application/json` only, Content-Length and streamed size caps, fatal UTF-8, a 10 s
 * deadline and caller abort. Validation of the parsed value stays with each client.
 */
export async function readBoundedJson(path: string, request: BoundedJsonRequest): Promise<unknown> {
  const { fetcher, credentials, method, body, csrf, signal, onResponse } = request;
  const expected = request.status ?? 200;
  const maxBytes = request.maxBytes;
  const maxChunks = request.maxChunks ?? Math.min(maxBytes, 65536);
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES ||
    !Number.isSafeInteger(maxChunks) ||
    maxChunks < 1 ||
    (body !== undefined && csrf === undefined)
  )
    throw new BoundedReadError();
  let authorization: string | undefined;
  try {
    if (csrf !== undefined) authorization = proofAuthorization('csrf', csrf);
  } catch {
    throw new BoundedReadError();
  }
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (error: BoundedReadError) => void = () => {};
  const cancel = () => {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  };
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    cancel();
    rejectAbort(new BoundedReadError());
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const work = (async () => {
    if (controller.signal.aborted) throw new BoundedReadError();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authorization !== undefined) headers.Authorization = authorization;
    const response = await fetcher(path, {
      ...(method === undefined ? {} : { method }),
      credentials,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    onResponse?.();
    if (
      expired ||
      controller.signal.aborted ||
      response.status !== expected ||
      !response.body ||
      !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
    ) {
      void response.body?.cancel().catch(() => {});
      const answered = !expired && !controller.signal.aborted;
      throw new BoundedReadError(
        answered && response.status === 404
          ? 'missing'
          : answered && response.status === 401
            ? 'signed-out'
            : 'unavailable',
      );
    }
    const length = response.headers.get('Content-Length');
    if (
      length !== null &&
      (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)
    ) {
      void response.body.cancel().catch(() => {});
      throw new BoundedReadError();
    }
    reader = response.body.getReader();
    const bytes = new Uint8Array(maxBytes);
    let size = 0,
      count = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (expired || controller.signal.aborted) throw new BoundedReadError();
        if (next.done) break;
        if (++count > maxChunks || size + next.value.byteLength > bytes.length)
          throw new BoundedReadError();
        bytes.set(next.value, size);
        size += next.value.byteLength;
      }
      if (request.exactLength && length !== null && Number(length) !== size)
        throw new BoundedReadError();
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
      reject(new BoundedReadError());
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, deadline, aborted]);
  } catch (error) {
    throw error instanceof BoundedReadError ? error : new BoundedReadError();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    cancel();
  }
}
