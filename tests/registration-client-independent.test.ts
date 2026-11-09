import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRegistrationClient,
  RegistrationClientError,
} from '../src/account/registration-client';

const origin = 'https://app.example.invalid';
const command = 'c'.repeat(43),
  csrf = 'a'.repeat(43);
const years = { admissionYear: 2026, graduationYear: 2028 };
const own = { enrollment: { ...years, version: 1, updatedAtMs: 1000 }, participation: 'current' };
const encoder = new TextEncoder();
function authorizationUrl() {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const fields = {
    client_id: 'fixture-client.apps.googleusercontent.com',
    redirect_uri: origin + '/api/auth/callback',
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'openid email',
    hd: 'st.kobedenshi.ac.jp',
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    code_challenge: 'p'.repeat(43),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  };
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
  return url.toString();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function expectFailure(
  pending: Promise<unknown>,
  kind: 'unknown' | 'signed-out' | 'unavailable',
) {
  const error: unknown = await pending.then(
    () => null,
    (error) => error,
  );
  expect(error).toBeInstanceOf(RegistrationClientError);
  expect((error as RegistrationClientError).kind).toBe(kind);
  expect((error as Error).message).not.toContain('PRIVATE');
}
afterEach(() => vi.useRealTimers());

describe('independent ordinary-registration transport QA', () => {
  it('withholds the registration mutation until the command body reaches EOF', async () => {
    const reached = deferred<void>();
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        output.enqueue(encoder.encode(JSON.stringify({ commandToken: command })));
        finish = () => output.close();
      },
    });
    const calls: string[] = [];
    const fetcher = (async (path: unknown) => {
      calls.push(String(path));
      if (path === '/api/auth/bootstrap') return new Response(null, { status: 204 });
      if (String(path).startsWith('/api/auth/command?')) {
        reached.resolve();
        return new Response(body, { headers: { 'Content-Type': 'application/json' } });
      }
      return Response.json({ authorizationUrl: authorizationUrl() });
    }) as typeof fetch;
    let settled = false;
    const pending = createRegistrationClient({ origin, fetcher })
      .startRegistration(years)
      .finally(() => {
        settled = true;
      });
    await reached.promise;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(settled).toBe(false);
    expect(calls).toHaveLength(2);
    finish();
    expect(await pending).toEqual({ authorizationUrl: authorizationUrl() });
    expect(calls).toEqual([
      '/api/auth/bootstrap',
      '/api/auth/command?action=self-registration',
      '/api/auth/register',
    ]);
  });

  it('aborts a complete but unfinished command body without sending a registration mutation', async () => {
    const reached = deferred<void>();
    let cancelled = false;
    let commandSignal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        output.enqueue(encoder.encode(JSON.stringify({ commandToken: command })));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    });
    const fetcher = vi.fn(async (path: unknown, init?: RequestInit) => {
      if (path === '/api/auth/bootstrap') return new Response(null, { status: 204 });
      commandSignal = init?.signal as AbortSignal;
      reached.resolve();
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });
    const external = new AbortController();
    const rejected = expectFailure(
      createRegistrationClient({ origin, fetcher: fetcher as typeof fetch }).startRegistration(
        years,
        external.signal,
      ),
      'unknown',
    );
    await reached.promise;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    external.abort();
    await rejected;
    expect(cancelled).toBe(true);
    expect(commandSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses a single inspection deadline across all session proofs and the enrollment request', async () => {
    vi.useFakeTimers();
    const calls: { path: string; signal: AbortSignal | undefined }[] = [];
    const fetcher = (async (path: unknown, init?: RequestInit) => {
      calls.push({ path: String(path), signal: init?.signal as AbortSignal });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 3000);
      });
      return Response.json(path === '/api/private/session' ? { csrfToken: csrf } : own);
    }) as typeof fetch;
    const rejected = expectFailure(
      createRegistrationClient({ origin, fetcher }).inspect(),
      'unavailable',
    );
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(calls.map((call) => call.path)).toEqual([
      '/api/private/session',
      '/api/private/session',
      '/api/private/enrollment',
      '/api/private/session',
    ]);
    expect(calls.every((call) => call.signal?.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toHaveLength(4);
  });

  for (const lostAt of [3, 4])
    it(`reports confirmed sign-out at session proof ${lostAt} without returning enrollment data`, async () => {
      let proofs = 0,
        enrollments = 0;
      const fetcher = (async (path: unknown) => {
        if (path === '/api/private/session')
          return ++proofs === lostAt
            ? new Response('PRIVATE_AUTH_CONTEXT', { status: 401 })
            : Response.json({ csrfToken: csrf });
        enrollments++;
        return Response.json(own);
      }) as typeof fetch;
      await expectFailure(createRegistrationClient({ origin, fetcher }).inspect(), 'signed-out');
      expect(proofs).toBe(lostAt);
      expect(enrollments).toBe(1);
    });

  it('does not turn a failed final session proof into success after receiving a valid enrollment DTO', async () => {
    let proofs = 0;
    const fetcher = (async (path: unknown) => {
      if (path !== '/api/private/session') return Response.json(own);
      if (++proofs === 4) throw Error('PRIVATE_PROVIDER_RESPONSE');
      return Response.json({ csrfToken: csrf });
    }) as typeof fetch;
    await expectFailure(createRegistrationClient({ origin, fetcher }).inspect(), 'unavailable');
    expect(proofs).toBe(4);
  });
});
