import { readAnonymousJson } from './anonymous-public-read';
import {
  projectUUID,
  validProjectReader,
  validProjectAuthor,
  ProjectClientError,
} from './project-client';
import { publicSlug } from './public-author-client';
export function createPublicProjectClient(fetcher: typeof fetch = fetch) {
  return {
    async read(id: string, signal?: AbortSignal) {
      try {
        if (!projectUUID(id)) throw new ProjectClientError();
        const v = await readAnonymousJson('/__lab/projects/' + id, fetcher, signal, 65536);
        if (!validProjectReader(v, id)) throw new ProjectClientError();
        return v;
      } catch {
        throw new ProjectClientError();
      }
    },
    async author(id: string, signal?: AbortSignal) {
      try {
        if (!publicSlug(id)) throw new ProjectClientError();
        const v = await readAnonymousJson('/__lab/project-authors/' + id, fetcher, signal);
        if (!validProjectAuthor(v, id)) throw new ProjectClientError();
        return v;
      } catch {
        throw new ProjectClientError();
      }
    },
  };
}
