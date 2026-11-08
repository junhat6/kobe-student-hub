import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEnrollmentClient,
  EnrollmentClientError,
  type EnrollmentInput,
} from '../src/editor/enrollment-client';

const csrf = 'c'.repeat(43);
const input: EnrollmentInput = { admissionYear: 2026, graduationYear: 2027, expectedVersion: 0 };
const record = { admissionYear: 2026, graduationYear: 2027, version: 1, updatedAtMs: 1000 };
const value = { enrollment: record, participation: 'current' };
afterEach(() => vi.useRealTimers());

describe('private account enrollment client', () => {
  it('reads only a strict private enrollment DTO without identity or persistence', async () => {
    const fetcher = vi.fn(async () => Response.json(value));
    expect(await createEnrollmentClient(csrf, fetcher as typeof fetch).read()).toEqual(value);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/private/enrollment');
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(init.body).toBeUndefined();
  });
  it('saves only both explicit years and the expected version with CSRF', async () => {
    let body: unknown;
    let init: RequestInit | undefined;
    let path: unknown;
    const client = createEnrollmentClient(csrf, (async (p, i) => {
      path = p;
      init = i;
      body = JSON.parse(String(i?.body));
      return Response.json(value);
    }) as typeof fetch);
    expect(await client.save(input)).toEqual(value);
    expect(path).toBe('/api/private/enrollment');
    expect(body).toEqual(input);
    expect(init).toMatchObject({
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
  });
  it('requires an exact acknowledgement of the submitted years and next version', async () => {
    for (const enrollment of [
      null,
      { ...record, admissionYear: 2025 },
      { ...record, graduationYear: 2028 },
      { ...record, version: 2 },
    ])
      await expect(
        createEnrollmentClient(csrf, (async () =>
          Response.json({
            enrollment,
            participation: enrollment ? 'current' : 'missing',
          })) as typeof fetch).save(input),
      ).rejects.toBeInstanceOf(EnrollmentClientError);
    expect(
      await createEnrollmentClient(csrf, (async () =>
        Response.json({ ...value, enrollment: { ...record, version: 8 } })) as typeof fetch).save({
        ...input,
        expectedVersion: 7,
      }),
    ).toMatchObject({ enrollment: { version: 8 } });
  });
  it('accepts absent records and server-confirmed upcoming/current/ended states', async () => {
    expect(
      await createEnrollmentClient(csrf, (async () =>
        Response.json({ enrollment: null, participation: 'missing' })) as typeof fetch).read(),
    ).toEqual({ enrollment: null, participation: 'missing' });
    for (const participation of ['upcoming', 'current', 'ended'])
      expect(
        await createEnrollmentClient(csrf, (async () =>
          Response.json({ enrollment: record, participation })) as typeof fetch).read(),
      ).toEqual({ enrollment: record, participation });
  });
  it('allows inclusive year boundaries and same-year admission/graduation', async () => {
    for (const admissionYear of [1900, 2199]) {
      const graduationYear = admissionYear;
      const result = {
        enrollment: { admissionYear, graduationYear, version: 1, updatedAtMs: 0 },
        participation: 'ended',
      };
      expect(
        await createEnrollmentClient(csrf, (async () =>
          Response.json(result)) as typeof fetch).save({
          admissionYear,
          graduationYear,
          expectedVersion: 0,
        }),
      ).toEqual(result);
    }
  });
  it('rejects malformed years, unknown fields, identity and invalid versions before sending', async () => {
    const fetcher = vi.fn();
    const client = createEnrollmentClient(csrf, fetcher as typeof fetch);
    for (const bad of [
      { ...input, admissionYear: 1899 },
      { ...input, graduationYear: 2200 },
      { ...input, admissionYear: 2028 },
      { ...input, admissionYear: 2026.5 },
      { ...input, graduationYear: '2027' },
      { ...input, expectedVersion: -1 },
      { ...input, expectedVersion: 0.5 },
      { ...input, expectedVersion: Number.MAX_SAFE_INTEGER },
      { ...input, email: 'private@example.invalid' },
      { ...input, accountId: 'owner' },
      { ...input, [Symbol('extra')]: true },
      Object.assign(Object.create({ extra: true }), input),
      { admissionYear: 2026, graduationYear: 2027 },
      null,
    ])
      await expect(client.save(bad as EnrollmentInput)).rejects.toBeInstanceOf(
        EnrollmentClientError,
      );
    await expect(
      createEnrollmentClient('invalid', fetcher as typeof fetch).save(input),
    ).rejects.toBeInstanceOf(EnrollmentClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects extra/private fields and inconsistent or unbounded read DTOs generically', async () => {
    for (const bad of [
      { ...value, email: 'PRIVATE_EMAIL' },
      { ...value, enrollment: { ...record, googleSubject: 'PRIVATE_SUBJECT' } },
      { ...value, enrollment: { ...record, admissionYear: '2026' } },
      { ...value, enrollment: { ...record, graduationYear: 2025 } },
      { ...value, enrollment: { ...record, version: 0 } },
      { ...value, enrollment: { ...record, version: 1.5 } },
      { ...value, enrollment: { ...record, updatedAtMs: -1 } },
      { ...value, enrollment: { ...record, updatedAtMs: 1e20 } },
      { ...value, participation: 'missing' },
      { ...value, participation: 'approved' },
      { ...value, participation: ['current'] },
      { enrollment: null, participation: 'current' },
    ])
      await expect(
        createEnrollmentClient(csrf, (async () => Response.json(bad)) as typeof fetch).read(),
      ).rejects.toThrow('年度の保存状態を確認できませんでした。');
  });
  it('rejects unavailable, redirect, malformed, oversized and mismatched-length responses', async () => {
    for (const make of [
      () => Response.json(value, { status: 201 }),
      () => new Response('PRIVATE_FAILURE', { status: 503 }),
      () => new Response(null, { status: 303 }),
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
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
    ])
      await expect(
        createEnrollmentClient(csrf, (async () => make()) as typeof fetch).read(),
      ).rejects.toBeInstanceOf(EnrollmentClientError);
  });
  it('rejects malformed UTF-8 and bounds empty-chunk work through EOF', async () => {
    const invalid = new Response(new Uint8Array([0xff]), {
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(
      createEnrollmentClient(csrf, (async () => invalid) as typeof fetch).read(),
    ).rejects.toBeInstanceOf(EnrollmentClientError);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      createEnrollmentClient(
        csrf,
        (async () =>
          new Response(stream, {
            headers: { 'Content-Type': 'application/json' },
          })) as typeof fetch,
      ).read(),
    ).rejects.toBeInstanceOf(EnrollmentClientError);
    expect(cancelled).toBe(true);
  });
  it('does not retry an uncertain mutation or accept a late header acknowledgement', async () => {
    vi.useFakeTimers();
    let release: (response: Response) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const promise = createEnrollmentClient(csrf, fetcher as typeof fetch).save(input);
    const rejected = expect(promise).rejects.toBeInstanceOf(EnrollmentClientError);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json(value));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps the deadline active after complete JSON bytes until body EOF', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn(
      async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }),
    );
    const promise = createEnrollmentClient(csrf, fetcher as typeof fetch).save(input);
    const rejected = expect(promise).rejects.toBeInstanceOf(EnrollmentClientError);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(cancelled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('supports owner-scope cancellation before fetch and during body consumption', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const never = vi.fn();
    await expect(
      createEnrollmentClient(csrf, never as typeof fetch).read(aborted.signal),
    ).rejects.toBeInstanceOf(EnrollmentClientError);
    expect(never).not.toHaveBeenCalled();
    const controller = new AbortController();
    let cancelled = false;
    let arrived!: () => void;
    const ready = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        output.enqueue(new TextEncoder().encode('{'));
        arrived();
      },
      cancel() {
        cancelled = true;
      },
    });
    const promise = createEnrollmentClient(
      csrf,
      (async () =>
        new Response(body, { headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
    ).read(controller.signal);
    const rejected = expect(promise).rejects.toBeInstanceOf(EnrollmentClientError);
    await ready;
    controller.abort();
    await rejected;
    expect(cancelled).toBe(true);
  });
});
