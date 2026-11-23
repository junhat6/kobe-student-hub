import { readBoundedJson } from '../shared/http-client';
import { publicKeys } from './public-author-client';
export class LikeClientError extends Error {
  constructor() {
    super('いいねの状態を確認できませんでした。');
    this.name = 'LikeClientError';
  }
}
export function createLikesClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  async function request(
    contentId: string,
    desired?: boolean,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (
      (desired !== undefined && typeof desired !== 'boolean') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(contentId) ||
      (desired !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(csrfToken))
    )
      throw new LikeClientError();
    let result: unknown;
    try {
      result = await readBoundedJson('/api/private/article-likes/' + contentId, {
        fetcher,
        credentials: 'same-origin',
        method: desired === undefined ? 'GET' : 'PUT',
        maxBytes: 4096,
        signal,
        ...(desired === undefined
          ? {}
          : {
              csrf: csrfToken,
              body: desired ? { liked: true, confirmPublic: true } : { liked: false },
            }),
      });
    } catch {
      throw new LikeClientError();
    }
    if (
      !publicKeys(result, ['liked']) ||
      typeof result.liked !== 'boolean' ||
      (desired !== undefined && result.liked !== desired)
    )
      throw new LikeClientError();
    return result.liked;
  }
  return {
    read: (id: string, signal?: AbortSignal) => request(id, undefined, signal),
    set: (id: string, liked: boolean, signal?: AbortSignal) => request(id, liked, signal),
  };
}
