/**
 * Links a student puts on their public profile (#313): one each for X, GitHub, LinkedIn and a
 * website. The same module checks input in the browser, on the server before a write, and on
 * every public read, so a stored value that no longer fits is never shown as a link.
 *
 * Only the student types these. Nothing comes from the Google account or the email address.
 * The stored value is the normalized URL (one form per service), never what was typed.
 */
export const PROFILE_LINK_SERVICES = ['x', 'github', 'linkedin', 'website'] as const;
export type ProfileLinkService = (typeof PROFILE_LINK_SERVICES)[number];
export interface ProfileLink {
  service: ProfileLinkService;
  url: string;
}
/** Longest accepted input and stored URL. */
export const PROFILE_LINK_MAX = 200;

export const PROFILE_LINK_LABELS: Record<ProfileLinkService, string> = {
  x: 'X',
  github: 'GitHub',
  linkedin: 'LinkedIn',
  website: 'Webサイト',
};

const X_NAME = /^[A-Za-z0-9_]{1,15}$/;
// GitHub: letters, digits and single inner hyphens, at most 39 characters.
const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const LINKEDIN_ID = /^[A-Za-z0-9](?:[A-Za-z0-9-]{1,98})[A-Za-z0-9]$/;
// First path segments that are pages of the service itself, not a person.
const X_RESERVED = new Set([
  'home',
  'explore',
  'search',
  'i',
  'settings',
  'messages',
  'notifications',
  'intent',
  'share',
  'login',
  'logout',
  'signup',
  'tos',
  'privacy',
  'compose',
  'hashtag',
]);
const GITHUB_RESERVED = new Set([
  'about',
  'apps',
  'codespaces',
  'collections',
  'explore',
  'features',
  'issues',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'settings',
  'signup',
  'sponsors',
  'topics',
  'trending',
]);
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

function parse(raw: string, allowBare: boolean): URL | null {
  if (typeof raw !== 'string' || raw.length > PROFILE_LINK_MAX) return null;
  const value = raw.trim();
  if (!value || !PRINTABLE_ASCII.test(value)) return null;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(value);
  // A bare "github.com/name" is fine for the three services; the website must say https.
  if (!scheme && !allowBare) return null;
  if (scheme && !/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(scheme ? value : 'https://' + value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  // `?`/`#` with nothing after them leave search/hash empty; refuse them too.
  if (/[?#]/.test(value)) return null;
  return url;
}

/** One path segment, with an optional trailing slash. */
function segments(url: URL): string[] | null {
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  if (!path.startsWith('/')) return null;
  const parts = path.slice(1).split('/');
  return parts.every((part) => part.length > 0) ? parts : null;
}

function normalizeX(raw: string): string | null {
  const url = parse(raw, true);
  if (!url || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname))
    return null;
  const parts = segments(url);
  if (!parts || parts.length !== 1) return null;
  const name = parts[0];
  if (!X_NAME.test(name) || X_RESERVED.has(name.toLowerCase())) return null;
  return 'https://x.com/' + name;
}

function normalizeGitHub(raw: string): string | null {
  const url = parse(raw, true);
  if (!url || !['github.com', 'www.github.com'].includes(url.hostname)) return null;
  const parts = segments(url);
  if (!parts || parts.length !== 1) return null;
  const name = parts[0];
  if (!GITHUB_NAME.test(name) || GITHUB_RESERVED.has(name.toLowerCase())) return null;
  return 'https://github.com/' + name;
}

function normalizeLinkedIn(raw: string): string | null {
  const url = parse(raw, true);
  if (!url || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname)) return null;
  const parts = segments(url);
  if (!parts || parts.length !== 2 || parts[0] !== 'in') return null;
  const id = parts[1];
  if (!LINKEDIN_ID.test(id) || id.includes('--')) return null;
  return 'https://www.linkedin.com/in/' + id;
}

const IPV4 = /^\d+(?:\.\d+){0,3}$/;
function normalizeWebsite(raw: string): string | null {
  if (typeof raw !== 'string' || !/^https:\/\//i.test(raw.trim())) return null;
  const url = parse(raw, false);
  if (!url || url.protocol !== 'https:') return null;
  const host = url.hostname;
  // No IP literals, no single-label or local names: a site the reader can actually reach.
  if (!host || host.startsWith('[') || IPV4.test(host) || /^0x/i.test(host)) return null;
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((label) => !label)) return null;
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i.test(host)) return null;
  const href = url.href;
  if (href.length > PROFILE_LINK_MAX || !PRINTABLE_ASCII.test(href)) return null;
  return href;
}

const normalizers: Record<ProfileLinkService, (raw: string) => string | null> = {
  x: normalizeX,
  github: normalizeGitHub,
  linkedin: normalizeLinkedIn,
  website: normalizeWebsite,
};

/** The stored form of a typed link, or null when it is not an accepted shape for the service. */
export function normalizeProfileLink(service: ProfileLinkService, raw: string): string | null {
  return Object.hasOwn(normalizers, service) ? normalizers[service](raw) : null;
}

/** A stored or received URL is valid only if it is already in its own normalized form. */
export function validProfileLink(value: unknown): value is ProfileLink {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2
  )
    return false;
  const { service, url } = value as Record<string, unknown>;
  return (
    typeof service === 'string' &&
    (PROFILE_LINK_SERVICES as readonly string[]).includes(service) &&
    typeof url === 'string' &&
    normalizeProfileLink(service as ProfileLinkService, url) === url
  );
}

/** At most one per service, in the fixed service order. */
export function validProfileLinks(value: unknown): value is ProfileLink[] {
  if (!Array.isArray(value) || value.length > PROFILE_LINK_SERVICES.length) return false;
  let previous = -1;
  for (const link of value) {
    if (!validProfileLink(link)) return false;
    const index = PROFILE_LINK_SERVICES.indexOf(link.service);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

/**
 * The write body: an object with only service keys, each a string. A missing key means the
 * service has no link. Null when any key or value is not accepted.
 */
export function normalizeProfileLinkInput(value: unknown): ProfileLink[] | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return null;
  const input = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(input);
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' || !(PROFILE_LINK_SERVICES as readonly string[]).includes(key),
    )
  )
    return null;
  const links: ProfileLink[] = [];
  for (const service of PROFILE_LINK_SERVICES) {
    if (!Object.hasOwn(input, service)) continue;
    const raw = input[service];
    if (typeof raw !== 'string') return null;
    const url = normalizeProfileLink(service, raw);
    if (url === null) return null;
    links.push({ service, url });
  }
  return links;
}
