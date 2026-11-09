import { describe, it, expect } from 'vitest';
import {
  createOrdinaryDiscoveryClient,
  validOrdinaryDiscovery,
  validRelatedDiscovery,
} from '../src/community/discovery-client';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const card = {
  entry: {
    id: other,
    title: 'AIを比較した記録',
    summary: '比較条件と結果',
    tags: ['AI'],
    audience: '',
    prerequisite: '',
    outcome: '',
    updatedAt: '2026-11-09',
    minutes: 2,
  },
  author: { id: 'fictional-profile', name: '架空投稿者', department: '', year: '', initials: '架' },
};
describe('ordinary discovery anonymous transport and strict public contracts', () => {
  it('reads bounded anonymous JSON without bootstrap, credentials or visitor context', async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const client = createOrdinaryDiscoveryClient((async (path, init) => {
      calls.push({ path: String(path), init });
      return Response.json({ recent: [card], popular: [{ ...card, likeCount: 2 }] });
    }) as typeof fetch);
    expect((await client.home()).popular[0].likeCount).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/discovery');
    expect(calls[0].init?.credentials).toBe('omit');
    expect(calls[0].init?.redirect).toBe('error');
    expect(calls[0].init?.cache).toBe('no-store');
    expect(calls[0].init?.headers).toEqual({ Accept: 'application/json' });
  });
  it('accepts genuine empty and refuses private or unexpected fields', () => {
    expect(validOrdinaryDiscovery({ recent: [], popular: [] })).toBe(true);
    for (const value of [
      { recent: [{ ...card, email: 'private@example.invalid' }], popular: [] },
      { recent: [{ ...card, entry: { ...card.entry, body: 'private' } }], popular: [] },
      { recent: [], popular: [], history: [] },
    ])
      expect(validOrdinaryDiscovery(value)).toBe(false);
  });
  it('rejects zero/fractional/unsafe counts, duplicate articles and malformed order', () => {
    for (const count of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, '2'])
      expect(validOrdinaryDiscovery({ recent: [], popular: [{ ...card, likeCount: count }] })).toBe(
        false,
      );
    expect(validOrdinaryDiscovery({ recent: [card, card], popular: [] })).toBe(false);
    expect(
      validOrdinaryDiscovery({
        recent: [],
        popular: [
          { ...card, likeCount: 1 },
          { ...card, entry: { ...card.entry, id }, likeCount: 2 },
        ],
      }),
    ).toBe(false);
  });
  it('requires a matching article tag, excludes the source and refuses duplicate related IDs', () => {
    const value = { articles: [{ ...card, matchingTag: 'AI' }], projects: [] };
    expect(validRelatedDiscovery(value, id)).toBe(true);
    expect(validRelatedDiscovery(value, other)).toBe(false);
    expect(
      validRelatedDiscovery({ articles: [{ ...card, matchingTag: 'SQL' }], projects: [] }, id),
    ).toBe(false);
    expect(
      validRelatedDiscovery({ articles: [value.articles[0], value.articles[0]], projects: [] }, id),
    ).toBe(false);
  });
  it('rejects malformed endpoint IDs before network and provides retryable read failure', async () => {
    let calls = 0;
    const client = createOrdinaryDiscoveryClient((async () => {
      calls++;
      return Response.json({ error: 'unavailable' }, { status: 503 });
    }) as typeof fetch);
    await expect(client.related('../private')).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(client.home()).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
