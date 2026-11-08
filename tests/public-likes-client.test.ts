import { it, expect, vi } from 'vitest';
import { createPublicLikesClient, PublicLikesClientError } from '../src/editor/public-likes-client';
const profile = {
  id: 'profile-fictional',
  name: '架空の人',
  department: 'IT',
  year: '2年',
  initials: '架',
};
const entry = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '架空の記事',
  summary: '概要',
  tags: [],
  audience: '初めて',
  prerequisite: '基本',
  outcome: '試せる',
  updatedAt: '2026-11-04',
  minutes: 5,
};
it('reads a confirmed profile empty list anonymously and preserves server like order', async () => {
  const f = vi.fn(async () => Response.json({ profile, entries: [] }));
  expect(await createPublicLikesClient(f as typeof fetch).read(profile.id)).toEqual({
    profile,
    entries: [],
  });
  expect(f).toHaveBeenCalledWith(
    '/__lab/likes/' + profile.id,
    expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error' }),
  );
  const entries = [{ ...entry, id: '22222222-2222-4222-8222-222222222222' }, entry];
  expect(
    (
      await createPublicLikesClient((async () =>
        Response.json({ profile, entries })) as typeof fetch).read(profile.id)
    ).entries,
  ).toEqual(entries);
});
it('rejects identity mismatch, private fields, duplicate/oversize lists and unavailable results rather than a false empty', async () => {
  for (const value of [
    { profile: { ...profile, id: 'other' }, entries: [] },
    { profile: { ...profile, bio: 'not part of DTO' }, entries: [] },
    { profile, entries: [{ ...entry, likedAt: 123 }] },
    { profile, entries: [{ ...entry, body: 'PRIVATE' }] },
    { profile, entries: [entry, entry] },
    { profile, entries: Array(21).fill(entry) },
    { profile: { ...profile, name: '\ud800' }, entries: [] },
    {},
  ])
    await expect(
      createPublicLikesClient((async () => Response.json(value)) as typeof fetch).read(profile.id),
    ).rejects.toBeInstanceOf(PublicLikesClientError);
  await expect(
    createPublicLikesClient(
      (async () => new Response('PRIVATE', { status: 404 })) as typeof fetch,
    ).read(profile.id),
  ).rejects.toThrow('公開いいねを確認できませんでした。');
});
it('never sends unsafe profile targets', async () => {
  const f = vi.fn();
  for (const id of ['../private', 'https://foreign.invalid', 'a?x=y', 'a'.repeat(129)])
    await expect(createPublicLikesClient(f as typeof fetch).read(id)).rejects.toBeInstanceOf(
      PublicLikesClientError,
    );
  expect(f).not.toHaveBeenCalled();
});
