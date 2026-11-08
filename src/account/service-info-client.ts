import { readAnonymousJson } from '../editor/anonymous-public-read';
import { isPublicServiceInfo, type PublicServiceInfo } from '../shared/service-info';

export function createServiceInfoClient(fetcher: typeof fetch = fetch) {
  return {
    async read(signal?: AbortSignal): Promise<PublicServiceInfo> {
      const value = await readAnonymousJson('/api/service-info', fetcher, signal, 4096);
      if (!isPublicServiceInfo(value)) throw new Error('Invalid public service information');
      return value;
    },
  };
}
