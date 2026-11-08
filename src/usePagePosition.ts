import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { readListOrigin, safeListPath } from './navigation';
interface View {
  y: number;
  entryId?: string;
  searchFocus?: boolean;
}
// Ephemeral, bounded, per-app-instance navigation state; no storage, cookie or network writes.
export function usePagePosition(ready: boolean) {
  const location = useLocation();
  const action = useNavigationType();
  const views = useRef(new Map<string, View>());
  const previous = useRef('');
  useLayoutEffect(() => {
    if (!ready) return;
    const focusView = (view: View) => {
      const link = view.entryId
        ? [...document.querySelectorAll<HTMLAnchorElement>('[data-entry-id]')].find(
            (e) => e.dataset.entryId === view.entryId,
          )
        : null;
      (
        link ??
        (view.searchFocus ? document.getElementById('search') : null) ??
        document.querySelector<HTMLElement>('main')
      )?.focus({ preventScroll: true });
      window.scrollTo({ top: view.y, left: 0, behavior: 'instant' });
    };
    const origin = readListOrigin(
      location.state?.restoreList,
      safeListPath(location.pathname + location.search),
    );
    const saved = action === 'POP' ? views.current.get(location.key) : undefined;
    if (saved) focusView(saved);
    else if (origin) focusView(origin);
    else if (previous.current !== location.pathname) {
      document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
    previous.current = location.pathname;
    const capture = () => {
      const active = document.activeElement as HTMLElement | null;
      views.current.set(location.key, {
        y: window.scrollY,
        entryId: active?.dataset.entryId,
        searchFocus: active?.id === 'search',
      });
      if (views.current.size > 50) views.current.delete(views.current.keys().next().value!);
    };
    capture();
    window.addEventListener('scroll', capture, { passive: true });
    document.addEventListener('focusin', capture);
    return () => {
      window.removeEventListener('scroll', capture);
      document.removeEventListener('focusin', capture);
    };
  }, [location.key, ready, action]);
}
