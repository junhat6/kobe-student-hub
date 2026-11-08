import { proofAuthorization } from '../shared/auth-proof';
import type { PublicationStopState } from '../publication-stop-types';
import type { OwnPublicationSummary } from '../own-publication-types';
import { publicKeys } from './public-author-client';
import { projectUUID } from './project-client';
export class PublicationStopClientError extends Error {
  constructor() {
    super('公開停止の結果を確認できませんでした。');
    this.name = 'PublicationStopClientError';
  }
}
function valid(v: unknown, kind: string, id: string): v is PublicationStopState {
  return (
    publicKeys(v, ['kind', 'publicId', 'status', 'sourceVersion', 'stopped']) &&
    v.kind === kind &&
    v.publicId === id &&
    (v.status === 'published' || v.status === 'hidden' || v.status === 'deleted') &&
    Number.isSafeInteger(v.sourceVersion) &&
    Number(v.sourceVersion) > 0 &&
    typeof v.stopped === 'boolean' &&
    (!v.stopped || v.status !== 'published')
  );
}
export function createPublicationStopClient(fetcher: typeof fetch = fetch) {
  async function request(
    kind: OwnPublicationSummary['kind'],
    publicId: string,
    signal?: AbortSignal,
    expectedVersion?: number,
    csrf = '',
  ): Promise<PublicationStopState> {
    if (
      (kind !== 'article' && kind !== 'project') ||
      !projectUUID(publicId) ||
      (expectedVersion !== undefined &&
        (!Number.isSafeInteger(expectedVersion) ||
          expectedVersion < 1 ||
          !/^[A-Za-z0-9_-]{43}$/.test(csrf)))
    )
      throw new PublicationStopClientError();
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    let rejectAbort: (error: PublicationStopClientError) => void = () => {};
    const cancel = () => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    };
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const externalAbort = () => {
      cancel();
      rejectAbort(new PublicationStopClientError());
    };
    signal?.addEventListener('abort', externalAbort, { once: true });
    if (signal?.aborted) externalAbort();
    const operation = (async () => {
      if (controller.signal.aborted) throw new PublicationStopClientError();
      const response = await fetcher('/api/private/publication-stops/' + kind + '/' + publicId, {
        method: expectedVersion === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers:
          expectedVersion === undefined
            ? { Accept: 'application/json' }
            : {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: proofAuthorization('csrf', csrf),
              },
        ...(expectedVersion === undefined
          ? {}
          : {
              body: JSON.stringify({ expectedSourceVersion: expectedVersion, confirmStop: true }),
            }),
      });
      if (
        expired ||
        controller.signal.aborted ||
        response.status !== 200 ||
        !response.body ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new PublicationStopClientError();
      }
      const length = response.headers.get('Content-Length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 65536)
      ) {
        void response.body.cancel().catch(() => {});
        throw new PublicationStopClientError();
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(65536);
      let size = 0,
        count = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (expired || controller.signal.aborted) throw new PublicationStopClientError();
          if (next.done) break;
          if (++count > 65536 || size + next.value.byteLength > bytes.length)
            throw new PublicationStopClientError();
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
        reject(new PublicationStopClientError());
      }, 10000);
    });
    try {
      const result = await Promise.race([operation, deadline, aborted]);
      if (
        !valid(result, kind, publicId) ||
        (expectedVersion !== undefined &&
          (!result.stopped || result.sourceVersion !== expectedVersion))
      )
        throw new PublicationStopClientError();
      return result;
    } catch (error) {
      if (error instanceof PublicationStopClientError) throw error;
      throw new PublicationStopClientError();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbort);
      cancel();
    }
  }
  return {
    read: (kind: OwnPublicationSummary['kind'], id: string, signal?: AbortSignal) =>
      request(kind, id, signal),
    stop: (
      kind: OwnPublicationSummary['kind'],
      id: string,
      version: number,
      csrf: string,
      confirmed: boolean,
      signal?: AbortSignal,
    ) => {
      if (!confirmed) return Promise.reject(new PublicationStopClientError());
      return request(kind, id, signal, version, csrf);
    },
  };
}
