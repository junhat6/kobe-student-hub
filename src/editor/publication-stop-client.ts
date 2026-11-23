import { readBoundedJson } from '../shared/http-client';
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
    let result: unknown;
    try {
      result = await readBoundedJson('/api/private/publication-stops/' + kind + '/' + publicId, {
        fetcher,
        credentials: 'same-origin',
        method: expectedVersion === undefined ? 'GET' : 'POST',
        maxBytes: 65536,
        signal,
        ...(expectedVersion === undefined
          ? {}
          : { csrf, body: { expectedSourceVersion: expectedVersion, confirmStop: true } }),
      });
    } catch {
      throw new PublicationStopClientError();
    }
    if (
      !valid(result, kind, publicId) ||
      (expectedVersion !== undefined &&
        (!result.stopped || result.sourceVersion !== expectedVersion))
    )
      throw new PublicationStopClientError();
    return result;
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
