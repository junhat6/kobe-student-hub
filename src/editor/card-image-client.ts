import { readBoundedJson } from '../shared/http-client';
import { mediaId } from '../shared/media';
import { validCardImageChoice, type CardImageChoice } from '../shared/card-image';

export class CardImageClientError extends Error {
  constructor() {
    super('カードの画像を確認できませんでした。');
  }
}
const common = { credentials: 'same-origin', maxBytes: 256, exactLength: true } as const;
/** The owner's card picture choice for one draft (#311). Every failure is the one opaque error. */
export function createCardImageClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  const path = (kind: 'articles' | 'projects', draftId: string) =>
    `/api/private/card-images/${kind}/${draftId}`;
  async function guarded(run: () => Promise<unknown>): Promise<CardImageChoice> {
    let value: unknown;
    try {
      value = await run();
    } catch {
      throw new CardImageClientError();
    }
    if (!validCardImageChoice(value)) throw new CardImageClientError();
    return value;
  }
  return {
    read(kind: 'articles' | 'projects', draftId: string, signal?: AbortSignal) {
      if (!mediaId(draftId)) return Promise.reject(new CardImageClientError());
      return guarded(() =>
        readBoundedJson(path(kind, draftId), { ...common, fetcher, ...(signal ? { signal } : {}) }),
      );
    },
    /** `null` returns the card to the default (the first image in the body). */
    choose(kind: 'articles' | 'projects', draftId: string, choice: string | null) {
      if (!mediaId(draftId) || (choice !== null && !mediaId(choice)))
        return Promise.reject(new CardImageClientError());
      return guarded(() =>
        readBoundedJson(path(kind, draftId), {
          ...common,
          fetcher,
          method: 'PUT',
          csrf: csrfToken,
          body: { mediaId: choice },
        }),
      );
    },
  };
}
