import { readBoundedJson } from '../shared/http-client';
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
    !exact(v, ['entries', 'enabled', 'nextOffset', 'total', 'capacity']) ||
    !Array.isArray(v.entries) ||
    v.entries.length > 20 ||
    typeof v.enabled !== 'boolean' ||
    v.capacity !== 500 ||
    !Number.isInteger(v.total) ||
    Number(v.total) < 0 ||
    Number(v.total) > 500 ||
    !(
      v.nextOffset === null ||
      (Number.isInteger(v.nextOffset) && Number(v.nextOffset) >= 20 && Number(v.nextOffset) <= 500)
    )
  )
    return false;
  const seen = new Set<string>();
  return v.entries.every((r) => {
    if (
      !exact(r, ['kind', 'contentId', 'title', 'lastViewedAt', 'isSample']) ||
      !isReadingReference({ kind: r.kind, contentId: r.contentId }) ||
      (r.title === null ? r.isSample !== null : typeof r.isSample !== 'boolean') ||
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
    method: 'GET' | 'PUT' | 'DELETE' | 'PATCH',
    body: unknown,
    validate: (value: unknown) => value is T,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<T> {
    let result: unknown;
    try {
      result = await readBoundedJson(
        '/api/private/reading-history' + (offset ? '?offset=' + offset : ''),
        {
          fetcher,
          credentials: 'same-origin',
          method,
          maxBytes: 65536,
          signal,
          ...(body === undefined ? {} : { body, csrf: csrfToken }),
        },
      );
    } catch {
      throw new ReadingHistoryClientError();
    }
    if (!validate(result)) throw new ReadingHistoryClientError();
    return result;
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
