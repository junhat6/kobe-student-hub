import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Long enough for the slowest account read on a phone; the landing never fights the reader after it.
const SETTLE_MS = 10_000;
const READER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Brings a section named by the URL hash into view on a page whose content loads in parts.
 * The browser only scrolls to a hash once, before the account reads finish, so links such as
 * /account#enrollment from the drafts screen used to land on the page top. This keeps the
 * section at the top while earlier parts grow, and stops at the reader's first own input.
 */
export function useHashLanding(ids: readonly string[]) {
  const { hash, key } = useLocation();
  const id = hash.slice(1);
  const known = ids.includes(id);
  useEffect(() => {
    if (!known) return;
    let focused = false;
    const align = () => {
      const target = document.getElementById(id);
      if (!target) return;
      if (!focused) {
        focused = true;
        // Screen readers start reading at the section the link promised, not at the page top.
        target.focus({ preventScroll: true });
      }
      target.scrollIntoView({ block: 'start' });
    };
    const resize = new ResizeObserver(align);
    resize.observe(document.body);
    align();
    const stop = () => {
      resize.disconnect();
      window.clearTimeout(timer);
      for (const name of READER_INPUT) window.removeEventListener(name, stop, true);
    };
    const timer = window.setTimeout(stop, SETTLE_MS);
    for (const name of READER_INPUT)
      window.addEventListener(name, stop, { capture: true, passive: true });
    return stop;
    // key: a second click on the same link lands again.
  }, [id, known, key]);
}
