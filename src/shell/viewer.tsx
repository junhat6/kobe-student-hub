import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createSessionClient, SessionClientError } from '../editor/session-client';
import { authoringUiEnabled } from '../account/routes';

/**
 * Header-level view of "who is reading". Display only: every private screen and API
 * still authenticates on the server, and this state is never used to authorize anything.
 */
export type Viewer =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unknown' }
  | {
      status: 'signed-in';
      csrfToken: string;
      profile: { id: string; name: string; initials: string } | null;
    };

interface ViewerContextValue {
  viewer: Viewer;
  refresh: () => void;
  logout: () => Promise<boolean>;
}

const ViewerContext = createContext<ViewerContextValue>({
  viewer: { status: 'signed-out' },
  refresh: () => {},
  logout: async () => false,
});

async function readOwnProfile(signal: AbortSignal) {
  try {
    const response = await fetch('/api/private/profile', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const profile = (body as { profile?: unknown } | null)?.profile as
      { id?: unknown; displayName?: unknown; initials?: unknown } | null | undefined;
    if (
      !profile ||
      typeof profile.id !== 'string' ||
      typeof profile.displayName !== 'string' ||
      typeof profile.initials !== 'string'
    )
      return null;
    return { id: profile.id, name: profile.displayName, initials: profile.initials };
  } catch {
    return null;
  }
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createSessionClient(), []);
  const [viewer, setViewer] = useState<Viewer>(
    authoringUiEnabled ? { status: 'loading' } : { status: 'signed-out' },
  );
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    if (!authoringUiEnabled) return;
    const controller = new AbortController();
    (async () => {
      try {
        const csrfToken = await client.peek(controller.signal);
        const profile = await readOwnProfile(controller.signal);
        if (!controller.signal.aborted) setViewer({ status: 'signed-in', csrfToken, profile });
      } catch (error) {
        if (controller.signal.aborted) return;
        setViewer(
          error instanceof SessionClientError && error.kind === 'signed-out'
            ? { status: 'signed-out' }
            : { status: 'unknown' },
        );
      }
    })();
    return () => controller.abort();
  }, [client, generation]);
  useEffect(() => {
    if (!authoringUiEnabled) return;
    // Another tab may have logged in or out; re-read when the reader comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('ksh:session-changed', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('ksh:session-changed', refresh);
    };
  }, [refresh]);
  const logout = useCallback(async () => {
    if (viewer.status !== 'signed-in') return false;
    try {
      await client.logout(viewer.csrfToken);
    } catch {
      refresh();
      return false;
    }
    // A full reload drops every private buffer held in memory by the previous session.
    window.location.assign('/');
    return true;
  }, [client, viewer, refresh]);
  const value = useMemo(() => ({ viewer, refresh, logout }), [viewer, refresh, logout]);
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export const useViewer = () => useContext(ViewerContext);

/** Lets private screens tell the header that the session may have changed. */
export const announceSessionChange = () => window.dispatchEvent(new Event('ksh:session-changed'));
