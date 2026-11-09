import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRegistrationClient,
  RegistrationClientError,
} from '../src/account/registration-client';
import type { EnrollmentYears } from '../src/shared/enrollment';

const origin = 'https://app.example.invalid',
  command = 'c'.repeat(43),
  csrf = 'a'.repeat(43),
  otherCsrf = 'b'.repeat(43);
const years: EnrollmentYears = { admissionYear: 2026, graduationYear: 2028 };
const enrollment = { admissionYear: 2026, graduationYear: 2028, version: 1, updatedAtMs: 1000 };
const own = { enrollment, participation: 'current' };
function provider() {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [key, value] of Object.entries({
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
  }))
    url.searchParams.set(key, value);
  return url;
}
const authorizationUrl = () => provider().toString();
type Call = { path: string; init: RequestInit | undefined };
function successfulStart(
  override?: (path: string, index: number) => Response | Promise<Response> | undefined,
) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (path: unknown, init?: RequestInit) => {
    const target = String(path),
      index = calls.length;
    calls.push({ path: target, init });
    return (
      override?.(target, index) ??
      (target === '/api/auth/bootstrap'
        ? new Response(null, { status: 204 })
        : target.startsWith('/api/auth/command?')
          ? Response.json({ commandToken: command })
          : Response.json({ authorizationUrl: authorizationUrl() }))
    );
  });
  return {
    calls,
    fetcher,
    client: createRegistrationClient({ origin, fetcher: fetcher as typeof fetch }),
  };
}
async function failure(promise: Promise<unknown>, kind = 'unknown') {
  const error = await promise.then(
    () => null,
    (error) => error,
  );
  expect(error).toBeInstanceOf(RegistrationClientError);
  expect(error.kind).toBe(kind);
  return error as RegistrationClientError;
}
afterEach(() => vi.useRealTimers());

describe('ordinary registration browser client', () => {
  it('starts with exactly two explicit years and a header-only command proof', async () => {
    const { client, calls } = successfulStart();
    expect(await client.startRegistration(years)).toEqual({ authorizationUrl: authorizationUrl() });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/auth/bootstrap',
      '/api/auth/command?action=self-registration',
      '/api/auth/register',
    ]);
    for (const { path, init } of calls) {
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'manual',
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(path).not.toContain(command);
      expect(path).not.toContain(csrf);
    }
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[1].init?.body).toBeUndefined();
    expect(new Headers(calls[0].init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(calls[1].init?.headers).has('Authorization')).toBe(false);
    const final = calls[2].init!;
    expect(JSON.parse(String(final.body))).toEqual(years);
    expect(new Headers(final.headers).get('Authorization')).toBe('Bearer command.' + command);
    expect(new Headers(final.headers).get('Content-Type')).toMatch(/^application\/json/);
  });

  it('starts ordinary login without years, identity defaults or a request body', async () => {
    const { client, calls } = successfulStart();
    expect(await client.startLogin()).toEqual({ authorizationUrl: authorizationUrl() });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/auth/bootstrap',
      '/api/auth/command?action=login',
      '/api/auth/start',
    ]);
    for (const call of calls) {
      expect(call.init?.body).toBeUndefined();
      expect(new Headers(call.init?.headers).has('Content-Type')).toBe(false);
    }
  });

  it('uses a confirmed existing-context409 once and never retries bootstrap', async () => {
    const { client, calls } = successfulStart((path) =>
      path === '/api/auth/bootstrap'
        ? Response.json({ error: 'authentication_restart_required' }, { status: 409 })
        : undefined,
    );
    await client.startRegistration(years);
    expect(calls).toHaveLength(3);
    for (const payload of [
      { error: 'different' },
      { error: 'authentication_restart_required', identity: 'PRIVATE_EMAIL' },
    ]) {
      const run = successfulStart((path) =>
        path === '/api/auth/bootstrap' ? Response.json(payload, { status: 409 }) : undefined,
      );
      await failure(run.client.startRegistration(years));
      expect(run.calls).toHaveLength(1);
    }
  });

  it('rejects invalid or identity-bearing years before any request and snapshots valid input', async () => {
    const run = successfulStart();
    for (const bad of [
      null,
      {},
      { ...years, email: 'PRIVATE_EMAIL' },
      { ...years, accountId: 'PRIVATE_ACCOUNT' },
      { ...years, admissionYear: '2026' },
      { ...years, admissionYear: 1899 },
      { ...years, graduationYear: 2200 },
      { ...years, admissionYear: 2029 },
      { ...years, graduationYear: 2028.5 },
      { ...years, [Symbol('extra')]: true },
      Object.assign(Object.create({ hidden: true }), years),
    ])
      await failure(run.client.startRegistration(bad as EnrollmentYears), 'invalid-input');
    expect(run.calls).toHaveLength(0);
    let release!: (response: Response) => void;
    const snapshot = successfulStart((path) =>
        path === '/api/auth/bootstrap'
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : undefined,
      ),
      mutable = { ...years };
    const pending = snapshot.client.startRegistration(mutable);
    mutable.admissionYear = 2024;
    mutable.graduationYear = 2025;
    release(new Response(null, { status: 204 }));
    await pending;
    expect(JSON.parse(String(snapshot.calls[2].init?.body))).toEqual(years);
  });

  it('requires exact command and authorization DTOs without retaining private payload fields', async () => {
    for (const payload of [
      { commandToken: 'short' },
      { commandToken: command, identity: 'PRIVATE_EMAIL' },
      { csrfToken: command },
      null,
    ]) {
      const run = successfulStart((path) =>
        path.startsWith('/api/auth/command?') ? Response.json(payload) : undefined,
      );
      const error = await failure(run.client.startRegistration(years));
      expect(error.message).not.toContain('PRIVATE');
      expect(run.calls).toHaveLength(2);
    }
    for (const payload of [
      { authorizationUrl: authorizationUrl(), subject: 'PRIVATE_SUBJECT' },
      { authorizationUrl: [] },
      { location: authorizationUrl() },
      null,
    ]) {
      const run = successfulStart((path) =>
        path === '/api/auth/register' ? Response.json(payload) : undefined,
      );
      const error = await failure(run.client.startRegistration(years));
      expect(error.message).not.toContain('PRIVATE');
      expect(run.calls).toHaveLength(3);
    }
  });

  it('pins every authorization URL origin, route, redirect target and fixed protocol field', async () => {
    const attacks: string[] = [
      'http://accounts.google.com/o/oauth2/v2/auth',
      'https://accounts.google.com.evil.invalid/o/oauth2/v2/auth',
      'https://PRIVATE@accounts.google.com/o/oauth2/v2/auth',
      'https://accounts.google.com:444/o/oauth2/v2/auth',
      'https://accounts.google.com/o/oauth2/v2/auth#PRIVATE',
      authorizationUrl().replace('accounts.google.com/', 'accounts.google.com:443/'),
      authorizationUrl() + '#',
    ];
    for (const [key, value] of [
      ['redirect_uri', 'https://evil.invalid/api/auth/callback'],
      ['redirect_uri', origin + '/other'],
      ['response_type', 'token'],
      ['response_mode', 'query'],
      ['response_mode', 'fragment'],
      ['scope', 'openid email profile'],
      ['hd', 'other.invalid'],
      ['code_challenge_method', 'plain'],
      ['prompt', 'none'],
      ['client_id', 'invalid'],
      ['state', 'short'],
      ['nonce', 'bad+'.repeat(20)],
      ['code_challenge', 'p'.repeat(44)],
    ]) {
      const url = provider();
      url.searchParams.set(key, value);
      attacks.push(url.toString());
    }
    const path = provider();
    path.pathname = '/o/oauth2/v2/auth/';
    attacks.push(path.toString());
    const duplicate = provider();
    duplicate.searchParams.append('state', 's'.repeat(43));
    attacks.push(duplicate.toString());
    const duplicateMode = provider();
    duplicateMode.searchParams.append('response_mode', 'fragment');
    attacks.push(duplicateMode.toString());
    const missingMode = provider();
    missingMode.searchParams.delete('response_mode');
    attacks.push(missingMode.toString());
    const extra = provider();
    extra.searchParams.set('login_hint', 'PRIVATE_EMAIL');
    attacks.push(extra.toString());
    const absent = provider();
    absent.searchParams.delete('nonce');
    attacks.push(absent.toString());
    for (const authorizationUrl of attacks) {
      const run = successfulStart((path) =>
        path === '/api/auth/register' ? Response.json({ authorizationUrl }) : undefined,
      );
      const error = await failure(run.client.startRegistration(years));
      expect(error.message).not.toMatch(/PRIVATE|evil|accounts/);
      expect(run.calls).toHaveLength(3);
    }
  });

  it('rejects errors and unexpected statuses at each step without retries or reflected error bodies', async () => {
    for (const stage of [0, 1, 2])
      for (const mode of ['network', 'http']) {
        const run = successfulStart((_path, index) => {
          if (index !== stage) return undefined;
          if (mode === 'network') throw new Error('PRIVATE_NETWORK_TOKEN');
          return new Response('PRIVATE_PROVIDER_CODE', { status: 503 });
        });
        const error = await failure(run.client.startRegistration(years));
        expect(error.message).not.toContain('PRIVATE');
        expect(run.calls).toHaveLength(stage + 1);
      }
  });

  it('never follows redirect or opaque redirect responses while expecting JSON start data', async () => {
    for (const opaque of [false, true]) {
      const run = successfulStart((path) => {
        if (path !== '/api/auth/register') return;
        const response = new Response(null, {
          status: opaque ? 200 : 303,
          headers: { Location: authorizationUrl() },
        });
        if (opaque) Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
        return response;
      });
      await failure(run.client.startRegistration(years));
      expect(run.calls).toHaveLength(3);
      expect(run.calls[2].init?.redirect).toBe('manual');
    }
  });

  it('rejects followed redirects and mismatched response URLs despite valid status200 JSON', async () => {
    for (const patch of [
      { redirected: true },
      { url: origin + '/api/auth/other' },
      { url: 'https://foreign.invalid/api/auth/register' },
    ]) {
      const run = successfulStart((path) => {
        if (path !== '/api/auth/register') return;
        const response = Response.json({ authorizationUrl: authorizationUrl() });
        for (const [key, value] of Object.entries(patch))
          Object.defineProperty(response, key, { value });
        return response;
      });
      await failure(run.client.startRegistration(years));
      expect(run.calls).toHaveLength(3);
    }
  });

  it('rejects malformed content types, UTF-8, declared lengths and oversized JSON', async () => {
    for (const make of [
      () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
      () =>
        new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      () => new Response('x'.repeat(4097), { headers: { 'Content-Type': 'application/json' } }),
      () =>
        new Response('{}', {
          headers: { 'Content-Type': 'application/json', 'Content-Length': '4097' },
        }),
      () =>
        new Response('{}', {
          headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
        }),
      () =>
        new Response('{}', {
          headers: { 'Content-Type': 'application/json', 'Content-Length': 'NaN' },
        }),
    ]) {
      const run = successfulStart((path) =>
        path.startsWith('/api/auth/command?') ? make() : undefined,
      );
      await failure(run.client.startRegistration(years));
      expect(run.calls).toHaveLength(2);
    }
  });

  it('bounds empty-chunk work and does not await stalled cancellation', async () => {
    let pulls = 0,
      cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(output) {
        pulls++;
        output.enqueue(new Uint8Array());
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    });
    const run = successfulStart((path) =>
      path.startsWith('/api/auth/command?')
        ? new Response(body, { headers: { 'Content-Type': 'application/json' } })
        : undefined,
    );
    await failure(run.client.startRegistration(years));
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(4100);
    expect(run.calls).toHaveLength(2);
  });

  it('uses one total deadline across bootstrap and command, preventing late continuation', async () => {
    vi.useFakeTimers();
    const run = successfulStart((_path, index) =>
      index < 2
        ? new Promise<Response>((resolve) => {
            setTimeout(
              () =>
                resolve(
                  index === 0
                    ? new Response(null, { status: 204 })
                    : Response.json({ commandToken: command }),
                ),
              6000,
            );
          })
        : undefined,
    );
    let error: unknown;
    const pending = run.client.startRegistration(years).catch((value) => {
      error = value;
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(error).toBeInstanceOf(RegistrationClientError);
    expect((error as RegistrationClientError).kind).toBe('unknown');
    expect(run.calls).toHaveLength(2);
    expect(run.calls[1].init?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(run.calls).toHaveLength(2);
  });

  it('keeps the deadline through complete authorization JSON until EOF', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        output.enqueue(
          new TextEncoder().encode(JSON.stringify({ authorizationUrl: authorizationUrl() })),
        );
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    });
    const run = successfulStart((path) =>
      path === '/api/auth/register'
        ? new Response(body, { headers: { 'Content-Type': 'application/json' } })
        : undefined,
    );
    const rejected = failure(run.client.startRegistration(years));
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(cancelled).toBe(true);
    expect(run.calls).toHaveLength(3);
  });

  it('supports cancellation before fetch and while noncooperative response headers are pending', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const never = successfulStart();
    await failure(never.client.startRegistration(years, aborted.signal));
    expect(never.calls).toHaveLength(0);
    const controller = new AbortController();
    let release!: (response: Response) => void;
    const run = successfulStart((path) =>
      path === '/api/auth/bootstrap'
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : undefined,
    );
    const rejected = failure(run.client.startRegistration(years, controller.signal));
    controller.abort();
    await rejected;
    expect(run.calls[0].init?.signal?.aborted).toBe(true);
    release(new Response(null, { status: 204 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(run.calls).toHaveLength(1);
  });
});

describe('registration return inspection', () => {
  it('returns only a strict enrollment DTO after session proof before headers and at EOF', async () => {
    const calls: Call[] = [];
    const fetcher = vi.fn(async (path: unknown, init?: RequestInit) => {
      calls.push({ path: String(path), init });
      return Response.json(path === '/api/private/session' ? { csrfToken: csrf } : own);
    });
    expect(
      await createRegistrationClient({ origin, fetcher: fetcher as typeof fetch }).inspect(),
    ).toEqual({ csrfToken: csrf, ...own });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/private/session',
      '/api/private/session',
      '/api/private/enrollment',
      '/api/private/session',
      '/api/private/session',
    ]);
    for (const call of calls) {
      expect(call.init).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(call.init?.body).toBeUndefined();
      expect(call.path).not.toContain(csrf);
    }
  });

  it('reports missing declaration without guessing years or current participation', async () => {
    const client = createRegistrationClient({
      origin,
      fetcher: (async (path) =>
        Response.json(
          path === '/api/private/session'
            ? { csrfToken: csrf }
            : { enrollment: null, participation: 'missing' },
        )) as typeof fetch,
    });
    expect(await client.inspect()).toEqual({
      csrfToken: csrf,
      enrollment: null,
      participation: 'missing',
    });
  });

  it('distinguishes confirmed sign-out from unavailable proof and sends no enrollment request', async () => {
    for (const signedOut of [true, false]) {
      const fetcher = vi.fn(async () => {
        if (signedOut) return new Response('PRIVATE', { status: 401 });
        throw Error('PRIVATE_NETWORK');
      });
      const error = await failure(
        createRegistrationClient({ origin, fetcher: fetcher as typeof fetch }).inspect(),
        signedOut ? 'signed-out' : 'unavailable',
      );
      expect(error.message).not.toContain('PRIVATE');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects leaked identity or extra enrollment fields without returning a partial inspection', async () => {
    for (const leakSession of [true, false]) {
      const fetcher = vi.fn(async (path) =>
        Response.json(
          path === '/api/private/session'
            ? { csrfToken: csrf, ...(leakSession ? { email: 'PRIVATE_EMAIL' } : {}) }
            : { ...own, googleSubject: 'PRIVATE_SUBJECT' },
        ),
      );
      const error = await failure(
        createRegistrationClient({ origin, fetcher: fetcher as typeof fetch }).inspect(),
        'unavailable',
      );
      expect(error.message).not.toContain('PRIVATE');
      if (leakSession) expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses enrollment headers that arrive after the session changes', async () => {
    let current = csrf;
    const fetcher = vi.fn(async (path) => {
      if (path === '/api/private/session') return Response.json({ csrfToken: current });
      current = otherCsrf;
      return Response.json(own);
    });
    await failure(
      createRegistrationClient({ origin, fetcher: fetcher as typeof fetch }).inspect(),
      'unavailable',
    );
  });

  it('withholds complete enrollment bytes when the session changes before EOF', async () => {
    let current = csrf,
      proofs = 0,
      finish!: () => void,
      ready!: () => void;
    const headersChecked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        output.enqueue(new TextEncoder().encode(JSON.stringify(own)));
        finish = () => output.close();
      },
    });
    const client = createRegistrationClient({
      origin,
      fetcher: (async (path) => {
        if (path === '/api/private/session') {
          const response = Response.json({ csrfToken: current });
          if (++proofs === 3) ready();
          return response;
        }
        return new Response(body, { headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch,
    });
    const rejected = failure(client.inspect(), 'unavailable');
    await headersChecked;
    current = otherCsrf;
    finish();
    await rejected;
    expect(proofs).toBe(4);
  });

  it('bounds an unfinished inspection body and honors cancellation without disclosure', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        output.enqueue(new TextEncoder().encode(JSON.stringify(own)));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    });
    const client = createRegistrationClient({
      origin,
      fetcher: (async (path) =>
        path === '/api/private/session'
          ? Response.json({ csrfToken: csrf })
          : new Response(body, {
              headers: { 'Content-Type': 'application/json' },
            })) as typeof fetch,
    });
    const rejected = failure(client.inspect(), 'unavailable');
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(cancelled).toBe(true);
  });

  it('honors external inspection abort before fetch and during a pending enrollment body', async () => {
    const before = new AbortController();
    before.abort();
    const never = vi.fn();
    await failure(
      createRegistrationClient({ origin, fetcher: never as typeof fetch }).inspect(before.signal),
      'unavailable',
    );
    expect(never).not.toHaveBeenCalled();
    const controller = new AbortController();
    let cancelled = false,
      proofs = 0,
      ready!: () => void,
      enrollmentSignal: AbortSignal | undefined;
    const headersChecked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        output.enqueue(new TextEncoder().encode(JSON.stringify(own)));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    });
    const client = createRegistrationClient({
      origin,
      fetcher: (async (path, init) => {
        if (path === '/api/private/session') {
          const response = Response.json({ csrfToken: csrf });
          if (++proofs === 3) ready();
          return response;
        }
        enrollmentSignal = init?.signal as AbortSignal;
        return new Response(body, { headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch,
    });
    const rejected = failure(client.inspect(controller.signal), 'unavailable');
    await headersChecked;
    controller.abort();
    await rejected;
    expect(enrollmentSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
  });
});
