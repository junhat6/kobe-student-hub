import { useEffect } from 'react';
import { authoringUiEnabled } from '../account/routes';
import {
  createAuthorSessionGuard,
  createSessionClient,
  type AuthorSessionGuard,
} from '../editor/session-client';
import { createReadingHistoryClient } from './client';
import type { ReadingReference } from './types';
/** Best effort after a successful public read. Failure never changes the reader UI. */
export function RecordReadingHistory({ kind, contentId }: ReadingReference) {
  useEffect(() => {
    if (!authoringUiEnabled || document.visibilityState !== 'visible') return;
    const controller = new AbortController();
    let guard: AuthorSessionGuard | undefined;
    const cancel = () => {
      controller.abort();
      guard?.invalidate();
    };
    const suspend = () => {
      if (document.visibilityState !== 'visible') cancel();
    };
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', suspend);
    void (async () => {
      try {
        const csrfToken = await createSessionClient().peek(controller.signal);
        if (controller.signal.aborted) return;
        guard = createAuthorSessionGuard({
          csrfToken,
          origin: location.origin,
          onMismatch: cancel,
          onUnverified: cancel,
        });
        await createReadingHistoryClient(csrfToken, guard.fetcher).record(
          { kind, contentId },
          controller.signal,
        );
      } catch {
        /* Reading never waits for or displays private history failures. */
      }
    })();
    return () => {
      cancel();
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', suspend);
    };
  }, [kind, contentId]);
  return null;
}
