import { describe, expect, it, vi } from 'vitest';
import { createModerationClient } from '../src/editor/moderation-client';
const id = '00000000-0000-4000-8000-000000000001';
const notice = {
  id: 'report.' + id,
  contentId: id,
  title: 'Article',
  kind: 'temporarily_hidden',
  reason: 'Owner explanation',
  createdAt: 1800000000000,
};
const delivery = {
  outboxId: id,
  contentId: id,
  event: 'temporarily_hidden',
  reportCount: 3,
  createdAt: 1800000000000,
  state: 'pending',
  attempts: 0,
  retryCommandId: null,
};
describe('private notification DTO and transport', () => {
  it('accepts bounded owner notices and delivery state without identity/address/provider fields', async () => {
    const fetcher = vi.fn<typeof fetch>(async (path) =>
      Response.json(String(path).includes('moderation/') ? [delivery] : [notice]),
    );
    const client = createModerationClient(fetcher);
    expect(await client.ownNotifications()).toEqual([notice]);
    expect(await client.emailQueue()).toEqual([delivery]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/private/notifications',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }),
    );
  });
  it('rejects extra private fields, coercible enums and excessive lists instead of showing partial data', async () => {
    for (const value of [
      [{ ...notice, reporter: 'private' }],
      [{ ...notice, kind: ['deleted'] }],
      Array(21).fill(notice),
    ])
      await expect(
        createModerationClient(async () => Response.json(value)).ownNotifications(),
      ).rejects.toThrow();
    for (const value of [
      [{ ...delivery, to: 'private@example.invalid' }],
      [{ ...delivery, state: ['pending'] }],
      Array(21).fill(delivery),
    ])
      await expect(
        createModerationClient(async () => Response.json(value)).emailQueue(),
      ).rejects.toThrow();
  });
  it('sends a single explicit retry command with CSRF and validates its acknowledgement', async () => {
    const input = {
      retryCommandId: crypto.randomUUID(),
      expectedAttempts: 1,
      confirmRetry: true as const,
    };
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        ...delivery,
        state: 'ready',
        attempts: 1,
        retryCommandId: input.retryCommandId,
      }),
    );
    const client = createModerationClient(fetcher);
    await client.retryEmail(id, input, 'x'.repeat(43));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/private/moderation/notifications/' + id + '/retry',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
        headers: expect.objectContaining({ Authorization: 'Bearer csrf.' + 'x'.repeat(43) }),
      }),
    );
  });
  it('does not retry a failed acknowledgement automatically', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw Error('transport');
    });
    await expect(
      createModerationClient(fetcher).retryEmail(
        id,
        { retryCommandId: crypto.randomUUID(), expectedAttempts: 1, confirmRetry: true },
        'x'.repeat(43),
      ),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
