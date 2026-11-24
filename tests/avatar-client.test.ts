import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvatarClientError, createAvatarClient } from '../src/editor/avatar-client';

const csrf = 'a'.repeat(43);
const version = '0123456789abcdef';
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const initOf = (f: ReturnType<typeof vi.fn>, i = 0) =>
  (f.mock.calls[i] as unknown as [string, RequestInit])[1];
const jpeg = (size = 3) => new Blob([new Uint8Array(size).fill(0xff)], { type: 'image/jpeg' });
async function failure(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AvatarClientError);
    expect((error as Error).message).not.toContain('PRIVATE');
    return (error as Error).message;
  }
  throw new Error('expected a failure');
}
afterEach(() => vi.useRealTimers());

describe('avatar client — on the bounded transport', () => {
  it('reads with the cookie only and writes once with the CSRF proof, never redirecting or caching', async () => {
    const f = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? json({ avatar: version }, 201)
        : init?.method === 'DELETE'
          ? json({ avatar: null })
          : json({ avatar: version }),
    );
    const client = createAvatarClient(csrf, f as typeof fetch);
    const image = jpeg();
    expect(await client.read()).toBe(version);
    expect(await client.upload(image)).toBe(version);
    await client.remove();
    expect(f.mock.calls.map((c) => c[0])).toEqual(Array(3).fill('/api/private/profile-avatar'));
    expect(f.mock.calls.map((_, i) => initOf(f, i).method)).toEqual(['GET', 'PUT', 'DELETE']);
    for (const i of [0, 1, 2])
      expect(initOf(f, i)).toMatchObject({
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
    expect(new Headers(initOf(f, 0).headers).has('Authorization')).toBe(false);
    expect(initOf(f, 0).body).toBeUndefined();
    expect(new Headers(initOf(f, 1).headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
    expect(new Headers(initOf(f, 1).headers).get('Content-Type')).toBe('image/jpeg');
    expect(initOf(f, 1).body).toBe(image);
    expect(new Headers(initOf(f, 2).headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
    expect(initOf(f, 2).body).toBeUndefined();
  });

  it('refuses a bad proof or image before any request', async () => {
    const never = vi.fn(async () => json({ avatar: null }));
    for (const token of ['', 'short', 'a'.repeat(42) + '!']) {
      const client = createAvatarClient(token, never as typeof fetch);
      await failure(() => client.upload(jpeg()));
      await failure(() => client.remove());
    }
    const client = createAvatarClient(csrf, never as typeof fetch);
    await failure(() => client.upload(new Blob(['x'], { type: 'image/png' })));
    await failure(() => client.upload(new Blob([], { type: 'image/jpeg' })));
    await failure(() => client.upload(jpeg(64 * 1024 + 1)));
    expect(never).not.toHaveBeenCalled();
  });

  it('names only a refused image, sends each write once, and never echoes the body', async () => {
    const answer = (status: number) => vi.fn(async () => json('"PRIVATE"', status));
    const generic = 'アイコン画像の状態を確認できませんでした。';
    const refused = answer(422);
    expect(
      await failure(() => createAvatarClient(csrf, refused as typeof fetch).upload(jpeg())),
    ).toBe('この画像はアイコンにできませんでした。別の画像を選んでください。');
    expect(refused).toHaveBeenCalledTimes(1);
    for (const status of [200, 401, 404, 409, 413, 500]) {
      const f = answer(status);
      expect(await failure(() => createAvatarClient(csrf, f as typeof fetch).upload(jpeg()))).toBe(
        generic,
      );
      expect(f).toHaveBeenCalledTimes(1);
      const g = answer(status === 200 ? 201 : status);
      expect(await failure(() => createAvatarClient(csrf, g as typeof fetch).remove())).toBe(
        generic,
      );
      expect(g).toHaveBeenCalledTimes(1);
    }
    const offline = vi.fn(async () => {
      throw new TypeError('PRIVATE offline');
    });
    expect(await failure(() => createAvatarClient(csrf, offline as typeof fetch).read())).toBe(
      generic,
    );
  });

  it('caps the answer at 1 KiB, requires JSON and the exact shape', async () => {
    const run = (r: Response) =>
      failure(() => createAvatarClient(csrf, (async () => r) as typeof fetch).read());
    await run(json({ avatar: version }, 200, { 'Content-Length': '1025' }));
    await run(json({ avatar: version, pad: 'x'.repeat(1100) }));
    await run(
      new Response(JSON.stringify({ avatar: version }), {
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await run(json('not json'));
    await run(json({ avatar: 'PRIVATE' }));
    await run(json({ avatar: version, owner: 'x' }));
    const removed = vi.fn(async () => json({ avatar: version }));
    await failure(() => createAvatarClient(csrf, removed as typeof fetch).remove());
    const uploadedNull = vi.fn(async () => json({ avatar: null }, 201));
    await failure(() => createAvatarClient(csrf, uploadedNull as typeof fetch).upload(jpeg()));
  });

  it('gives up after 10 seconds as an ordinary failure', async () => {
    vi.useFakeTimers();
    const hang = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        ),
    );
    const pending = failure(() => createAvatarClient(csrf, hang as typeof fetch).read());
    await vi.advanceTimersByTimeAsync(10001);
    expect(await pending).toBe('アイコン画像の状態を確認できませんでした。');
  });
});
