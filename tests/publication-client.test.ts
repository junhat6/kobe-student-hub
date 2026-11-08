import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  canonicalTags,
  checkedMetadata,
  createPublicationClient,
  matchesPublication,
  PublicationClientError,
  type PublicationAttempt,
  type PublicationReceipt,
} from '../src/editor/publication-client';
const draftId = '11111111-1111-4111-8111-111111111111',
  contentId = '22222222-2222-4222-8222-222222222222';
const metadata = {
  summary: '記事の概要',
  tags: ['Git', '学び'],
  minutes: 5,
  audience: '初めて試す人',
  prerequisite: '不要',
  outcome: '手元で試せる',
};
const attempt: PublicationAttempt = {
  draft: {
    id: draftId,
    title: '保存した記事',
    body: '# 内容',
    version: 1,
    updatedAt: 1800000000000,
  },
  metadata,
  author: {
    id: 'profile-33333333-3333-4333-8333-333333333333',
    displayName: '入力した名前',
    department: 'IT',
    yearLabel: '2年',
    bio: '本人入力',
    initials: '入',
  },
};
const receipt: PublicationReceipt = {
  contentId,
  sourceVersion: 1,
  entry: {
    id: contentId,
    kind: 'article',
    title: attempt.draft.title,
    body: attempt.draft.body,
    ...metadata,
    authorId: attempt.author.id,
    updatedAt: '2026-11-04',
    relatedIds: [],
  },
  author: {
    id: attempt.author.id,
    name: attempt.author.displayName,
    department: 'IT',
    year: '2年',
    bio: '本人入力',
    initials: '入',
  },
};
afterEach(() => vi.useRealTimers());
describe('explicit saved-version publication client', () => {
  it('normalizes visible tags and rejects duplicates, controls and invalid metadata', () => {
    expect(canonicalTags([' 学び ', 'Ｇｉｔ'])).toEqual(['Git', '学び']);
    for (const tags of [['Ａ', 'A'], ['x'.repeat(25)], ['a\u200b'], Array(6).fill('a')])
      expect(canonicalTags(tags)).toBeNull();
    for (const value of [
      { ...metadata, summary: 'x'.repeat(301) },
      { ...metadata, minutes: 0 },
      { ...metadata, minutes: 1.5 },
      { ...metadata, outcome: '\0' },
      { ...metadata, audience: '\ud800' },
      { ...metadata, ownerId: 'private' },
    ])
      expect(checkedMetadata(value)).toBeNull();
  });
  it('posts only metadata/version/confirmation with request-bound CSRF, never draft content or identity', async () => {
    let path: unknown, init: RequestInit | undefined;
    const client = createPublicationClient('f'.repeat(43), (async (p, i) => {
      path = p;
      init = i;
      return Response.json({ contentId }, { status: 201 });
    }) as typeof fetch);
    expect(await client.publish(draftId, 1, metadata, true)).toBe(contentId);
    expect(path).toBe('/api/private/publications/' + draftId);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer csrf.' + 'f'.repeat(43));
    expect(JSON.parse(init?.body as string)).toEqual({
      expectedVersion: 1,
      confirmPublic: true,
      ...metadata,
    });
    for (const key of ['title', 'body', 'authorId', 'ownerId', 'publicProfileId'])
      expect(JSON.parse(init?.body as string)).not.toHaveProperty(key);
  });
  it('does not send an unconfirmed, invalid or misrouted mutation', async () => {
    const fetcher = vi.fn();
    const client = createPublicationClient('f'.repeat(43), fetcher as typeof fetch);
    await expect(client.publish(draftId, 1, metadata, false)).rejects.toBeInstanceOf(
      PublicationClientError,
    );
    await expect(client.publish(draftId, 0, metadata, true)).rejects.toBeInstanceOf(
      PublicationClientError,
    );
    await expect(client.publish('../private', 1, metadata, true)).rejects.toBeInstanceOf(
      PublicationClientError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('distinguishes explicit absence from unavailable responses and validates complete private receipts', async () => {
    expect(
      await createPublicationClient('', (async () =>
        Response.json({ publication: null })) as typeof fetch).read(draftId),
    ).toBeNull();
    expect(
      await createPublicationClient('', (async () =>
        Response.json({ publication: receipt })) as typeof fetch).read(draftId),
    ).toEqual(receipt);
    for (const result of [
      { publication: { ...receipt, owner: 'private' } },
      { publication: { ...receipt, contentId: draftId } },
      { publication: { ...receipt, author: { ...receipt.author, email: 'private' } } },
      { publication: { ...receipt, entry: { ...receipt.entry, privateDraftId: draftId } } },
    ])
      await expect(
        createPublicationClient('', (async () => Response.json(result)) as typeof fetch).read(
          draftId,
        ),
      ).rejects.toBeInstanceOf(PublicationClientError);
    await expect(
      createPublicationClient('', (async () =>
        Response.json({ error: 'PRIVATE_REASON' }, { status: 404 })) as typeof fetch).read(draftId),
    ).rejects.toThrow('記事の公開状態を確認できませんでした。');
  });
  it('matches the captured saved source, canonical metadata and explicit author rather than later private edits', () => {
    expect(matchesPublication(receipt, attempt)).toBe(true);
    expect(
      matchesPublication(receipt, {
        ...attempt,
        draft: { ...attempt.draft, version: 2, body: '新しい下書き' },
      }),
    ).toBe(false);
    expect(
      matchesPublication(receipt, { ...attempt, metadata: { ...metadata, summary: '別の概要' } }),
    ).toBe(false);
    expect(
      matchesPublication(receipt, {
        ...attempt,
        author: { ...attempt.author, bio: '変更された紹介' },
      }),
    ).toBe(false);
  });
  it('reads the anonymous article without cookies or CSRF and rejects mismatched content', async () => {
    let init: RequestInit | undefined;
    const article = { entry: receipt.entry, author: receipt.author };
    expect(
      await createPublicationClient('private-csrf', (async (_, i) => {
        init = i;
        return Response.json(article);
      }) as typeof fetch).readArticle(contentId),
    ).toEqual(article);
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    await expect(
      createPublicationClient('', (async () => Response.json(article)) as typeof fetch).readArticle(
        draftId,
      ),
    ).rejects.toBeInstanceOf(PublicationClientError);
  });
  it('bounds malformed and oversized responses without reflecting server data', async () => {
    for (const make of [
      () => new Response('PRIVATE_SQL', { status: 503 }),
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      () => new Response('x'.repeat(2097153), { headers: { 'Content-Type': 'application/json' } }),
      () =>
        new Response('{}', {
          headers: { 'Content-Type': 'application/json', 'Content-Length': '2097153' },
        }),
    ])
      await expect(
        createPublicationClient('', (async () => make()) as typeof fetch).read(draftId),
      ).rejects.toBeInstanceOf(PublicationClientError);
  });
  it('never retries an uncertain publication or accepts its late acknowledgement', async () => {
    vi.useFakeTimers();
    let release: (r: Response) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const pending = createPublicationClient('f'.repeat(43), fetcher as typeof fetch).publish(
      draftId,
      1,
      metadata,
      true,
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(PublicationClientError);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json({ contentId }, { status: 201 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
