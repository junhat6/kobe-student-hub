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
  it('verifies before headers and after EOF without adding tokens to URLs or payloads', async () => {
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
    expect(calls).toHaveLength(3);
    expect(await response.json()).toEqual({ value: 'private response' });
    expect(calls.map((c) => c.path)).toEqual([
      '/api/private/session',
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
  it('distinguishes confirmed sign-out from an unverified network failure and sends no private request', async () => {
    for (const signedOut of [true, false]) {
      const mismatch = vi.fn(),
        unknown = vi.fn();
      const fetcher = vi.fn(async (_path: string) => {
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
      await expect(guard.fetcher('/api/private/drafts')).rejects.toBeInstanceOf(SessionClientError);
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
    const pending = guard.fetcher('/api/private/drafts', { signal: controller.signal });
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
    // The first proof is one request, sent before any private read and after all three asked.
    expect(order.slice(0, 2)).toEqual(['/api/private/session', paths[0]]);
    const proofs = order.filter((path) => path === '/api/private/session').length;
    expect(proofs).toBeLessThan(3 * paths.length);
    expect(proofs).toBeGreaterThanOrEqual(3);
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
      if (signals.length === 1 || signals.length > 3)
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
    await vi.waitFor(() => expect(signals).toHaveLength(4));
    all.abort();
    for (const request of pending) await expect(request).rejects.toBeInstanceOf(SessionClientError);
    expect(signals[3].aborted).toBe(true);
    expect(unverified).not.toHaveBeenCalled();
  });
});
