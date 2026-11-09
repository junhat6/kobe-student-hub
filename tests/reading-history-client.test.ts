import { describe, it, expect, vi } from 'vitest';
import { createReadingHistoryClient, ReadingHistoryClientError } from '../src/history/client';
const page = {
  entries: [
    {
      kind: 'article',
      contentId: 'learning-notes',
      title: 'Public title',
      isSample: true,
      lastViewedAt: 1800000000000,
    },
  ],
  enabled: true,
  nextOffset: null,
  capacity: 500,
};
const reply = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
describe('bounded explicit private history browser transport', () => {
  it('uses CSRF and no identity fields, explicit delete confirmation and canonical offset', async () => {
    const f = vi.fn<typeof fetch>();
    f.mockResolvedValueOnce(reply(page))
      .mockResolvedValueOnce(reply({ recorded: true }))
      .mockResolvedValueOnce(reply({ deleted: true }))
      .mockResolvedValueOnce(reply({ enabled: false }));
    const c = createReadingHistoryClient('a'.repeat(43), f);
    expect(await c.read(20)).toEqual(page);
    expect(f.mock.calls[0][0]).toBe('/api/private/reading-history?offset=20');
    await c.record({ kind: 'article', contentId: 'learning-notes' });
    await c.remove();
    await c.setEnabled(false);
    expect(f.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: 'Bearer csrf.' + 'a'.repeat(43),
    });
    expect(f.mock.calls[2][1]?.body).toBe('{"all":true}');
    expect(
      f.mock.calls.every(
        ([, i]) =>
          i?.cache === 'no-store' && i.credentials === 'same-origin' && i.redirect === 'error',
      ),
    ).toBe(true);
  });
  it('rejects malformed/oversized/private projections and does not accept response errors as an empty list', async () => {
    for (const v of [
      { ...page, email: 'private' },
      { ...page, entries: [...page.entries, ...page.entries] },
      { ...page, entries: [{ ...page.entries[0], title: 'x'.repeat(401) }] },
      { ...page, entries: [{ ...page.entries[0], body: 'private' }] },
      { ...page, entries: [{ ...page.entries[0], isSample: 'true' }] },
      { ...page, entries: [{ ...page.entries[0], isSample: null }] },
      { ...page, entries: [{ ...page.entries[0], title: null, isSample: true }] },
      { ...page, entries: [{ ...page.entries[0], contentId: '../../private' }] },
      { ...page, nextOffset: 501 },
    ])
      await expect(
        createReadingHistoryClient('', async () => reply(v)).read(),
      ).rejects.toBeInstanceOf(ReadingHistoryClientError);
    await expect(
      createReadingHistoryClient('', async () => new Response('no', { status: 401 })).read(),
    ).rejects.toBeInstanceOf(ReadingHistoryClientError);
    const huge = reply(page);
    huge.headers.set('Content-Length', '65537');
    await expect(createReadingHistoryClient('', async () => huge).read()).rejects.toBeInstanceOf(
      ReadingHistoryClientError,
    );
  });
  it('accepts a withdrawn reference only with redacted title and sample classification', async () => {
    const value = { ...page, entries: [{ ...page.entries[0], title: null, isSample: null }] };
    expect(await createReadingHistoryClient('', async () => reply(value)).read()).toEqual(value);
  });
  it('waits for EOF before validating or returning content and honors abort', async () => {
    let finish: () => void = () => {};
    const f = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode(JSON.stringify(page)));
              finish = () => c.close();
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    let done = false;
    const pending = createReadingHistoryClient('', f)
      .read()
      .then((v) => {
        done = true;
        return v;
      });
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    finish();
    expect(await pending).toEqual(page);
    const controller = new AbortController();
    controller.abort();
    await expect(
      createReadingHistoryClient('', f).read(0, controller.signal),
    ).rejects.toBeInstanceOf(ReadingHistoryClientError);
  });
});
