import { proofAuthorization } from './auth-proof';

/**
 * Why a bounded read failed. Callers map this to their own error class; the reason never
 * carries a URL, body, header or identity.
 * - `missing`: the server answered 404 (absent or not public, reason withheld)
 * - `signed-out`: the server answered 401
 * - `conflict`: the server answered 409 (a state the caller can explain, such as a limit)
 * - `rejected`: the server answered 422 (the sent content itself was refused)
 * - `unavailable`: anything else (network, timeout, abort, wrong status/type/size, bad JSON)
 */
export type BoundedReadFailure = 'missing' | 'signed-out' | 'conflict' | 'rejected' | 'unavailable';
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
  /**
   * Serialized as JSON, except a Blob, which is sent unchanged with its own non-empty type as
   * Content-Type. A body always requires `csrf`.
   */
  body?: unknown;
  /** Sent as the CSRF proof. Invalid tokens throw before any request. */
  csrf?: string;
  /**
   * The version a write expects, sent as `If-Match: "<n>"`. Only a positive safe integer on a
   * request that also carries `csrf`; anything else throws before any request.
   */
  ifMatch?: number;
  /** The only accepted status (default 200). */
  status?: number;
  /** Upper bound on the decoded body (1..2097152; a published article body is up to 256 KiB before JSON escaping). */
  maxBytes: number;
  /** Upper bound on stream chunks (default min(maxBytes, 65536)). */
  maxChunks?: number;
  /** When the server sent Content-Length, require the streamed size to equal it. */
  exactLength?: boolean;
  signal?: AbortSignal;
  /** Called once the server answered at all, before the status is checked. */
  onResponse?: () => void;
}

const MAX_BYTES = 2097152;
const TIMEOUT_MS = 10000;

const JSON_TYPE = /^application\/json(?:;|$)/i;
const decodeJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BoundedReadError();
  }
};

/**
 * The one bounded JSON transport for browser clients: no-store, no redirects, exact status,
 * `application/json` only, Content-Length and streamed size caps, fatal UTF-8, a 10 s
 * deadline and caller abort. Validation of the parsed value stays with each client.
 */
export async function readBoundedJson(path: string, request: BoundedJsonRequest): Promise<unknown> {
  const { status, ...rest } = request;
  return (await readBoundedJsonResponse(path, { ...rest, statuses: [status ?? 200] })).value;
}

export type BoundedJsonStatusRequest = Omit<BoundedJsonRequest, 'status'> & {
  /**
   * Every status whose JSON body the caller reads (for example 201 and a 409 refusal that names
   * which limit was reached). Any other status fails as in readBoundedJson, without the body.
   */
  statuses: readonly number[];
};

/** readBoundedJson for a caller that must tell several answered statuses apart by their body. */
export async function readBoundedJsonResponse(
  path: string,
  request: BoundedJsonStatusRequest,
): Promise<{ status: number; value: unknown }> {
  const answer = await readBounded(path, request, 'application/json', (type) =>
    JSON_TYPE.test(type),
  );
  return { status: answer.status, value: decodeJson(answer.bytes) };
}

export type BoundedBytesRequest = Omit<BoundedJsonRequest, 'status' | 'body'> & {
  /** The only accepted Content-Types, compared exactly; also sent as Accept. */
  types: readonly string[];
};

/**
 * The same transport for a non-JSON body (a private image): status 200 only, the Content-Type
 * must equal one of `types`, and the bytes are returned unparsed with that type.
 */
export async function readBoundedBytes(
  path: string,
  request: BoundedBytesRequest,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  const { types, ...rest } = request;
  if (!types.length || types.some((type) => !/^[a-z]+\/[a-z0-9.+-]+$/.test(type)))
    throw new BoundedReadError();
  const answer = await readBounded(path, { ...rest, statuses: [200] }, types.join(', '), (type) =>
    types.includes(type),
  );
  return { bytes: answer.bytes, type: answer.type };
}

async function readBounded(
  path: string,
  request: BoundedJsonStatusRequest,
  accept: string,
  acceptType: (type: string) => boolean,
): Promise<{ status: number; type: string; bytes: Uint8Array<ArrayBuffer> }> {
  const { fetcher, credentials, method, body, csrf, ifMatch, signal, onResponse } = request;
  const statuses = request.statuses;
  const maxBytes = request.maxBytes;
  const maxChunks = request.maxChunks ?? Math.min(maxBytes, 65536);
  // Read a Blob's type once: the checked value is the one sent, even if a subclass's getter changes.
  const blobType = body instanceof Blob ? String(body.type) : undefined;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES ||
    !Number.isSafeInteger(maxChunks) ||
    maxChunks < 1 ||
    !statuses.length ||
    statuses.some((status) => !Number.isInteger(status) || status < 200 || status > 599) ||
    (body !== undefined && csrf === undefined) ||
    (ifMatch !== undefined &&
      (csrf === undefined || !Number.isSafeInteger(ifMatch) || ifMatch < 1)) ||
    (blobType !== undefined && !/^[a-z]+\/[a-z0-9.+-]+$/.test(blobType))
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
    const headers: Record<string, string> = { Accept: accept };
    if (body !== undefined) headers['Content-Type'] = blobType ?? 'application/json';
    if (authorization !== undefined) headers.Authorization = authorization;
    if (ifMatch !== undefined) headers['If-Match'] = `"${ifMatch}"`;
    const response = await fetcher(path, {
      ...(method === undefined ? {} : { method }),
      credentials,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers,
      ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) }),
    });
    onResponse?.();
    if (
      expired ||
      controller.signal.aborted ||
      !statuses.includes(response.status) ||
      !response.body ||
      !acceptType(response.headers.get('Content-Type') ?? '')
    ) {
      void response.body?.cancel().catch(() => {});
      const answered = !expired && !controller.signal.aborted;
      throw new BoundedReadError(
        answered && response.status === 404
          ? 'missing'
          : answered && response.status === 401
            ? 'signed-out'
            : answered && response.status === 409
              ? 'conflict'
              : answered && response.status === 422
                ? 'rejected'
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
      return {
        status: response.status,
        type: response.headers.get('Content-Type') ?? '',
        bytes: bytes.slice(0, size),
      };
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
