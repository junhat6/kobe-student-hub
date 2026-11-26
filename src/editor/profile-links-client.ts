import { readBoundedJson } from '../shared/http-client';
import {
  PROFILE_LINK_SERVICES,
  normalizeProfileLinkInput,
  validProfileLinks,
  type ProfileLink,
  type ProfileLinkService,
} from '../shared/profile-links';

export type ProfileLinkInput = Partial<Record<ProfileLinkService, string>>;
export class ProfileLinksClientError extends Error {
  constructor() {
    super('リンクの操作結果を確認できませんでした。');
    this.name = 'ProfileLinksClientError';
  }
}
const sameLinks = (a: readonly ProfileLink[], b: readonly ProfileLink[]) =>
  a.length === b.length &&
  a.every((link, i) => link.service === b[i].service && link.url === b[i].url);

/**
 * The owner's own profile links (#313). The server decides ownership from the session; this
 * client never names a profile. A write sends the whole set; an empty field removes that link.
 */
export function createProfileLinksClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  async function request(body?: { links: ProfileLinkInput }): Promise<ProfileLink[]> {
    let result: unknown;
    try {
      result = await readBoundedJson('/api/private/profile/links', {
        fetcher,
        credentials: 'same-origin',
        method: body ? 'PUT' : 'GET',
        maxBytes: 4096,
        ...(body ? { csrf: csrfToken, body } : {}),
      });
    } catch {
      throw new ProfileLinksClientError();
    }
    if (
      result === null ||
      typeof result !== 'object' ||
      Object.keys(result).length !== 1 ||
      !validProfileLinks((result as { links?: unknown }).links)
    )
      throw new ProfileLinksClientError();
    return (result as { links: ProfileLink[] }).links;
  }
  return {
    read: () => request(),
    /** Saves non-empty fields only; resolves to the stored links, which must match the input. */
    async save(input: ProfileLinkInput): Promise<ProfileLink[]> {
      const links: ProfileLinkInput = {};
      for (const service of PROFILE_LINK_SERVICES) {
        const value = input[service]?.trim();
        if (value) links[service] = value;
      }
      const expected = normalizeProfileLinkInput(links);
      if (!expected) throw new ProfileLinksClientError();
      const stored = await request({ links });
      if (!sameLinks(stored, expected)) throw new ProfileLinksClientError();
      return stored;
    },
  };
}
