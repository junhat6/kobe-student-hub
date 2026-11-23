import type { OwnModerationNotice } from '../notification-types';

/**
 * "Read" is remembered only in this browser, as the newest notice time already shown.
 * It holds no notice content or identity, and a cleared or blocked storage just shows the dot again.
 */
const key = 'ksh:notices-seen-at';
const event = 'ksh:notices-seen';

export function readSeenAt(): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export const hasUnseen = (items: readonly OwnModerationNotice[], seenAt: number) =>
  items.some((item) => item.createdAt > seenAt);

export function markSeen(items: readonly OwnModerationNotice[]) {
  const newest = items.reduce((max, item) => Math.max(max, item.createdAt), 0);
  if (newest <= readSeenAt()) return;
  try {
    window.localStorage.setItem(key, String(newest));
  } catch {
    // Storage may be unavailable (private window); the dot then stays until the next visit.
  }
  window.dispatchEvent(new Event(event));
}

export function onSeenChange(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener('storage', listener);
  };
}
