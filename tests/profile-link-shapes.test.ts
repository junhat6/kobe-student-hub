import { describe, expect, it } from 'vitest';
import {
  normalizeProfileLink,
  normalizeProfileLinkInput,
  validProfileLink,
  validProfileLinks,
  type ProfileLinkService,
} from '../src/shared/profile-links';

const accepts: [ProfileLinkService, string, string][] = [
  ['x', 'https://x.com/kobe_student', 'https://x.com/kobe_student'],
  ['x', 'x.com/kobe_student/', 'https://x.com/kobe_student'],
  ['x', 'https://twitter.com/Kobe_1', 'https://x.com/Kobe_1'],
  ['x', 'http://www.twitter.com/abc', 'https://x.com/abc'],
  ['x', '  https://X.COM/abc  ', 'https://x.com/abc'],
  ['github', 'https://github.com/octo-cat', 'https://github.com/octo-cat'],
  ['github', 'github.com/a', 'https://github.com/a'],
  ['github', 'https://www.github.com/' + 'a'.repeat(39), 'https://github.com/' + 'a'.repeat(39)],
  [
    'linkedin',
    'https://www.linkedin.com/in/kobe-student',
    'https://www.linkedin.com/in/kobe-student',
  ],
  ['linkedin', 'linkedin.com/in/abc/', 'https://www.linkedin.com/in/abc'],
  ['website', 'https://example.com', 'https://example.com/'],
  ['website', 'https://blog.example.jp/me/works', 'https://blog.example.jp/me/works'],
  ['website', 'HTTPS://Example.COM/A', 'https://example.com/A'],
];
const refuses: [ProfileLinkService, string][] = [
  // X: other hosts, extra path, query/hash, bad names, the service's own pages.
  ['x', 'https://example.com/kobe'],
  ['x', 'https://x.com.evil.example/kobe'],
  ['x', 'https://x.com/kobe/status/1'],
  ['x', 'https://x.com/kobe?s=21'],
  ['x', 'https://x.com/kobe#top'],
  ['x', 'https://x.com/kobe?'],
  ['x', 'https://x.com/' + 'a'.repeat(16)],
  ['x', 'https://x.com/ko-be'],
  ['x', 'https://x.com/home'],
  ['x', 'https://x.com/'],
  ['x', '@kobe'],
  ['x', 'https://user:pass@x.com/kobe'],
  ['x', 'https://x.com:8443/kobe'],
  ['x', 'javascript:alert(1)//x.com/kobe'],
  ['x', 'ftp://x.com/kobe'],
  // GitHub
  ['github', 'https://github.com/octo/repo'],
  ['github', 'https://github.com/-octo'],
  ['github', 'https://github.com/octo-'],
  ['github', 'https://github.com/oc--to'],
  ['github', 'https://github.com/' + 'a'.repeat(40)],
  ['github', 'https://github.com/settings'],
  ['github', 'https://gist.github.com/octo'],
  ['github', 'https://github.io/octo'],
  // LinkedIn
  ['linkedin', 'https://www.linkedin.com/company/kobe'],
  ['linkedin', 'https://www.linkedin.com/in/'],
  ['linkedin', 'https://www.linkedin.com/in/ab'],
  ['linkedin', 'https://www.linkedin.com/in/a--b'],
  ['linkedin', 'https://www.linkedin.com/in/abc/details'],
  ['linkedin', 'https://jp.linkedin.com/in/abc'],
  // Website: https only, no credentials, IP literals, local names, ports, overlong, non-ASCII.
  ['website', 'http://example.com'],
  ['website', 'example.com'],
  ['website', 'javascript:alert(1)'],
  ['website', 'data:text/html,hi'],
  ['website', 'https://user:pw@example.com'],
  ['website', 'https://user@example.com'],
  ['website', 'https://127.0.0.1/'],
  ['website', 'https://2130706433/'],
  ['website', 'https://0x7f.1/'],
  ['website', 'https://[::1]/'],
  ['website', 'https://localhost/'],
  ['website', 'https://printer.local/'],
  ['website', 'https://intranet/'],
  ['website', 'https://example.com:8443/'],
  ['website', 'https://example.com/?q=1'],
  ['website', 'https://example.com/#a'],
  ['website', 'https://例え.jp/'],
  ['website', 'https://example.com/ ' + 'a'],
  ['website', 'https://example.com/' + 'a'.repeat(181)],
  ['website', ''],
];

describe('profile link shapes (#313)', () => {
  it.each(accepts)('%s accepts %s', (service, raw, stored) => {
    expect(normalizeProfileLink(service, raw)).toBe(stored);
    // The stored form is its own normal form, so a public read accepts it again.
    expect(normalizeProfileLink(service, stored)).toBe(stored);
    expect(validProfileLink({ service, url: stored })).toBe(true);
  });
  it.each(refuses)('%s refuses %s', (service, raw) => {
    expect(normalizeProfileLink(service, raw)).toBeNull();
  });
  it('takes the website length bound at exactly 200 characters', () => {
    const at = 'https://example.com/' + 'a'.repeat(180);
    expect(at).toHaveLength(200);
    expect(normalizeProfileLink('website', at)).toBe(at);
    expect(normalizeProfileLink('website', at + 'a')).toBeNull();
  });
  it('only accepts an object of service keys with string values', () => {
    expect(normalizeProfileLinkInput({})).toEqual([]);
    expect(normalizeProfileLinkInput({ website: 'https://example.com', x: 'x.com/abc' })).toEqual([
      { service: 'x', url: 'https://x.com/abc' },
      { service: 'website', url: 'https://example.com/' },
    ]);
    for (const bad of [
      null,
      [],
      'x.com/abc',
      { x: 1 },
      { x: null },
      { instagram: 'https://instagram.com/abc' },
      { x: 'x.com/abc', github: 'nope' },
      Object.create({ x: 'x.com/abc' }),
    ])
      expect(normalizeProfileLinkInput(bad)).toBeNull();
  });
  it('rejects stored lists out of order, duplicated, too long or not normalized', () => {
    const x = { service: 'x', url: 'https://x.com/abc' };
    const gh = { service: 'github', url: 'https://github.com/abc' };
    expect(validProfileLinks([])).toBe(true);
    expect(validProfileLinks([x, gh])).toBe(true);
    expect(validProfileLinks([gh, x])).toBe(false);
    expect(validProfileLinks([x, x])).toBe(false);
    expect(validProfileLinks([{ service: 'x', url: 'https://twitter.com/abc' }])).toBe(false);
    expect(validProfileLinks([{ ...x, extra: 1 }])).toBe(false);
    expect(validProfileLinks([{ service: 'website', url: 'javascript:alert(1)' }])).toBe(false);
  });
});
