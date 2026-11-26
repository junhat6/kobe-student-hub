import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createSessionClient, SessionClientError } from '../editor/session-client';
import { authoringUiEnabled } from '../account/routes';
import { avatarVersion } from '../shared/avatar';

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
      /** null: no public profile yet. undefined: it could not be read right now. */
      /** `avatar` is the own icon version (#205); null when none or unreadable right now. */
      profile:
        { id: string; name: string; initials: string; avatar: string | null } | null | undefined;
    };

/**
 * Whether the last answer from the server proved a session: 'present' as soon as the first
 * read-only proof succeeds (before the profile is read), 'absent' on a definite signed-out
 * answer, null before any answer. It is kept while a later re-check runs, so layout that only
 * depends on "signed in or not" (the home band, #309) does not flicker on each focus re-read.
 * Display only, like Viewer.
 */
export type SessionHint = 'present' | 'absent' | null;

interface ViewerContextValue {
  viewer: Viewer;
  session: SessionHint;
  refresh: () => void;
  logout: () => Promise<boolean>;
}

const ViewerContext = createContext<ViewerContextValue>({
  viewer: { status: 'signed-out' },
  session: 'absent',
  refresh: () => {},
  logout: async () => false,
});

/** The own icon version for the header; any failure shows the initial instead. */
async function readOwnAvatar(signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch('/api/private/profile-avatar', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const avatar = (body as { avatar?: unknown } | null)?.avatar;
    return avatarVersion(avatar) ? avatar : null;
  } catch {
    return null;
  }
}

async function readOwnProfile(signal: AbortSignal) {
  try {
    const response = await fetch('/api/private/profile', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    const profile = (body as { profile?: unknown } | null)?.profile as
      { id?: unknown; displayName?: unknown; initials?: unknown } | null | undefined;
    if (profile === null) return null;
    if (
      !profile ||
      typeof profile.id !== 'string' ||
      typeof profile.displayName !== 'string' ||
      typeof profile.initials !== 'string'
    )
      return undefined;
    return {
      id: profile.id,
      name: profile.displayName,
      initials: profile.initials,
      avatar: await readOwnAvatar(signal),
    };
  } catch {
    // A temporary failure is not "no profile": callers must not suggest creating one.
    return undefined;
  }
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createSessionClient(), []);
  const [viewer, setViewer] = useState<Viewer>(
    authoringUiEnabled ? { status: 'loading' } : { status: 'signed-out' },
  );
  const [session, setSession] = useState<SessionHint>(authoringUiEnabled ? null : 'absent');
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  // The token the shown name belongs to; a different token must never show the old name.
  const shownToken = useRef<string | null>(null);
  useEffect(() => {
    if (!authoringUiEnabled) return;
    const controller = new AbortController();
    (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const csrfToken = await client.peek(controller.signal);
          if (controller.signal.aborted) return;
          setSession('present');
          if (csrfToken !== shownToken.current) {
            shownToken.current = null;
            setViewer({ status: 'loading' });
          }
          const profile = await readOwnProfile(controller.signal);
          // The profile is read by cookie; confirm the session did not change in between,
          // so one account's token is never paired with another account's name.
          const after = await client.peek(controller.signal);
          if (controller.signal.aborted) return;
          if (after !== csrfToken) continue;
          shownToken.current = csrfToken;
          setViewer({ status: 'signed-in', csrfToken, profile });
          return;
        }
        shownToken.current = null;
        setViewer({ status: 'unknown' });
      } catch (error) {
        if (controller.signal.aborted) return;
        shownToken.current = null;
        const signedOut = error instanceof SessionClientError && error.kind === 'signed-out';
        if (signedOut) setSession('absent');
        setViewer(signedOut ? { status: 'signed-out' } : { status: 'unknown' });
      }
    })();
    return () => controller.abort();
  }, [client, generation]);
  useEffect(() => {
    if (!authoringUiEnabled) return;
    // Another tab or window may have logged in or out; re-read when the reader comes back.
    // Side-by-side windows fire focus without visibilitychange, so listen to both.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onChanged = () => {
      shownToken.current = null;
      setViewer({ status: 'loading' });
      refresh();
    };
    // A private screen proved a session the header could not read (e.g. after an outage);
    // re-read so the header stops offering "ログイン" to a signed-in reader.
    const onConfirmed = () => {
      const status = viewerRef.current.status;
      if (status === 'unknown' || status === 'signed-out') refresh();
    };
    // Public pages never check the session themselves: when the connection comes back (a public
    // read succeeded or the browser is online again), re-read a session the header lost to the
    // outage. "signed-out" was a definite server answer, so it is not re-read here.
    const onReachable = () => {
      if (viewerRef.current.status !== 'unknown') return;
      // One re-check per recovery: a page firing several reads must not queue several.
      viewerRef.current = { status: 'loading' };
      setViewer(viewerRef.current);
      refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    window.addEventListener('ksh:session-changed', onChanged);
    window.addEventListener('ksh:session-confirmed', onConfirmed);
    window.addEventListener('ksh:server-reachable', onReachable);
    window.addEventListener('online', onReachable);
    return () => {
      window.removeEventListener('ksh:server-reachable', onReachable);
      window.removeEventListener('online', onReachable);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ksh:session-changed', onChanged);
      window.removeEventListener('ksh:session-confirmed', onConfirmed);
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
  const value = useMemo(
    () => ({ viewer, session, refresh, logout }),
    [viewer, session, refresh, logout],
  );
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export const useViewer = () => useContext(ViewerContext);

/** Lets private screens tell the header that the session may have changed. */
export const announceSessionChange = () => window.dispatchEvent(new Event('ksh:session-changed'));

/** Lets private screens tell the header they confirmed a session; carries no token. */
export const announceSessionConfirmed = () =>
  window.dispatchEvent(new Event('ksh:session-confirmed'));
