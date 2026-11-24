import type { ProjectFields } from './project-types';
/**
 * Characters a one-line field (title, technologies) must not gain from new input: control characters,
 * line/paragraph separators and every invisible format character (\p{Cf}: bidi marks, zero-width spaces,
 * soft hyphen U+00AD, tag characters U+E0001・U+E0020–E007F and the rest), plus the Hangul fillers that
 * render as blank space. ZWJ/ZWNJ (U+200C/U+200D) stay allowed because emoji sequences and some scripts
 * need them, and tag characters stay allowed only inside the three RGI subdivision flags after 🏴 (U+1F3F4).
 */
const ONE_LINE_REJECT = /(?![\u200C\u200D])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0]/u;
// Only the three RGI subdivision flags (England, Scotland, Wales); a longer tag run could smuggle hidden text.
const TAG_FLAG =
  /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu;
function hasOneLineRejected(value: string): boolean {
  return ONE_LINE_REJECT.test(value.replace(TAG_FLAG, '\u{1F3F4}'));
}
/**
 * `input` (default) is for text a person is about to save. `stored` reads rows saved before the one-line
 * rule existed, so an older draft or snapshot never disappears; only NUL and control characters in
 * technologies were refused then.
 */
export function normalizeProjectFields(
  value: unknown,
  mode: 'input' | 'stored' = 'input',
): ProjectFields | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return null;
  const x = value as Record<string, unknown>;
  // `technologies` is optional on input so pages loaded before it existed can still save; it is always returned.
  const hasTechnologies = Object.hasOwn(x, 'technologies');
  if (
    Reflect.ownKeys(x).length !== (hasTechnologies ? 5 : 4) ||
    !['title', 'description', 'githubUrl', 'demoUrl'].every((k) => Object.hasOwn(x, k))
  )
    return null;
  const text = (s: unknown, n: number, bytes: number): s is string =>
    typeof s === 'string' &&
    s.length <= n * 2 &&
    !s.includes('\0') &&
    new TextDecoder().decode(new TextEncoder().encode(s)) === s &&
    Array.from(s).length <= n &&
    new TextEncoder().encode(s).length <= bytes;
  if (!text(x.title, 200, 800) || !text(x.description, 4000, 16384)) return null;
  const technologies = hasTechnologies ? x.technologies : '';
  if (!text(technologies, 100, 400) || /\p{Cc}/u.test(technologies)) return null;
  if (mode === 'input' && (hasOneLineRejected(x.title) || hasOneLineRejected(technologies)))
    return null;
  function url(v: unknown): string | null {
    if (v === '') return '';
    if (!text(v, 2048, 2048) || /[\s\p{Cc}\p{Cf}\\]/u.test(v)) return null;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        new TextEncoder().encode(u.href).length <= 2048
        ? u.href
        : null;
    } catch {
      return null;
    }
  }
  const githubUrl = url(x.githubUrl),
    demoUrl = url(x.demoUrl);
  return githubUrl === null || demoUrl === null
    ? null
    : { title: x.title, description: x.description, githubUrl, demoUrl, technologies };
}
