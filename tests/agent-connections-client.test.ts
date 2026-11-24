import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentConnectionsClient,
  listAgentConnections,
} from '../src/agent/connections-client';

const csrf = 'c'.repeat(43);
const requestId = 'r'.repeat(43);
const id = '11111111-1111-4111-8111-111111111111';
const state = {
  connections: [{ id, clientName: 'Codex', createdAt: 1, lastUsedAt: 2, expiresAt: 3 }],
  agentDraftIds: [],
  hints: [],
};
const json = (value: unknown, status = 200) =>
  new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const initOf = (f: ReturnType<typeof vi.fn>, i = 0) =>
  (f.mock.calls[i] as unknown as [string, RequestInit])[1];
afterEach(() => vi.useRealTimers());

describe('agent connections client — on the bounded transport', () => {
  it('reads with the session cookie only and writes with the CSRF proof, never redirecting or caching', async () => {
    const f = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? json({ revoked: true })
        : init?.method === 'POST'
          ? json({ redirectTo: 'http://127.0.0.1:8765/callback?code=x' })
          : json(state),
    );
    const client = createAgentConnectionsClient(csrf, f as typeof fetch);
    expect(await client.list()).toEqual(state);
    expect(await client.revoke(id)).toBe(true);
    expect(await client.decide(requestId, 'allow')).toEqual({
      redirectTo: 'http://127.0.0.1:8765/callback?code=x',
    });
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      '/api/private/agent-connections',
      '/api/private/agent-connections/' + id,
      '/api/private/agent-connections/requests/' + requestId,
    ]);
    for (const i of [0, 1, 2])
      expect(initOf(f, i)).toMatchObject({
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
    expect(new Headers(initOf(f, 0).headers).has('Authorization')).toBe(false);
    expect(initOf(f, 0).body).toBeUndefined();
    expect(new Headers(initOf(f, 1).headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
    expect(initOf(f, 1).body).toBeUndefined();
    expect(new Headers(initOf(f, 2).headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
    expect(JSON.parse(String(initOf(f, 2).body))).toEqual({ decision: 'allow' });
  });

  it('reads a consent request with the session cookie only, never the CSRF proof or a body', async () => {
    const f = vi.fn(async () =>
      json({ clientName: 'Codex', destination: 'Codex', scope: 'drafts' }),
    );
    const client = createAgentConnectionsClient(csrf, f as typeof fetch);
    expect(await client.readRequest(requestId)).toEqual({
      clientName: 'Codex',
      destination: 'Codex',
      scope: 'drafts',
    });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/private/agent-connections/requests/' + requestId,
    );
    expect(initOf(f)).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(new Headers(initOf(f).headers).has('Authorization')).toBe(false);
    expect(initOf(f).body).toBeUndefined();
  });

  it('tells signed-out and too-many apart and turns every other failure into unavailable without retry', async () => {
    const answer = (status: number) => vi.fn(async () => json('"PRIVATE"', status));
    const client = (f: ReturnType<typeof vi.fn>) =>
      createAgentConnectionsClient(csrf, f as typeof fetch);
    expect(await client(answer(401)).readRequest(requestId)).toBe('signed-out');
    expect(await client(answer(404)).readRequest(requestId)).toBe('unavailable');
    for (const status of [401, 404, 500, 201]) {
      const f = answer(status);
      expect(await client(f).decide(requestId, 'deny')).toBe('unavailable');
      expect(f).toHaveBeenCalledTimes(1);
    }
    const conflict = answer(409);
    expect(await client(conflict).decide(requestId, 'allow')).toBe('too-many');
    expect(conflict).toHaveBeenCalledTimes(1);
    for (const status of [404, 409, 500]) {
      const f = answer(status);
      expect(await client(f).revoke(id)).toBe(false);
      expect(f).toHaveBeenCalledTimes(1);
      expect(await listAgentConnections(answer(status) as typeof fetch)).toBeNull();
    }
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await client(offline).revoke(id)).toBe(false);
    expect(await client(offline).decide(requestId, 'allow')).toBe('unavailable');
    expect(await listAgentConnections(offline as typeof fetch)).toBeNull();
    expect(offline).toHaveBeenCalledTimes(3);
  });

  it('refuses a false success, a non-JSON or oversized answer, and a non-http redirect', async () => {
    const client = (r: Response) =>
      createAgentConnectionsClient(csrf, (async () => r) as typeof fetch);
    expect(await client(json({ revoked: false })).revoke(id)).toBe(false);
    expect(await client(json({})).revoke(id)).toBe(false);
    expect(
      await client(json({ redirectTo: 'javascript:alert(1)' })).decide(requestId, 'allow'),
    ).toBe('unavailable');
    expect(
      await client(
        new Response(JSON.stringify(state), { headers: { 'Content-Type': 'text/html' } }),
      ).list(),
    ).toBeNull();
    const big = JSON.stringify({ ...state, pad: 'x'.repeat(262144) });
    expect(await client(json(big)).list()).toBeNull();
    expect(
      await client(
        json({ clientName: 'x'.repeat(101), destination: 'claude.ai', scope: 'drafts' }),
      ).readRequest(requestId),
    ).toBe('unavailable');
  });

  it('checks ids and the CSRF proof before any request', async () => {
    const f = vi.fn();
    const client = createAgentConnectionsClient(csrf, f as typeof fetch);
    expect(await client.revoke('../private')).toBe(false);
    expect(await client.readRequest('short')).toBe('unavailable');
    expect(await client.decide('r'.repeat(42) + '/', 'allow')).toBe('unavailable');
    for (const bad of ['', 'short', 'c'.repeat(42) + '!']) {
      const c = createAgentConnectionsClient(bad, f as typeof fetch);
      expect(await c.revoke(id)).toBe(false);
      expect(await c.decide(requestId, 'allow')).toBe('unavailable');
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('gives up at the deadline and on caller abort without returning a late answer', async () => {
    vi.useFakeTimers();
    const hang = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        ),
    );
    const pending = listAgentConnections(hang as typeof fetch);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await pending).toBeNull();
    const controller = new AbortController();
    const aborted = createAgentConnectionsClient(csrf, hang as typeof fetch).readRequest(
      requestId,
      controller.signal,
    );
    controller.abort();
    expect(await aborted).toBe('unavailable');
  });
});
