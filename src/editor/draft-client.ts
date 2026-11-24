import { readBoundedJson } from '../shared/http-client';
export interface DraftSummary {
  id: string;
  title: string;
  version: number;
  updatedAt: number;
}
export interface EditorDraft extends DraftSummary {
  body: string;
}
const ROOT = '/api/private/drafts';
const LIMIT = 2 * 1024 * 1024;
const validId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function keys(v: unknown, wanted: string[]): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === wanted.length &&
    wanted.every((k) => Object.hasOwn(v, k))
  );
}
function summary(v: unknown): v is DraftSummary {
  return keys(v, ['id', 'title', 'version', 'updatedAt']) && fields(v);
}
function fields(v: Record<string, unknown>) {
  return (
    validId(v.id) &&
    typeof v.title === 'string' &&
    v.title.length <= 400 &&
    Array.from(v.title).length <= 200 &&
    typeof v.version === 'number' &&
    Number.isSafeInteger(v.version) &&
    v.version >= 1 &&
    typeof v.updatedAt === 'number' &&
    Number.isSafeInteger(v.updatedAt) &&
    v.updatedAt >= 0 &&
    v.updatedAt <= 8640000000000000
  );
}
function draft(v: unknown): v is EditorDraft {
  return (
    keys(v, ['id', 'title', 'body', 'version', 'updatedAt']) &&
    fields(v) &&
    typeof v.body === 'string' &&
    v.body.length <= 262144 &&
    new TextEncoder().encode(v.body).byteLength <= 262144
  );
}
export class DraftClientError extends Error {
  constructor() {
    super('下書きの操作結果を確認できませんでした。');
    this.name = 'DraftClientError';
  }
}
/** Browser client only. Never persists private content or retries a mutation automatically. */
export function createDraftClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  function request(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    // Only mutations carry a body and the CSRF proof; reads send neither.
    return readBoundedJson(path, {
      fetcher,
      credentials: 'same-origin',
      method,
      ...(body === undefined ? {} : { body, csrf: csrfToken }),
      status: method === 'POST' ? 201 : 200,
      maxBytes: LIMIT,
    }).catch(() => {
      throw new DraftClientError();
    });
  }
  const readId = (id: string) => {
    if (!validId(id)) throw new DraftClientError();
    return ROOT + '/' + id;
  };
  return {
    async list(): Promise<DraftSummary[]> {
      const result = await request(ROOT);
      if (
        !Array.isArray(result) ||
        result.length > 20 ||
        !result.every(summary) ||
        new Set(result.map((v) => v.id)).size !== result.length
      )
        throw new DraftClientError();
      return result;
    },
    async createEmpty(): Promise<EditorDraft> {
      const result = await request(ROOT, 'POST', { title: '', body: '' });
      if (!draft(result) || result.title !== '' || result.body !== '' || result.version !== 1)
        throw new DraftClientError();
      return result;
    },
    async read(id: string): Promise<EditorDraft> {
      const result = await request(readId(id));
      if (!draft(result) || result.id !== id) throw new DraftClientError();
      return result;
    },
    async save(value: EditorDraft): Promise<EditorDraft> {
      const result = await request(readId(value.id), 'PATCH', {
        title: value.title,
        body: value.body,
        expectedVersion: value.version,
      });
      if (
        !draft(result) ||
        result.id !== value.id ||
        result.version !== value.version + 1 ||
        result.title !== value.title ||
        result.body !== value.body
      )
        throw new DraftClientError();
      return result;
    },
    async delete(id: string, expectedVersion: number): Promise<void> {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw new DraftClientError();
      const result = await request(readId(id), 'DELETE', { expectedVersion });
      if (!keys(result, ['deleted']) || result.deleted !== true) throw new DraftClientError();
    },
  };
}
