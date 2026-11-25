import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BoundedReadError,
  boundedReadFailure,
  readBoundedBytes,
  readBoundedJson,
  readBoundedJsonResponse,
  type BoundedJsonRequest,
} from '../src/shared/http-client';

const csrf = 'b'.repeat(43);
const json = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
function streamed(chunks: Uint8Array[], init: ResponseInit = {}) {
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) c.enqueue(chunks[i++]);
        else c.close();
      },
    }),
    { ...init, headers: { 'Content-Type': 'application/json' } },
  );
}
async function failure(path: string, request: BoundedJsonRequest) {
  try {
    await readBoundedJson(path, request);
  } catch (error) {
    expect(error).toBeInstanceOf(BoundedReadError);
    expect(String((error as Error).message)).not.toContain('PRIVATE');
    return boundedReadFailure(error);
  }
  throw new Error('expected a failure');
}
afterEach(() => vi.useRealTimers());

describe('readBoundedJson — the one bounded transport', () => {
  it('sends no-store, no redirect, the chosen credentials and no proof on a read', async () => {
    const fetcher = vi.fn(async () => json('{"ok":true}'));
    expect(
      await readBoundedJson('/api/x', {
        fetcher: fetcher as typeof fetch,
        credentials: 'omit',
        maxBytes: 64,
      }),
    ).toEqual({ ok: true });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' });
    expect(Object.hasOwn(init, 'method')).toBe(false);
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
  });

  it('attaches the CSRF proof and JSON body only for a write, and refuses a write without one', async () => {
    const fetcher = vi.fn(async () => json('{}', { status: 201 }));
    await readBoundedJson('/api/private/x', {
      fetcher: fetcher as typeof fetch,
      credentials: 'same-origin',
      method: 'POST',
      status: 201,
      body: { a: 1 },
      csrf,
      maxBytes: 64,
    });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ a: 1 });

    const never = vi.fn(async () => json('{}'));
    for (const bad of [undefined, '', 'short', 'c'.repeat(42) + '!']) {
      expect(
        await failure('/api/private/x', {
          fetcher: never as typeof fetch,
          credentials: 'same-origin',
          method: 'PUT',
          body: { a: 1 },
          csrf: bad,
          maxBytes: 64,
        }),
      ).toBe('unavailable');
    }
    expect(never).not.toHaveBeenCalled();
  });

  it('sends a Blob body unchanged under its own type, only with the CSRF proof', async () => {
    const fetcher = vi.fn(async () => json('{}', { status: 201 }));
    const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    await readBoundedJson('/api/private/x', {
      fetcher: fetcher as typeof fetch,
      credentials: 'same-origin',
      method: 'PUT',
      status: 201,
      body: image,
      csrf,
      maxBytes: 64,
    });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe(image);
    expect(new Headers(init.headers).get('Content-Type')).toBe('image/jpeg');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer csrf.' + csrf);

    const never = vi.fn(async () => json('{}'));
    for (const [body, proof] of [
      [image, undefined],
      [new Blob(['x']), csrf],
      [new Blob(['x'], { type: 'text/html; charset=utf-8' }), csrf],
    ] as const) {
      expect(
        await failure('/api/private/x', {
          fetcher: never as typeof fetch,
          credentials: 'same-origin',
          method: 'PUT',
          body,
          csrf: proof,
          maxBytes: 64,
        }),
      ).toBe('unavailable');
    }
    expect(never).not.toHaveBeenCalled();
  });

  it('sends the Blob type it checked, even when a subclass answers differently later', async () => {
    let reads = 0;
    class Shifting extends Blob {
      override get type() {
        return ++reads === 1 ? 'image/jpeg' : 'text/html; x';
      }
    }
    const fetcher = vi.fn(async () => json('{}', { status: 201 }));
    await readBoundedJson('/api/private/x', {
      fetcher: fetcher as typeof fetch,
      credentials: 'same-origin',
      method: 'PUT',
      status: 201,
      body: new Shifting(['x']),
      csrf,
      maxBytes: 64,
    });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get('Content-Type')).toBe('image/jpeg');
    expect(reads).toBe(1);
  });

  it('rejects out-of-range limits before any request', async () => {
    const never = vi.fn(async () => json('{}'));
    for (const maxBytes of [0, -1, 1.5, 2097153, Number.NaN]) {
      expect(
        await failure('/api/x', { fetcher: never as typeof fetch, credentials: 'omit', maxBytes }),
      ).toBe('unavailable');
    }
    expect(
      await failure('/api/x', {
        fetcher: never as typeof fetch,
        credentials: 'omit',
        maxBytes: 64,
        maxChunks: 0,
      }),
    ).toBe('unavailable');
    expect(never).not.toHaveBeenCalled();
  });

  it('accepts only the exact status and JSON type, and names 404, 401, 409 and 422 without the body', async () => {
    const run = (r: Response, status?: number) =>
      failure('/api/x', {
        fetcher: (async () => r) as typeof fetch,
        credentials: 'same-origin',
        maxBytes: 64,
        status,
      });
    expect(await run(json('"PRIVATE"', { status: 404 }))).toBe('missing');
    expect(await run(json('"PRIVATE"', { status: 401 }))).toBe('signed-out');
    expect(await run(json('"PRIVATE"', { status: 409 }))).toBe('conflict');
    expect(await run(json('"PRIVATE"', { status: 422 }))).toBe('rejected');
    expect(await run(json('"PRIVATE"', { status: 503 }))).toBe('unavailable');
    expect(await run(json('{}', { status: 200 }), 201)).toBe('unavailable');
    expect(await run(json('{}', { status: 201 }))).toBe('unavailable');
    expect(await run(new Response('{}', { headers: { 'Content-Type': 'text/html' } }))).toBe(
      'unavailable',
    );
    expect(
      await run(new Response('{}', { headers: { 'Content-Type': 'application/jsonx' } })),
    ).toBe('unavailable');
    expect(await run(json('not json'))).toBe('unavailable');
  });

  it('enforces the byte cap by Content-Length and by the streamed size, and the chunk cap', async () => {
    const run = (r: Response, maxBytes = 8, maxChunks?: number) =>
      failure('/api/x', {
        fetcher: (async () => r) as typeof fetch,
        credentials: 'omit',
        maxBytes,
        maxChunks,
      });
    expect(await run(json('"1234567"', { headers: { 'Content-Length': '9' } }))).toBe(
      'unavailable',
    );
    expect(await run(json('{}', { headers: { 'Content-Length': '1e3' } }))).toBe('unavailable');
    expect(await run(streamed([new TextEncoder().encode('"1234567"')]))).toBe('unavailable');
    const one = new TextEncoder().encode(' ');
    expect(await run(streamed([one, one, one, new TextEncoder().encode('1')]), 8, 3)).toBe(
      'unavailable',
    );
    expect(await run(streamed([new Uint8Array([0x22, 0xff, 0x22])]))).toBe('unavailable');
    expect(
      await readBoundedJson('/api/x', {
        fetcher: (async () => streamed([one, one, new TextEncoder().encode('1')])) as typeof fetch,
        credentials: 'omit',
        maxBytes: 8,
        maxChunks: 3,
      }),
    ).toBe(1);
  });

  it('caps stream chunks at 65536 by default for callers that do not set maxChunks', async () => {
    const space = new TextEncoder().encode(' '),
      one = new TextEncoder().encode('1');
    const read = (spaces: number) =>
      readBoundedJson('/api/x', {
        fetcher: (async () =>
          streamed([...Array.from({ length: spaces }, () => space), one])) as typeof fetch,
        credentials: 'omit',
        maxBytes: 2097152,
      });
    expect(await read(65535)).toBe(1);
    await expect(read(65536)).rejects.toBeInstanceOf(BoundedReadError);
  });

  it('requires the streamed size to equal Content-Length only when exactLength is asked', async () => {
    const short = () => json('{"a":1}', { headers: { 'Content-Length': '64' } });
    const read = (exactLength?: boolean) =>
      readBoundedJson('/api/x', {
        fetcher: (async () => short()) as typeof fetch,
        credentials: 'omit',
        maxBytes: 64,
        exactLength,
      });
    expect(await read()).toEqual({ a: 1 });
    expect(
      await failure('/api/x', {
        fetcher: (async () => short()) as typeof fetch,
        credentials: 'omit',
        maxBytes: 64,
        exactLength: true,
      }),
    ).toBe('unavailable');
    expect(
      await readBoundedJson('/api/x', {
        fetcher: (async () =>
          json('{"a":1}', { headers: { 'Content-Length': '7' } })) as typeof fetch,
        credentials: 'omit',
        maxBytes: 64,
        exactLength: true,
      }),
    ).toEqual({ a: 1 });
    expect(
      await readBoundedJson('/api/x', {
        fetcher: (async () => streamed([new TextEncoder().encode('{"a":1}')])) as typeof fetch,
        credentials: 'omit',
        maxBytes: 64,
        exactLength: true,
      }),
    ).toEqual({ a: 1 });
  });

  it('stops at the deadline and on caller abort, as unavailable rather than missing', async () => {
    vi.useFakeTimers();
    const hang = (() => new Promise<Response>(() => {})) as typeof fetch;
    const late = failure('/api/x', { fetcher: hang, credentials: 'omit', maxBytes: 8 });
    await vi.advanceTimersByTimeAsync(10001);
    expect(await late).toBe('unavailable');
    vi.useRealTimers();
    const controller = new AbortController();
    const pending = failure('/api/x', {
      fetcher: hang,
      credentials: 'omit',
      maxBytes: 8,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toBe('unavailable');
    const pre = new AbortController();
    pre.abort();
    const never = vi.fn(hang);
    expect(
      await failure('/api/x', {
        fetcher: never as typeof fetch,
        credentials: 'omit',
        maxBytes: 8,
        signal: pre.signal,
      }),
    ).toBe('unavailable');
    expect(never).not.toHaveBeenCalled();
  });

  it('tells the caller the server answered only after a response arrived', async () => {
    const onResponse = vi.fn();
    await failure('/api/x', {
      fetcher: (async () => {
        throw new TypeError('offline');
      }) as typeof fetch,
      credentials: 'omit',
      maxBytes: 8,
      onResponse,
    });
    expect(onResponse).not.toHaveBeenCalled();
    await failure('/api/x', {
      fetcher: (async () => json('{}', { status: 500 })) as typeof fetch,
      credentials: 'omit',
      maxBytes: 8,
      onResponse,
    });
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it('reads the body of each listed status and still withholds the body of any other', async () => {
    const answer = (r: Response) =>
      readBoundedJsonResponse('/api/x', {
        fetcher: (async () => r) as typeof fetch,
        credentials: 'same-origin',
        maxBytes: 64,
        statuses: [201, 409],
      });
    expect(await answer(json('{"a":1}', { status: 201 }))).toEqual({
      status: 201,
      value: { a: 1 },
    });
    expect(await answer(json('{"b":2}', { status: 409 }))).toEqual({
      status: 409,
      value: { b: 2 },
    });
    for (const status of [200, 404, 422]) {
      const error = await answer(json('"PRIVATE"', { status })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BoundedReadError);
    }
    await expect(
      answer(new Response('{}', { status: 409, headers: { 'Content-Type': 'text/plain' } })),
    ).rejects.toBeInstanceOf(BoundedReadError);
    const never = vi.fn();
    for (const statuses of [[], [199], [600], [200.5]])
      await expect(
        readBoundedJsonResponse('/api/x', {
          fetcher: never as typeof fetch,
          credentials: 'omit',
          maxBytes: 64,
          statuses,
        }),
      ).rejects.toBeInstanceOf(BoundedReadError);
    expect(never).not.toHaveBeenCalled();
  });

  it('sends If-Match only as a quoted positive version on a write with a CSRF proof', async () => {
    const fetcher = vi.fn(async () => json('{}', { status: 201 }));
    await readBoundedJson('/api/private/x', {
      fetcher: fetcher as typeof fetch,
      credentials: 'same-origin',
      method: 'PUT',
      csrf,
      ifMatch: 7,
      status: 201,
      maxBytes: 64,
    });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get('If-Match')).toBe('"7"');
    fetcher.mockClear();
    for (const [ifMatch, proof] of [
      [7, undefined],
      [0, csrf],
      [-1, csrf],
      [1.5, csrf],
      [2 ** 53, csrf],
    ] as const)
      expect(
        await failure('/api/private/x', {
          fetcher: fetcher as typeof fetch,
          credentials: 'same-origin',
          method: 'PUT',
          ifMatch,
          maxBytes: 64,
          ...(proof === undefined ? {} : { csrf: proof }),
        }),
      ).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns non-JSON bytes only for status 200 and an exactly listed type, under the same caps', async () => {
    const image = (type: string, init: ResponseInit = {}, bytes = new Uint8Array([1, 2, 3])) =>
      new Response(bytes, { ...init, headers: { 'Content-Type': type, ...(init.headers ?? {}) } });
    const fetcher = vi.fn(async () => image('image/png'));
    const read = (f: typeof fetch, maxBytes = 8) =>
      readBoundedBytes('/api/private/media/x', {
        fetcher: f,
        credentials: 'same-origin',
        types: ['image/png', 'image/jpeg'],
        maxBytes,
        exactLength: true,
      });
    const got = await read(fetcher as typeof fetch);
    expect(got.type).toBe('image/png');
    expect([...got.bytes]).toEqual([1, 2, 3]);
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get('Accept')).toBe('image/png, image/jpeg');
    expect(init).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    for (const r of [
      image('image/gif'),
      image('image/png; charset=utf-8'),
      image('IMAGE/PNG'),
      image('image/png', { status: 201 }),
      image('image/png', { status: 404 }),
      image('image/png', { headers: { 'Content-Length': '9' } }),
      image('image/png', { headers: { 'Content-Length': '4' } }),
      image('image/png', {}, new Uint8Array(9)),
    ])
      await expect(read((async () => r) as typeof fetch)).rejects.toBeInstanceOf(BoundedReadError);
    const never = vi.fn();
    await expect(
      readBoundedBytes('/api/x', {
        fetcher: never as typeof fetch,
        credentials: 'omit',
        types: [],
        maxBytes: 8,
      }),
    ).rejects.toBeInstanceOf(BoundedReadError);
    expect(never).not.toHaveBeenCalled();
  });
});
