import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  createPublicAuthorClient,
  PublicAuthorClientError,
} from '../src/editor/public-author-client';
const id = 'profile-fixture-author';
const first = '11111111-1111-4111-8111-111111111111',
  second = '22222222-2222-4222-8222-222222222222';
const author = {
  id,
  name: '架空の投稿者',
  department: 'IT',
  year: '2年',
  bio: '本人が入力した紹介',
  initials: '架',
};
const entry = {
  id: first,
  title: '公開された記事',
  summary: '短い概要',
  tags: ['Git'],
  audience: '初めて読む人',
  prerequisite: '不要',
  outcome: '試せる',
  updatedAt: '2026-11-04',
  minutes: 5,
};
const value = { author, entries: [entry] };
afterEach(() => vi.useRealTimers());
describe('anonymous public author browser client', () => {
  it('reads only the public author endpoint with credentials omitted and no token/bootstrap calls', async () => {
    let path: unknown, init: RequestInit | undefined;
    const fetcher = vi.fn(async (p, i) => {
      path = p;
      init = i;
      return Response.json(value);
    }) as unknown as typeof fetch;
    expect(await createPublicAuthorClient(fetcher).read(id)).toEqual(value);
    expect(path).toBe('/__lab/authors/' + id);
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' });
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves server publication order even when dates match and IDs have the opposite lexical order', async () => {
    const ordered = { author, entries: [{ ...entry, id: second, title: '新しい記事' }, entry] };
    expect(
      (
        await createPublicAuthorClient((async () => Response.json(ordered)) as typeof fetch).read(
          id,
        )
      ).entries.map((e) => e.id),
    ).toEqual([second, first]);
  });
  it('rejects orphan profiles, another author, duplicate cards and over-limit collections', async () => {
    for (const result of [
      { author, entries: [] },
      { ...value, author: { ...author, id: 'another-author' } },
      { author, entries: [entry, entry] },
      { author, entries: Array(21).fill(entry) },
    ])
      await expect(
        createPublicAuthorClient((async () => Response.json(result)) as typeof fetch).read(id),
      ).rejects.toBeInstanceOf(PublicAuthorClientError);
  });
  it('accepts only the exact public DTO and never accepts article bodies or private identity fields', async () => {
    for (const result of [
      { ...value, accountId: 'PRIVATE' },
      { ...value, author: { ...author, email: 'PRIVATE_EMAIL' } },
      { author, entries: [{ ...entry, body: 'PRIVATE_BODY' }] },
      { author, entries: [{ ...entry, authorId: id }] },
      { author, entries: [{ ...entry, relatedIds: [] }] },
    ])
      await expect(
        createPublicAuthorClient((async () => Response.json(result)) as typeof fetch).read(id),
      ).rejects.toThrow('投稿者の公開情報を確認できませんでした。');
  });
  it('bounds public text/tags/minutes and rejects malformed Unicode or mismatched field types', async () => {
    for (const result of [
      { ...value, author: { ...author, bio: '\ud800' } },
      { ...value, author: { ...author, name: ' ' } },
      { author, entries: [{ ...entry, summary: 'x'.repeat(301) }] },
      { author, entries: [{ ...entry, outcome: '\0' }] },
      { author, entries: [{ ...entry, tags: ['Ａ', 'A'] }] },
      { author, entries: [{ ...entry, tags: Array(6).fill('x') }] },
      { author, entries: [{ ...entry, minutes: 0 }] },
      { author, entries: [{ ...entry, minutes: 241 }] },
      { author, entries: [{ ...entry, updatedAt: 123 }] },
    ])
      await expect(
        createPublicAuthorClient((async () => Response.json(result)) as typeof fetch).read(id),
      ).rejects.toBeInstanceOf(PublicAuthorClientError);
  });
  it('accepts bounded legacy public slugs but never sends unsafe IDs, queries or foreign URLs', async () => {
    const legacy = 'Public-author_2';
    expect(
      (
        await createPublicAuthorClient((async () =>
          Response.json({ ...value, author: { ...author, id: legacy } })) as typeof fetch).read(
          legacy,
        )
      ).author.id,
    ).toBe(legacy);
    const fetcher = vi.fn();
    for (const bad of [
      '',
      '../author',
      'a?from=private',
      'https://foreign.invalid',
      'a'.repeat(129),
    ])
      await expect(
        createPublicAuthorClient(fetcher as typeof fetch).read(bad),
      ).rejects.toBeInstanceOf(PublicAuthorClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds received bytes and malformed bodies without returning raw errors or a false empty profile', async () => {
    for (const make of [
      () => new Response('PRIVATE_REASON', { status: 404 }),
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
      () => new Response('x'.repeat(262145), { headers: { 'Content-Type': 'application/json' } }),
      () =>
        new Response('{}', {
          headers: { 'Content-Type': 'application/json', 'Content-Length': '262145' },
        }),
      () =>
        new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
    ])
      await expect(
        createPublicAuthorClient((async () => make()) as typeof fetch).read(id),
      ).rejects.toThrow('投稿者の公開情報を確認できませんでした。');
  });
  it('rejects an aborted old response and times out unverified reads without retries', async () => {
    vi.useFakeTimers();
    let release: (response: Response) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = createPublicAuthorClient(fetcher as typeof fetch).read(id, controller.signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(PublicAuthorClientError);
    controller.abort();
    await rejected;
    release(Response.json(value));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const stalled = vi.fn(() => new Promise<Response>(() => {}));
    const late = createPublicAuthorClient(stalled as typeof fetch).read(id);
    const timedOut = expect(late).rejects.toBeInstanceOf(PublicAuthorClientError);
    await vi.advanceTimersByTimeAsync(10000);
    await timedOut;
    expect(stalled).toHaveBeenCalledTimes(1);
  });
});
