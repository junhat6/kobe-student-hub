import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  createAuthorSessionGuard,
  createSessionClient,
  SessionClientError,
} from '../src/editor/session-client';
const A = 'a'.repeat(43),
  B = 'b'.repeat(43),
  origin = 'https://app.example.invalid';
afterEach(() => vi.useRealTimers());
function guardRequest(input: string | Request, init?: RequestInit) {
  const paths: string[] = [];
  const guard = createAuthorSessionGuard({
    csrfToken: A,
    origin,
    onMismatch: vi.fn(),
    onUnverified: vi.fn(),
    fetcher: (async (path: string | Request) => {
      const p = typeof path === 'string' ? path : new URL(path.url).pathname;
      paths.push(p);
      return p === '/api/private/session' ? Response.json({ csrfToken: A }) : Response.json({});
    }) as unknown as typeof fetch,
  });
  const done = guard.fetcher(input, init).then((response) => response.text());
  return { paths, done };
}
describe('existing session browser client and author response-consumption guard', () => {
  it('only checks an existing cookie and posts empty-body CSRF logout without identity fields', async () => {
    const calls: { path: unknown; init: RequestInit | undefined }[] = [];
    const client = createSessionClient((async (path, init) => {
      calls.push({ path, init });
      return Response.json(
        path === '/api/private/session' ? { csrfToken: A } : { loggedOut: true },
      );
    }) as typeof fetch);
    expect(await client.peek()).toBe(A);
    await client.logout(A);
    expect(calls.map((c) => c.path)).toEqual(['/api/private/session', '/api/private/logout']);
    expect(calls[1].init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(calls[1].init?.body).toBeUndefined();
    expect(new Headers(calls[1].init?.headers).get('Authorization')).toBe('Bearer csrf.' + A);
    expect(new Headers(calls[1].init?.headers).has('Content-Type')).toBe(false);
  });
  it('rejects identity leakage, malformed success and oversized raw proof responses', async () => {
    for (const value of [
      { csrfToken: A, accountId: 'private' },
      { csrfToken: 'x' },
      { loggedOut: true },
    ])
      await expect(
        createSessionClient((async () => Response.json(value)) as typeof fetch).peek(),
      ).rejects.toBeInstanceOf(SessionClientError);
    for (const value of [{ loggedOut: false }, { loggedOut: true, account: 'private' }])
      await expect(
        createSessionClient((async () => Response.json(value)) as typeof fetch).logout(A),
      ).rejects.toBeInstanceOf(SessionClientError);
    await expect(
      createSessionClient(
        (async () =>
          new Response('x'.repeat(4097), {
            headers: { 'Content-Type': 'application/json' },
          })) as typeof fetch,
      ).peek(),
    ).rejects.toBeInstanceOf(SessionClientError);
    try {
      await createSessionClient(
        (async () => new Response('PRIVATE', { status: 401 })) as typeof fetch,
      ).peek();
    } catch (error) {
      expect((error as SessionClientError).kind).toBe('signed-out');
      expect((error as Error).message).not.toContain('PRIVATE');
    }
  });
  it('keeps the raw proof boundary on the shared transport (#189 step 11)', async () => {
    const calls: RequestInit[] = [];
    await createSessionClient((async (_path: unknown, init?: RequestInit) => {
      calls.push(init ?? {});
      return Response.json({ csrfToken: A });
    }) as typeof fetch).peek();
    expect(calls[0]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(calls[0].body).toBeUndefined();
    expect(new Headers(calls[0].headers).has('Authorization')).toBe(false);
    expect(new Headers(calls[0].headers).get('Accept')).toBe('application/json');
    const kind = async (response: () => Response) => {
      try {
        await createSessionClient((async () => response()) as typeof fetch).peek();
      } catch (error) {
        expect(error).toBeInstanceOf(SessionClientError);
        expect((error as Error).message).not.toContain('PRIVATE');
        return (error as SessionClientError).kind;
      }
      return 'accepted';
    };
    expect(await kind(() => Response.json({ e: 'PRIVATE' }, { status: 401 }))).toBe('signed-out');
    for (const status of [403, 404, 409, 422, 500])
      expect(await kind(() => Response.json({ e: 'PRIVATE' }, { status }))).toBe('unavailable');
    expect(
      await kind(
        () =>
          new Response(JSON.stringify({ csrfToken: A }), {
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    ).toBe('unavailable');
    expect(
      await kind(
        () =>
          new Response(JSON.stringify({ csrfToken: A }), {
            headers: { 'Content-Type': 'application/json', 'Content-Length': '4097' },
          }),
      ),
    ).toBe('unavailable');
    expect(
      await kind(
        () =>
          new Response(new Uint8Array([0x7b, 0xff, 0x7d]), {
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    ).toBe('unavailable');
    expect(await kind(() => Response.json({ csrfToken: A }, { status: 201 }))).toBe('unavailable');
    await expect(createSessionClient(fetch).logout('not-a-token')).rejects.toBeInstanceOf(
      SessionClientError,
    );
  });
  it('does not treat a 401 that arrives after the deadline as a confirmed sign-out', async () => {
    vi.useFakeTimers();
    let release: (value: Response) => void = () => {};
    const pending = createSessionClient(
      (() =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })) as unknown as typeof fetch,
    ).peek();
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10000);
    release(new Response(null, { status: 401 }));
    const error = await settled;
    expect(error).toBeInstanceOf(SessionClientError);
    expect((error as SessionClientError).kind).toBe('unavailable');
  });
  it('does not retry an uncertain logout or accept a late acknowledgement', async () => {
    vi.useFakeTimers();
    let release: (value: Response) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const pending = createSessionClient(fetcher as typeof fetch).logout(A);
    const rejected = expect(pending).rejects.toBeInstanceOf(SessionClientError);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json({ loggedOut: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('verifies a read after headers and after EOF without adding tokens to URLs or payloads', async () => {
    const calls: { path: unknown; init: RequestInit | undefined }[] = [];
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: vi.fn(),
      onUnverified: vi.fn(),
      fetcher: (async (path, init) => {
        calls.push({ path, init });
        return Response.json(
          path === '/api/private/session' ? { csrfToken: A } : { value: 'private response' },
        );
      }) as typeof fetch,
    });
    const response = await guard.fetcher('/api/private/drafts');
    expect(calls).toHaveLength(2);
    expect(await response.json()).toEqual({ value: 'private response' });
    // A read needs no proof before it is sent (#272): the post-header proof catches any change.
    expect(calls.map((c) => c.path)).toEqual([
      '/api/private/drafts',
      '/api/private/session',
      '/api/private/session',
    ]);
    for (const call of calls) {
      expect(String(call.path)).not.toContain(A);
      expect(call.init?.body).toBeUndefined();
      expect(call.init?.cache).toBe('no-store');
    }
    guard.invalidate();
  });
  it('rejects a changed session at the post-header proof before exposing the response', async () => {
    let current = A;
    const mismatch = vi.fn(),
      unknown = vi.fn();
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: mismatch,
      onUnverified: unknown,
      fetcher: (async (path) => {
        if (path === '/api/private/session') return Response.json({ csrfToken: current });
        current = B;
        return Response.json({ secret: 'A data' });
      }) as typeof fetch,
    });
    await expect(guard.fetcher('/api/private/drafts')).rejects.toBeInstanceOf(SessionClientError);
    expect(mismatch).toHaveBeenCalledExactlyOnceWith('changed');
    expect(unknown).not.toHaveBeenCalled();
  });
  it('withholds EOF when an old response body finishes after a cookie/session change', async () => {
    let current = A;
    let finish: () => void = () => {};
    const mismatch = vi.fn();
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: mismatch,
      onUnverified: vi.fn(),
      fetcher: (async (path) =>
        path === '/api/private/session'
          ? Response.json({ csrfToken: current })
          : new Response(
              new ReadableStream<Uint8Array>({
                start(output) {
                  output.enqueue(new TextEncoder().encode('{"secret":"A body"}'));
                  finish = () => output.close();
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )) as typeof fetch,
    });
    const response = await guard.fetcher('/api/private/drafts');
    const body = response.text();
    const rejected = expect(body).rejects.toBeInstanceOf(SessionClientError);
    current = B;
    finish();
    await rejected;
    expect(mismatch).toHaveBeenCalledExactlyOnceWith('changed');
  });
  it('invalidation aborts a pending old body without invoking mismatch or restoring a revoked generation', async () => {
    const mismatch = vi.fn(),
      unknown = vi.fn();
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: mismatch,
      onUnverified: unknown,
      fetcher: (async (path) =>
        path === '/api/private/session'
          ? Response.json({ csrfToken: A })
          : new Response(
              new ReadableStream<Uint8Array>({
                start(output) {
                  output.enqueue(new TextEncoder().encode('private'));
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )) as typeof fetch,
    });
    const response = await guard.fetcher('/api/private/drafts');
    const pending = response.text();
    const rejected = expect(pending).rejects.toBeInstanceOf(SessionClientError);
    guard.invalidate();
    await rejected;
    await expect(guard.fetcher('/api/private/drafts')).rejects.toBeInstanceOf(SessionClientError);
    expect(mismatch).not.toHaveBeenCalled();
    expect(unknown).not.toHaveBeenCalled();
  });
  it('distinguishes confirmed sign-out from an unverified network failure and sends no private write', async () => {
    for (const signedOut of [true, false]) {
      const mismatch = vi.fn(),
        unknown = vi.fn();
      const fetcher = vi.fn(async (path: string) => {
        if (path !== '/api/private/session') throw new Error('write must not be sent');
        if (signedOut) return new Response('', { status: 401 });
        throw new Error('PRIVATE_NETWORK');
      });
      const guard = createAuthorSessionGuard({
        csrfToken: A,
        origin,
        onMismatch: mismatch,
        onUnverified: unknown,
        fetcher: fetcher as unknown as typeof fetch,
        retryDelays: [0, 0],
      });
      await expect(
        guard.fetcher('/api/private/drafts', { method: 'POST', body: '{}' }),
      ).rejects.toBeInstanceOf(SessionClientError);
      // A 401 is final at once; a network failure re-asks only the read-only proof.
      expect(fetcher).toHaveBeenCalledTimes(signedOut ? 1 : 3);
      expect(fetcher.mock.calls.every(([path]) => path === '/api/private/session')).toBe(true);
      if (signedOut) {
        expect(mismatch).toHaveBeenCalledExactlyOnceWith('signed-out');
        expect(unknown).not.toHaveBeenCalled();
      } else {
        expect(unknown).toHaveBeenCalledTimes(1);
        expect(mismatch).not.toHaveBeenCalled();
      }
    }
  });
  it('sends a read at once but hands out nothing when the session changed or ended before it (#272)', async () => {
    for (const kind of ['changed', 'signed-out'] as const) {
      const mismatch = vi.fn(),
        unknown = vi.fn();
      const paths: string[] = [];
      const guard = createAuthorSessionGuard({
        csrfToken: A,
        origin,
        onMismatch: mismatch,
        onUnverified: unknown,
        fetcher: (async (path: string) => {
          paths.push(path);
          if (kind === 'signed-out') return new Response('', { status: 401 });
          return path === '/api/private/session'
            ? Response.json({ csrfToken: B })
            : Response.json({ secret: 'B data' });
        }) as unknown as typeof fetch,
      });
      await expect(guard.fetcher('/api/private/drafts')).rejects.toBeInstanceOf(SessionClientError);
      expect(paths).toEqual(['/api/private/drafts', '/api/private/session']);
      expect(mismatch).toHaveBeenCalledExactlyOnceWith(kind);
      expect(unknown).not.toHaveBeenCalled();
    }
  });
  it('proves every non-read method before sending it, whether given by init or by a Request', async () => {
    for (const make of [
      (m: string) => guardRequest('/api/private/drafts', { method: m }),
      (m: string) => guardRequest(new Request(origin + '/api/private/drafts', { method: m })),
    ])
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
        const { paths, done } = make(method);
        await done;
        expect(paths[0]).toBe('/api/private/session');
      }
    for (const method of ['GET', 'HEAD', 'get']) {
      const { paths, done } = guardRequest('/api/private/drafts', { method });
      await done;
      expect(paths[0]).toBe('/api/private/drafts');
    }
  });
  it('propagates an SDK abort to raw proof lookups and refuses foreign URLs', async () => {
    let proofSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const unverified = vi.fn();
    const raw = vi.fn(async (_path, init) => {
      proofSignal = init?.signal as AbortSignal;
      return await new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: vi.fn(),
      onUnverified: unverified,
      fetcher: raw,
    });
    const pending = guard.fetcher('/api/private/drafts', {
      method: 'POST',
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(SessionClientError);
    await vi.waitFor(() => expect(proofSignal).toBeDefined());
    controller.abort();
    await rejected;
    expect(proofSignal?.aborted).toBe(true);
    expect(unverified).not.toHaveBeenCalled();
    const foreign = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: vi.fn(),
      onUnverified: vi.fn(),
      fetcher: vi.fn() as typeof fetch,
    });
    await expect(
      foreign.fetcher('https://foreign.invalid/api/private/drafts'),
    ).rejects.toBeInstanceOf(SessionClientError);
  });
  it('keeps the editor open when one proof request drops and the retry confirms the same session (#246)', async () => {
    const unknown = vi.fn(),
      mismatch = vi.fn();
    let proofs = 0;
    const fetcher = vi.fn(async (path: string) => {
      if (path === '/api/private/session') {
        if (++proofs === 2) throw new TypeError('Failed to fetch');
        return Response.json({ csrfToken: A });
      }
      return Response.json([]);
    });
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: mismatch,
      onUnverified: unknown,
      fetcher: fetcher as unknown as typeof fetch,
      retryDelays: [0, 0],
    });
    const response = await guard.fetcher('/api/private/drafts');
    expect(await response.json()).toEqual([]);
    expect(unknown).not.toHaveBeenCalled();
    expect(mismatch).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/private/drafts')).toHaveLength(1);
  });
  it('treats a caller abort during the body as the caller giving up, not as an unverified session', async () => {
    const unknown = vi.fn();
    const controller = new AbortController();
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/private/session') return Response.json({ csrfToken: A });
      const body = new ReadableStream<Uint8Array>({
        start(output) {
          output.enqueue(new TextEncoder().encode('['));
          init?.signal?.addEventListener('abort', () =>
            output.error(new DOMException('', 'AbortError')),
          );
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: vi.fn(),
      onUnverified: unknown,
      fetcher: fetcher as unknown as typeof fetch,
      retryDelays: [0, 0],
    });
    const response = await guard.fetcher('/api/private/drafts', { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    const next = reader.read();
    controller.abort();
    await expect(next).rejects.toBeInstanceOf(SessionClientError);
    expect(unknown).not.toHaveBeenCalled();
    // The same guard still serves the next request.
    const again = await guard.fetcher('/api/private/drafts');
    expect(again.status).toBe(200);
    void again.body?.cancel();
  });
  it('peekSteadily stops at a confirmed sign-out and gives up after the listed retries', async () => {
    const signedOut = vi.fn(async () => new Response('', { status: 401 }));
    await expect(
      createSessionClient(signedOut as unknown as typeof fetch).peekSteadily(undefined, [0, 0]),
    ).rejects.toMatchObject({ kind: 'signed-out' });
    expect(signedOut).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => new Response('', { status: 503 }));
    await expect(
      createSessionClient(down as unknown as typeof fetch).peekSteadily(undefined, [0, 0]),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(down).toHaveBeenCalledTimes(3);
  });
  it('shares one proof between private reads opened together, sent after all of them asked (#272)', async () => {
    const order: string[] = [];
    const fetcher = vi.fn(async (path: string) => {
      order.push(path);
      return path === '/api/private/session'
        ? Response.json({ csrfToken: A })
        : Response.json({ path });
    });
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: vi.fn(),
      onUnverified: vi.fn(),
      fetcher: fetcher as unknown as typeof fetch,
    });
    const paths = ['/api/private/drafts', '/api/private/profile', '/api/private/activity'];
    const responses = await Promise.all(paths.map((path) => guard.fetcher(path)));
    expect(await Promise.all(responses.map((r) => r.json()))).toEqual(
      paths.map((path) => ({ path })),
    );
    // The reads go out at once; their post-header proofs share one request sent after all asked.
    expect(order.slice(0, 4)).toEqual([...paths, '/api/private/session']);
    const proofs = order.filter((path) => path === '/api/private/session').length;
    expect(proofs).toBeLessThan(2 * paths.length);
    expect(proofs).toBeGreaterThanOrEqual(2);
    guard.invalidate();
  });
  it('never answers a proof asked after the shared request was sent with that earlier request', async () => {
    let current = A;
    const answers: (() => void)[] = [];
    const fetcher = vi.fn(async (path: string) => {
      if (path !== '/api/private/session') return Response.json({ secret: 'A data' });
      const token = current;
      await new Promise<void>((resolve) => answers.push(resolve));
      return Response.json({ csrfToken: token });
    });
    const mismatch = vi.fn();
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: mismatch,
      onUnverified: vi.fn(),
      fetcher: fetcher as unknown as typeof fetch,
    });
    const first = guard.fetcher('/api/private/drafts');
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    // The session changes, then a second read asks: it must get its own, later proof.
    current = B;
    const second = guard.fetcher('/api/private/profile');
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[0]();
    answers[1]();
    await expect(second).rejects.toBeInstanceOf(SessionClientError);
    await expect(first).rejects.toBeInstanceOf(SessionClientError);
    expect(mismatch).toHaveBeenCalledExactlyOnceWith('changed');
  });
  it('lets one caller leave a shared proof without failing the others, and cancels it when all leave', async () => {
    const signals: AbortSignal[] = [];
    let release: (() => void) | undefined;
    const unverified = vi.fn();
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      if (path !== '/api/private/session') return Response.json({ ok: true });
      signals.push(init!.signal!);
      if (signals.length === 1 || signals.length > 2)
        await new Promise<void>((resolve) => (release = resolve));
      return Response.json({ csrfToken: A });
    });
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: vi.fn(),
      onUnverified: unverified,
      fetcher: fetcher as unknown as typeof fetch,
    });
    const leaving = new AbortController();
    const gone = guard.fetcher('/api/private/drafts', { signal: leaving.signal });
    const staying = guard.fetcher('/api/private/profile');
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    leaving.abort();
    await expect(gone).rejects.toBeInstanceOf(SessionClientError);
    // The other joiner still needs the answer, so the shared request goes on.
    expect(signals[0].aborted).toBe(false);
    release!();
    expect(await (await staying).json()).toEqual({ ok: true });
    expect(unverified).not.toHaveBeenCalled();

    const all = new AbortController();
    const pending = [
      guard.fetcher('/api/private/drafts', { signal: all.signal }),
      guard.fetcher('/api/private/profile', { signal: all.signal }),
    ];
    await vi.waitFor(() => expect(signals).toHaveLength(3));
    all.abort();
    for (const request of pending) await expect(request).rejects.toBeInstanceOf(SessionClientError);
    expect(signals[2].aborted).toBe(true);
    expect(unverified).not.toHaveBeenCalled();
  });
  it('sends no proof for a batch everyone left before it was sent, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      return await new Promise<Response>(() => {});
    });
    const options = {
      csrfToken: A,
      origin,
      onMismatch: vi.fn(),
      onUnverified: vi.fn(),
      fetcher: fetcher as unknown as typeof fetch,
    };
    const before = createAuthorSessionGuard(options);
    // Writes, so each asks a proof before it is sent.
    const write = { method: 'POST' };
    const early = [1, 2, 3].map((i) =>
      expect(before.fetcher('/api/private/' + i, write)).rejects.toBeInstanceOf(SessionClientError),
    );
    before.invalidate();
    await Promise.all(early);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const after = createAuthorSessionGuard(options);
    const late = [1, 2, 3].map((i) =>
      expect(after.fetcher('/api/private/' + i, write)).rejects.toBeInstanceOf(SessionClientError),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(signals).toHaveLength(1);
    after.invalidate();
    await Promise.all(late);
    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(20000);
    expect(vi.getTimerCount()).toBe(0);
    expect(options.onMismatch).not.toHaveBeenCalled();
    expect(options.onUnverified).not.toHaveBeenCalled();
  });
  it('removes every abort listener once shared proofs are answered', async () => {
    const listening = new Map<AbortSignal, Set<unknown>>();
    const add = AbortSignal.prototype.addEventListener;
    const remove = AbortSignal.prototype.removeEventListener;
    AbortSignal.prototype.addEventListener = function (this: AbortSignal, ...args: unknown[]) {
      if (args[0] === 'abort') listening.set(this, (listening.get(this) ?? new Set()).add(args[1]));
      return (add as (...a: unknown[]) => void).apply(this, args);
    } as typeof add;
    AbortSignal.prototype.removeEventListener = function (this: AbortSignal, ...args: unknown[]) {
      if (args[0] === 'abort') listening.get(this)?.delete(args[1]);
      return (remove as (...a: unknown[]) => void).apply(this, args);
    } as typeof remove;
    try {
      const guard = createAuthorSessionGuard({
        csrfToken: A,
        origin,
        onMismatch: vi.fn(),
        onUnverified: vi.fn(),
        fetcher: (async (path: string) =>
          path === '/api/private/session'
            ? Response.json({ csrfToken: A })
            : Response.json({ ok: 1 })) as unknown as typeof fetch,
      });
      const responses = await Promise.all(
        [1, 2, 3, 4].map((i) => guard.fetcher('/api/private/' + i)),
      );
      for (const response of responses) await response.json();
      expect([...listening.values()].reduce((n, set) => n + set.size, 0)).toBe(0);
    } finally {
      AbortSignal.prototype.addEventListener = add;
      AbortSignal.prototype.removeEventListener = remove;
    }
  });
  it('ends the body read when the caller gives up while its EOF proof waits in a batch', async () => {
    let proofs = 0;
    let hold: (() => void) | undefined;
    const unknown = vi.fn();
    const fetcher = vi.fn(async (path: string) => {
      if (path !== '/api/private/session') return Response.json({ ok: true });
      // The EOF proof (second) never answers until released.
      if (++proofs === 2) await new Promise<void>((resolve) => (hold = resolve));
      return Response.json({ csrfToken: A });
    });
    const guard = createAuthorSessionGuard({
      csrfToken: A,
      origin,
      onMismatch: vi.fn(),
      onUnverified: unknown,
      fetcher: fetcher as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const response = await guard.fetcher('/api/private/drafts', { signal: controller.signal });
    const body = response.text();
    await vi.waitFor(() => expect(hold).toBeDefined());
    controller.abort();
    await expect(body).rejects.toBeInstanceOf(SessionClientError);
    expect(unknown).not.toHaveBeenCalled();
    hold!();
  });
});
