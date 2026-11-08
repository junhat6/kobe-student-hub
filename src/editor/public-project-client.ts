import { readAnonymousJson } from './anonymous-public-read';
import {
  projectUUID,
  validProjectReader,
  validProjectAuthor,
  ProjectClientError,
} from './project-client';
import { publicSlug } from './public-author-client';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
export function createPublicProjectClient(
  fetcher: typeof fetch = fetch,
  surface: PublicSurface = 'lab',
) {
  return {
    async read(id: string, signal?: AbortSignal) {
      try {
        if (!projectUUID(id)) throw new ProjectClientError();
        const v = await readAnonymousJson(
          publicPaths(surface).projectApi(id),
          fetcher,
          signal,
          65536,
        );
        if (!validProjectReader(v, id)) throw new ProjectClientError();
        return v;
      } catch {
        throw new ProjectClientError();
      }
    },
    async author(id: string, signal?: AbortSignal) {
      try {
        if (!publicSlug(id)) throw new ProjectClientError();
        const v = await readAnonymousJson(
          publicPaths(surface).projectAuthorApi(id),
          fetcher,
          signal,
        );
        if (!validProjectAuthor(v, id)) throw new ProjectClientError();
        return v;
      } catch {
        throw new ProjectClientError();
      }
    },
  };
}
