import { expect, it, vi } from 'vitest';
import { createMediaClient } from '../src/editor/media-client';
import { createAuthorSessionGuard } from '../src/editor/session-client';
const A = 'a'.repeat(43),
  B = 'b'.repeat(43),
  id = '11111111-1111-4111-8111-111111111111';
it('does not expose a private image Blob if the session changes at the guarded EOF proof', async () => {
  let checks = 0;
  const mismatch = vi.fn(),
    unknown = vi.fn();
  const fetcher: typeof fetch = async (input) =>
    String(input) === '/api/private/session'
      ? Response.json({ csrfToken: ++checks < 3 ? A : B })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
  const guard = createAuthorSessionGuard({
    csrfToken: A,
    origin: 'https://app.example.invalid',
    fetcher,
    onMismatch: mismatch,
    onUnverified: unknown,
  });
  await expect(createMediaClient(A, guard.fetcher).read(id)).rejects.toThrow();
  expect(checks).toBe(3);
  expect(mismatch).toHaveBeenCalledWith('changed');
});
it('consumes the complete bounded private body and all session proofs before returning a Blob', async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    paths.push(String(input));
    return String(input) === '/api/private/session'
      ? Response.json({ csrfToken: A })
      : new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/png', 'Content-Length': '3' },
        });
  };
  const guard = createAuthorSessionGuard({
    csrfToken: A,
    origin: 'https://app.example.invalid',
    fetcher,
    onMismatch: () => {
      throw Error('unexpected mismatch');
    },
    onUnverified: () => {
      throw Error('unexpected unknown');
    },
  });
  const blob = await createMediaClient(A, guard.fetcher).read(id);
  expect(blob.size).toBe(3);
  expect(blob.type).toBe('image/png');
  expect(paths).toEqual([
    '/api/private/session',
    '/api/private/media/' + id,
    '/api/private/session',
    '/api/private/session',
  ]);
  expect(paths.join('')).not.toContain(A);
});
it('rejects overlong bytes, private fields in receipts and malformed media without an automatic retry', async () => {
  let canceled = false;
  const over: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(524289));
        },
        cancel() {
          canceled = true;
        },
      }),
      { headers: { 'Content-Type': 'image/png' } },
    );
  await expect(createMediaClient(A, over).read(id)).rejects.toThrow();
  expect(canceled).toBe(true);
  const calls: RequestInit[] = [];
  const fetcher: typeof fetch = async (_, init) => {
    calls.push(init!);
    return Response.json(
      { id, mime: 'image/png', width: 1, height: 1, bytes: 3, ownerAccountId: 'private-identity' },
      { status: 201 },
    );
  };
  await expect(
    createMediaClient(A, fetcher).upload(
      'articles',
      id,
      1,
      id,
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    method: 'PUT',
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
  });
});
