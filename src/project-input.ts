import type { ProjectFields } from './project-types';
/**
 * Characters a one-line field (title, technologies) must not gain from new input: control characters,
 * line/paragraph separators, bidi overrides/isolates/marks and invisible zero-width or format characters.
 * ZWJ/ZWNJ (U+200C/U+200D) stay allowed because emoji sequences and some scripts need them.
 */
export const ONE_LINE_REJECT =
  /[\p{Cc}\p{Zl}\p{Zp}\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/u;
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
  if (mode === 'input' && (ONE_LINE_REJECT.test(x.title) || ONE_LINE_REJECT.test(technologies)))
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
