import type { ProjectFields } from './project-types';
/**
 * Characters a one-line field (title, technologies) must not gain from new input: control characters,
 * line/paragraph separators, every invisible format character (\p{Cf}: bidi marks, zero-width spaces,
 * soft hyphen U+00AD, tag characters and the rest) and every Default_Ignorable_Code_Point (CGJ U+034F,
 * Mongolian variation selectors U+180B–180F, Hangul fillers, U+FFF0–FFF8 and the unassigned E0000 block),
 * plus the braille blank U+2800, private-use characters and noncharacters (U+FDD0–FDEF, U+xFFFE/xFFFF),
 * all of which render as nothing, as blank space or as a box that hides what was typed.
 * ZWJ/ZWNJ (U+200C/U+200D) stay allowed because emoji sequences and some scripts need them; tag characters
 * stay allowed only inside the three RGI subdivision flags after 🏴 (U+1F3F4). The variation selectors
 * U+FE00–FE0F (emoji ❤️) and U+E0100–E01EF (kanji variants in names) stay allowed, but like every combining
 * mark they must follow a visible base character (MARK_DETACHED) and a run is capped (MARK_RUN).
 * Unassigned code points are not refused: \p{Cn} depends on each browser's Unicode version, so a newer
 * emoji would be refused on an older phone while the server accepts it.
 */
const ONE_LINE_REJECT =
  /(?![\u200C\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Default_Ignorable_Code_Point}\u2800\uFDD0-\uFDEF]/u;
// A combining mark (including a variation selector) at the start or after a space attaches to nothing.
const MARK_DETACHED = /(?:^|\s)\p{M}/u;
// Five or more marks in a row: real scripts and emoji need at most 3 (Thai, keycap 1️⃣ is 2); Zalgo text stacks dozens.
const MARK_RUN = /\p{M}{5}/u;
// Only the three RGI subdivision flags (England, Scotland, Wales); a longer tag run could smuggle hidden text.
const TAG_FLAG =
  /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu;
/** The first character new one-line input may not contain, as "U+XXXX", or null when the text is fine. */
export function oneLineRejectedCodePoint(value: string): string | null {
  const v = value.replace(TAG_FLAG, '\u{1F3F4}');
  const hit =
    ONE_LINE_REJECT.exec(v)?.[0] ??
    MARK_DETACHED.exec(v)?.[0].replace(/^\s/u, '') ??
    MARK_RUN.exec(v)?.[0] ??
    Array.from(v).find((c) => ((c.codePointAt(0) as number) & 0xfffe) === 0xfffe);
  return hit === undefined
    ? null
    : `U+${(hit.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`;
}
function hasOneLineRejected(value: string): boolean {
  return oneLineRejectedCodePoint(value) !== null;
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
