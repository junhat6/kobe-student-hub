import { proofAuthorization } from '../shared/auth-proof';
import { isReadingReference, type ReadingReference, type ReadingHistoryPage } from './types';
export class ReadingHistoryClientError extends Error {
  constructor() {
    super('履歴を確認できませんでした。');
  }
}
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === keys.sort().join(',');
function validPage(v: unknown): v is ReadingHistoryPage {
  if (
    !exact(v, ['entries', 'enabled', 'nextOffset', 'capacity']) ||
    !Array.isArray(v.entries) ||
    v.entries.length > 20 ||
    typeof v.enabled !== 'boolean' ||
    v.capacity !== 500 ||
    !(
      v.nextOffset === null ||
      (Number.isInteger(v.nextOffset) && Number(v.nextOffset) >= 20 && Number(v.nextOffset) <= 500)
    )
  )
    return false;
  const seen = new Set<string>();
  return v.entries.every((r) => {
    if (
      !exact(r, ['kind', 'contentId', 'title', 'lastViewedAt']) ||
      !isReadingReference({ kind: r.kind, contentId: r.contentId }) ||
      !Number.isSafeInteger(r.lastViewedAt) ||
      Number(r.lastViewedAt) < 0 ||
      Number(r.lastViewedAt) > 253402300799999 ||
      !(
        r.title === null ||
        (typeof r.title === 'string' &&
          r.title.length <= 400 &&
          Array.from(r.title).length <= 200 &&
          !r.title.includes('\0'))
      )
    )
      return false;
    const key = r.kind + ':' + r.contentId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function createReadingHistoryClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  async function request<T>(
    method: string,
    body: unknown,
    validate: (value: unknown) => value is T,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    let rejectAbort: (error: ReadingHistoryClientError) => void = () => {};
    const cancel = () => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    };
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const externalAbort = () => {
      cancel();
      rejectAbort(new ReadingHistoryClientError());
    };
    signal?.addEventListener('abort', externalAbort, { once: true });
    if (signal?.aborted) externalAbort();
    const operation = (async () => {
      if (controller.signal.aborted) throw new ReadingHistoryClientError();
      const response = await fetcher(
        '/api/private/reading-history' + (offset ? '?offset=' + offset : ''),
        {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(body === undefined
              ? {}
              : {
                  'Content-Type': 'application/json',
                  Authorization: proofAuthorization('csrf', csrfToken),
                }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      if (
        expired ||
        controller.signal.aborted ||
        response.status !== 200 ||
        !response.body ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new ReadingHistoryClientError();
      }
      const length = response.headers.get('Content-Length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 65536)
      ) {
        void response.body.cancel().catch(() => {});
        throw new ReadingHistoryClientError();
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(65536);
      let size = 0,
        count = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (expired || controller.signal.aborted) throw new ReadingHistoryClientError();
          if (next.done) break;
          if (++count > 65536 || size + next.value.byteLength > bytes.length)
            throw new ReadingHistoryClientError();
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
        reject(new ReadingHistoryClientError());
      }, 10000);
    });
    try {
      const result = await Promise.race([operation, deadline, aborted]);
      if (!validate(result)) throw new ReadingHistoryClientError();
      return result;
    } catch (error) {
      if (error instanceof ReadingHistoryClientError) throw error;
      throw new ReadingHistoryClientError();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbort);
      cancel();
    }
  }
  return {
    read: (offset = 0, signal?: AbortSignal) =>
      request('GET', undefined, validPage, offset, signal),
    record: (ref: ReadingReference, signal?: AbortSignal) =>
      request(
        'PUT',
        ref,
        (v): v is { recorded: boolean } =>
          exact(v, ['recorded']) && typeof v.recorded === 'boolean',
        0,
        signal,
      ),
    remove: (ref?: ReadingReference) =>
      request(
        'DELETE',
        ref ?? { all: true },
        (v): v is { deleted: true } => exact(v, ['deleted']) && v.deleted === true,
      ),
    setEnabled: (enabled: boolean) =>
      request(
        'PATCH',
        { enabled },
        (v): v is { enabled: boolean } => exact(v, ['enabled']) && v.enabled === enabled,
      ),
  };
}
