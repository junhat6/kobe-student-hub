import type { ProjectFields } from './project-types';
export function normalizeProjectFields(value: unknown): ProjectFields | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return null;
  const x = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(x).length !== 4 ||
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
    : { title: x.title, description: x.description, githubUrl, demoUrl };
}
