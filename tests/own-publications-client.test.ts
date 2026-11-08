import { it, expect, vi, afterEach } from 'vitest';
import {
  createOwnPublicationsClient,
  OwnPublicationsClientError,
} from '../src/editor/own-publications-client';
const id = '11111111-1111-4111-8111-111111111111';
const row = {
  kind: 'article',
  publicId: id,
  title: '本人の公開記録',
  status: 'hidden',
  publishedAt: 1,
  sourceVersion: 2,
};
afterEach(() => vi.useRealTimers());
it('reads only own private summaries with credentials and no mutation or bootstrap', async () => {
  const f = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ publications: [row], moreExists: false }),
  );
  expect(await createOwnPublicationsClient(f as typeof fetch).read()).toEqual({
    publications: [row],
    moreExists: false,
  });
  expect(f).toHaveBeenCalledWith(
    '/api/private/own-publications',
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    }),
  );
  const init = f.mock.calls[0]?.[1] as RequestInit | undefined;
  expect(init?.body).toBeUndefined();
  expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  expect(f).toHaveBeenCalledTimes(1);
});
it('distinguishes authorized empty, preserves combined server order and accepts a genuine partial20', async () => {
  const read = (value: unknown) =>
    createOwnPublicationsClient((async () => Response.json(value)) as typeof fetch).read();
  expect(await read({ publications: [], moreExists: false })).toEqual({
    publications: [],
    moreExists: false,
  });
  const publications = [{ ...row, kind: 'project', status: 'published', publishedAt: 3 }, row];
  expect((await read({ publications, moreExists: false })).publications).toEqual(publications);
  const twenty = Array.from({ length: 20 }, (_, i) => ({
    ...row,
    publicId: (i + 1).toString(16).padStart(8, '0') + '-1111-4111-8111-111111111111',
  }));
  expect((await read({ publications: twenty, moreExists: true })).publications).toHaveLength(20);
});
it('rejects private fields, malformed states, duplicate records and inconsistent partial envelopes', async () => {
  for (const v of [
    { publications: [{ ...row, ownerId: 'PRIVATE' }], moreExists: false },
    { publications: [{ ...row, body: 'PRIVATE' }], moreExists: false },
    { publications: [{ ...row, reason: 'PRIVATE' }], moreExists: false },
    { publications: [{ ...row, status: ['published'] }], moreExists: false },
    { publications: [{ ...row, status: ['hidden'] }], moreExists: false },
    { publications: [{ ...row, status: { value: 'hidden' } }], moreExists: false },
    { publications: [{ ...row, kind: 'profile' }], moreExists: false },
    { publications: [{ ...row, publishedAt: 253402300800000 }], moreExists: false },
    { publications: [{ ...row, sourceVersion: 0 }], moreExists: false },
    { publications: [{ ...row, title: ' ' }], moreExists: false },
    { publications: [row, row], moreExists: false },
    { publications: [row], moreExists: true },
    { publications: Array(21).fill(row), moreExists: false },
    { publications: [], moreExists: 'false' },
  ])
    await expect(
      createOwnPublicationsClient((async () => Response.json(v)) as typeof fetch).read(),
    ).rejects.toBeInstanceOf(OwnPublicationsClientError);
});
it('treats failures as unavailable and bounds body, abort and timeout without retrying', async () => {
  for (const response of [
    () => new Response('PRIVATE', { status: 503 }),
    () => new Response('x'.repeat(65537), { headers: { 'Content-Type': 'application/json' } }),
    () =>
      new Response('{}', {
        headers: { 'Content-Type': 'application/json', 'Content-Length': '65537' },
      }),
  ])
    await expect(
      createOwnPublicationsClient((async () => response()) as typeof fetch).read(),
    ).rejects.toThrow('自分の公開記録を確認できませんでした。');
  vi.useFakeTimers();
  const f = vi.fn(() => new Promise<Response>(() => {}));
  const pending = createOwnPublicationsClient(f as typeof fetch).read();
  const assertion = expect(pending).rejects.toBeInstanceOf(OwnPublicationsClientError);
  await vi.advanceTimersByTimeAsync(10000);
  await assertion;
  expect(f).toHaveBeenCalledTimes(1);
  const c = new AbortController();
  const old = createOwnPublicationsClient(f as typeof fetch).read(c.signal);
  const aborted = expect(old).rejects.toBeInstanceOf(OwnPublicationsClientError);
  c.abort();
  await aborted;
});
