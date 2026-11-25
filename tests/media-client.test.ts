import { expect, it, vi } from 'vitest';
import { createMediaClient, MediaClientError, MediaLimitError } from '../src/editor/media-client';
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
      ? Response.json({ csrfToken: ++checks < 2 ? A : B })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
  const guard = createAuthorSessionGuard({
    csrfToken: A,
    origin: 'https://app.example.invalid',
    fetcher,
    onMismatch: mismatch,
    onUnverified: unknown,
  });
  await expect(createMediaClient(A, guard.fetcher).read(id)).rejects.toThrow();
  // Post-header (A) then EOF (B): a read needs no proof before it is sent (#272).
  expect(checks).toBe(2);
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

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
it('sends an upload as one PUT with the image, If-Match, CSRF proof and no other credentials', async () => {
  const calls: [string, RequestInit][] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push([String(input), init!]);
    return Response.json({ id, mime: 'image/png', width: 1, height: 1, bytes: 3 }, { status: 201 });
  };
  const blob = png();
  expect(await createMediaClient(A, fetcher).upload('projects', id, 4, id, blob)).toEqual({
    id,
    mime: 'image/png',
    width: 1,
    height: 1,
    bytes: 3,
  });
  expect(calls).toHaveLength(1);
  const [path, init] = calls[0]!;
  expect(path).toBe(`/api/private/media/projects/${id}/${id}`);
  expect(init).toMatchObject({ method: 'PUT', credentials: 'same-origin', redirect: 'error' });
  expect(init.body).toBe(blob);
  const headers = new Headers(init.headers);
  expect(headers.get('If-Match')).toBe('"4"');
  expect(headers.get('Content-Type')).toBe('image/png');
  expect(headers.get('Authorization')).toBe('Bearer csrf.' + A);
});
it('names the reached limit only from an exact 409 media_limit body, and never resends', async () => {
  let count = 0;
  const answer =
    (body: unknown, status = 409, type = 'application/json'): typeof fetch =>
    async () => {
      count++;
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
    };
  const upload = (f: typeof fetch) => createMediaClient(A, f).upload('articles', id, 1, id, png());
  const limited = await upload(answer({ error: 'media_limit', limit: 'draft' })).catch(
    (e: unknown) => e,
  );
  expect(limited).toBeInstanceOf(MediaLimitError);
  expect((limited as MediaLimitError).limit).toBe('draft');
  for (const f of [
    answer({ error: 'media_limit', limit: 'nope' }),
    answer({ error: 'media_limit', limit: 'draft', extra: 1 }),
    answer({ error: 'other', limit: 'draft' }),
    answer({ error: 'media_limit', limit: 'draft' }, 409, 'text/plain'),
    answer({ error: 'media_limit', limit: 'draft' }, 422),
  ]) {
    const error = await upload(f).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaClientError);
    expect(error).not.toBeInstanceOf(MediaLimitError);
  }
  expect(count).toBe(6);
});
it('lists and removes only through exact JSON shapes', async () => {
  const receipt = { id, mime: 'image/jpeg', width: 2, height: 2, bytes: 9 };
  const reply =
    (body: unknown, type = 'application/json'): typeof fetch =>
    async () =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': type } });
  expect(await createMediaClient(A, reply({ images: [receipt] })).list('articles', id)).toEqual([
    receipt,
  ]);
  for (const f of [
    reply({ images: [receipt], more: 1 }),
    reply({ images: [receipt, receipt] }),
    reply({ images: [receipt] }, 'text/plain'),
  ])
    await expect(createMediaClient(A, f).list('articles', id)).rejects.toBeInstanceOf(
      MediaClientError,
    );
  const calls: RequestInit[] = [];
  const removed: typeof fetch = async (_, init) => {
    calls.push(init!);
    return Response.json({ deleted: true });
  };
  await createMediaClient(A, removed).remove(id);
  expect(calls[0]).toMatchObject({ method: 'DELETE', credentials: 'same-origin' });
  expect(new Headers(calls[0]!.headers).get('Authorization')).toBe('Bearer csrf.' + A);
  expect(calls[0]!.body).toBeUndefined();
  for (const f of [reply({ deleted: false }), reply({ deleted: true }, 'text/plain')])
    await expect(createMediaClient(A, f).remove(id)).rejects.toBeInstanceOf(MediaClientError);
});
it('reads an image only as PNG or JPEG with a non-empty body', async () => {
  const image =
    (type: string, bytes = new Uint8Array([1])): typeof fetch =>
    async () =>
      new Response(bytes, { headers: { 'Content-Type': type } });
  expect((await createMediaClient(A, image('image/jpeg')).read(id)).type).toBe('image/jpeg');
  for (const f of [
    image('image/gif'),
    image('application/json'),
    image('image/png', new Uint8Array()),
    // A body shorter than its Content-Length is a cut transfer, not a smaller image.
    async () =>
      new Response(new Uint8Array([1]), {
        headers: { 'Content-Type': 'image/png', 'Content-Length': '2' },
      }),
  ])
    await expect(createMediaClient(A, f).read(id)).rejects.toBeInstanceOf(MediaClientError);
});
