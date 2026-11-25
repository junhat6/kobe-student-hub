import React from 'react';
import { accountUiEnabled, authoringUiEnabled } from '../account/routes';

/**
 * A lazily loaded screen that can be fetched before the reader navigates to it (#272).
 *
 * React 19 holds back the content of a Suspense boundary for about 300 ms once its fallback has
 * shown, so a route that suspends on its chunk waits that long even when the chunk arrives
 * sooner, and the whole body is replaced by a one-line fallback meanwhile. Once `preload()` has
 * finished, the screen renders synchronously: no fallback, no throttle. Only code is fetched;
 * no request carries the session or reads private data.
 */
function preloadable<P extends object>(load: () => Promise<{ default: React.ComponentType<P> }>) {
  let loaded: React.ComponentType<P> | null = null;
  let pending: Promise<unknown> | null = null;
  const fetchModule = () =>
    load().then((module) => {
      loaded = module.default;
      return module;
    });
  const Lazy = React.lazy(fetchModule);
  function Screen(props: P) {
    // Decided once per mount: switching from Lazy to the loaded type later would remount the
    // screen and drop its state (an open editor, a confirmed session).
    const [Loaded] = React.useState(() => loaded);
    return Loaded ? (
      <Loaded {...props} />
    ) : (
      <Lazy {...(props as React.ComponentProps<typeof Lazy>)} />
    );
  }
  Screen.preload = () => {
    // A failed fetch is retried on the next hint; the route itself still shows its error path.
    if (!loaded && !pending)
      pending = fetchModule().then(
        () => undefined,
        () => {
          pending = null;
        },
      );
  };
  return Screen;
}

export const AccountPage = preloadable(() => import('../account/AccountPage'));
export const HistoryPage = preloadable(() => import('../history/HistoryPage'));
export const OrdinaryDrafts = preloadable(() => import('../account/OrdinaryDrafts'));
export const OrdinaryProjects = preloadable(() => import('../account/OrdinaryProjects'));
export const Community = preloadable(() => import('../community/Community'));

/** Fetches the screens the header menus lead to, when the reader reaches for a menu. */
export function preloadMenuScreens() {
  Community.preload();
  if (!accountUiEnabled) return;
  AccountPage.preload();
  HistoryPage.preload();
  if (!authoringUiEnabled) return;
  OrdinaryDrafts.preload();
  OrdinaryProjects.preload();
}
