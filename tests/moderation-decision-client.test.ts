import { describe, it, expect, vi } from 'vitest';
import {
  createModerationClient,
  validDecisionInput,
  ModerationClientError,
} from '../src/editor/moderation-client';
import { parseModerationOperators } from '../worker/moderation-http';
const id = '11111111-1111-4111-8111-111111111111',
  csrf = 'c'.repeat(43);
const input = {
  decisionId: '22222222-2222-4222-8222-222222222222',
  expectedRound: 1,
  expectedVersion: 3,
  action: 'restore' as const,
  reason: 'Explicit reason',
};
const receipt = {
  decisionId: input.decisionId,
  contentId: id,
  action: 'restore',
  reason: input.reason,
  resultStatus: 'published',
  resultRound: 2,
  resultVersion: 4,
  notification: 'pending',
};
describe('operator decision contracts', () => {
  it('reads exact own receipt with GET and sends one explicitly confirmed command with CSRF', async () => {
    const calls: { path: unknown; init?: RequestInit }[] = [];
    const client = createModerationClient((async (path, init) => {
      calls.push({ path, init });
      return Response.json(receipt);
    }) as typeof fetch);
    expect(await client.decide(id, input, csrf, true)).toEqual(receipt);
    expect(await client.readDecision(id, input)).toEqual(receipt);
    expect(calls.map(({ path, init }) => [path, init?.method])).toEqual([
      ['/api/private/moderation/cases/' + id + '/decision', 'POST'],
      ['/api/private/moderation/cases/' + id + '/decisions/' + input.decisionId, 'GET'],
    ]);
    expect(JSON.parse(calls[0].init?.body as string)).toEqual(input);
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
    expect(new Headers(calls[1].init?.headers).has('Authorization')).toBe(false);
  });
  it('rejects wrong actor fields, stale/wrong receipts and claimed sent notifications', async () => {
    for (const value of [
      { ...receipt, operator: 'private' },
      { ...receipt, contentId: 'other' },
      { ...receipt, reason: 'other' },
      { ...receipt, decisionId: crypto.randomUUID() },
      { ...receipt, resultVersion: 5 },
      { ...receipt, notification: 'sent' },
    ]) {
      const client = createModerationClient((async () => Response.json(value)) as typeof fetch);
      await expect(client.readDecision(id, input)).rejects.toBeInstanceOf(ModerationClientError);
    }
    const fetcher = vi.fn();
    const client = createModerationClient(fetcher as typeof fetch);
    await expect(client.decide(id, input, csrf, false)).rejects.toBeInstanceOf(
      ModerationClientError,
    );
    for (const bad of [
      { ...input, reason: ' ' },
      { ...input, reason: '\ud800' },
      { ...input, reason: '😀'.repeat(1001) },
      { ...input, operator: 'operator' },
    ])
      expect(validDecisionInput(bad)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never automatically retries a failed command or discloses response error contents', async () => {
    const fetcher = vi.fn(async () => new Response('PRIVATE_FAILURE', { status: 503 }));
    await expect(createModerationClient(fetcher).decide(id, input, csrf, true)).rejects.toThrow(
      '確認結果を取得できませんでした。',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('admits only the bounded server JSON allowlist and defaults invalid or absent configuration to none', () => {
    for (const raw of [
      undefined,
      '',
      'null',
      '{}',
      '["operator@example.invalid"]',
      '["operator","operator"]',
      JSON.stringify(Array.from({ length: 11 }, (_, n) => 'operator-' + n)),
      'x'.repeat(2049),
    ])
      expect(parseModerationOperators({ MODERATION_OPERATOR_ACCOUNT_IDS: raw })).toEqual([]);
    const ids = parseModerationOperators({
      MODERATION_OPERATOR_ACCOUNT_IDS: '["server-account-1"]',
    });
    expect(ids).toEqual(['server-account-1']);
    expect(Object.isFrozen(ids)).toBe(true);
  });
});
