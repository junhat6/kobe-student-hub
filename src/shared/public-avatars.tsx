import { useEffect, useState } from 'react';
import { authoringUiEnabled } from '../account/routes';
import './avatar.css';
import { PUBLIC_AVATAR_BATCH_MAX, PUBLIC_AVATAR_BATCH_PATH, validPublicAvatar } from './avatar';

/*
 * Author icons on cards, article/project bylines and the header (#205).
 * Cards render many authors at once, so ids asked for in the same tick are sent as one
 * `/api/profile-avatars?ids=` request. The answer is display only: a missing, failed or
 * malformed answer always falls back to the initial, never to an error on the card.
 */
const slug = (v: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const TTL_MS = 5 * 60 * 1000;
/*
 * #252: an answer is trusted without asking again only on the screen that asked for it. A new
 * screen (path or query) shows the remembered icon at once but asks again, so an icon the owner
 * replaced or an operator removed turns into the initial after one batch answer instead of
 * staying for the whole TTL. Not tied to the router: the editor previews render cards without one.
 */
let screen = 0;
let screenHref: string | null = null;
function currentScreen() {
  const href = location.pathname + location.search;
  if (href !== screenHref) {
    screenHref = href;
    screen += 1;
  }
  return screen;
}
type Known = { path: string | null; at: number; screen: number };
const known = new Map<string, Known>();
const waiting = new Map<string, Set<(path: string | null) => void>>();
let pending = new Set<string>();
let scheduled = false;

function settle(id: string, path: string | null, remember: number | null) {
  if (remember !== null) known.set(id, { path, at: Date.now(), screen: remember });
  const listeners = waiting.get(id);
  waiting.delete(id);
  listeners?.forEach((listener) => listener(path));
}

async function lookup(ids: string[], askedOn: number) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${PUBLIC_AVATAR_BATCH_PATH}?ids=${ids.join(',')}`, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const length = response.headers.get('Content-Length');
    if (
      !response.ok ||
      !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
      (length !== null && Number(length) > 16384)
    ) {
      void response.body?.cancel().catch(() => {});
      throw new Error('avatar lookup failed');
    }
    const text = await response.text();
    if (text.length > 16384) throw new Error('avatar lookup failed');
    const body = JSON.parse(text) as unknown;
    const avatars =
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).join(',') === 'avatars'
        ? (body as { avatars: unknown }).avatars
        : null;
    if (
      !avatars ||
      typeof avatars !== 'object' ||
      Array.isArray(avatars) ||
      Object.keys(avatars).length !== ids.length
    )
      throw new Error('avatar lookup failed');
    const map = avatars as Record<string, unknown>;
    if (!ids.every((id) => Object.hasOwn(map, id) && validPublicAvatar(map[id], id)))
      throw new Error('avatar lookup failed');
    for (const id of ids) settle(id, map[id] as string | null, askedOn);
  } catch {
    // Not remembered: the next screen asks again instead of hiding icons for the whole visit.
    for (const id of ids) settle(id, null, null);
  } finally {
    clearTimeout(timer);
  }
}

function flush() {
  scheduled = false;
  const ids = [...pending];
  pending = new Set();
  const askedOn = currentScreen();
  for (let i = 0; i < ids.length; i += PUBLIC_AVATAR_BATCH_MAX)
    void lookup(ids.slice(i, i + PUBLIC_AVATAR_BATCH_MAX), askedOn);
}

function request(id: string, listener: (path: string | null) => void) {
  const listeners = waiting.get(id);
  if (listeners) listeners.add(listener);
  else {
    waiting.set(id, new Set([listener]));
    pending.add(id);
  }
  if (!scheduled) {
    scheduled = true;
    setTimeout(flush, 0);
  }
  return () => {
    waiting.get(id)?.delete(listener);
  };
}

/** Forget one profile's answer, e.g. after the owner changed their own icon. */
export function forgetPublicAvatar(id: string) {
  known.delete(id);
}

/** The public icon path for a profile id, or null while unknown / when there is none. */
export function usePublicAvatar(id: string | undefined): string | null {
  const cached = id ? known.get(id) : undefined;
  // Shown at once (also when another screen asked for it) so cards do not flash the initial.
  const remembered = cached && Date.now() - cached.at < TTL_MS ? cached.path : undefined;
  const [path, setPath] = useState<{ id?: string; value: string | null }>({
    id,
    value: remembered ?? null,
  });
  // A card kept across a screen change (e.g. search results when only the query changes) asks again.
  const here = location.pathname + location.search;
  useEffect(() => {
    if (!authoringUiEnabled || !id || !slug(id) || id.startsWith('sample-')) return;
    const hit = known.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setPath({ id, value: hit.path });
      if (hit.screen === currentScreen()) return;
    }
    return request(id, (value) => setPath({ id, value }));
  }, [id, here]);
  return path.id === id ? path.value : null;
}

/** The author's icon, or their initial when there is none. Decorative: the name is beside it. */
export function AuthorAvatar({
  id,
  initials,
  className,
  size,
}: {
  id: string | undefined;
  initials: string;
  className: string;
  size: number;
}) {
  const src = usePublicAvatar(id);
  const [broken, setBroken] = useState<string | null>(null);
  const image = src && broken !== src ? src : null;
  return (
    <span className={className + (image ? ' has-image' : '')} aria-hidden="true">
      {image ? (
        <img
          src={image}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(image)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
