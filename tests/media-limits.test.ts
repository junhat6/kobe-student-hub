import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import * as limits from '../src/shared/media';

// Shrink the per-draft limit: every consumer must follow the constant instead of a literal 8.
vi.mock('../src/shared/media', async (original) => ({
  ...(await original<typeof import('../src/shared/media')>()),
  MEDIA_PER_DRAFT: 3,
}));

const ids = Array.from({ length: 4 }, (_, n) => `1111111${n}-1111-4111-8111-111111111111`);

it('keeps the shared constants equal to the values the media_assets_insert trigger enforces', async () => {
  const real = await vi.importActual<typeof import('../src/shared/media')>('../src/shared/media');
  const sql = readFileSync('migrations/0020_private_images.sql', 'utf8');
  const trigger = /CREATE TRIGGER media_assets_insert[\s\S]*?\nEND;/.exec(sql)?.[0] ?? '';
  const expected = [
    `(SELECT COUNT(*) FROM media_assets)>=${real.MEDIA_GLOBAL_COUNT}`,
    `+length(NEW.payload)>${real.MEDIA_GLOBAL_BYTES}`,
    `WHERE owner_account_id=NEW.owner_account_id)>=${real.MEDIA_OWNER_COUNT}`,
    `WHERE owner_account_id=NEW.owner_account_id)+length(NEW.payload)>${real.MEDIA_OWNER_BYTES}`,
    `project_draft_id=NEW.project_draft_id))>=${real.MEDIA_PER_DRAFT}`,
  ];
  for (const piece of expected) expect(trigger).toContain(piece);
  // Each refusal message names the limit with the same numbers.
  expect(real.MEDIA_LIMIT_MESSAGE.draft).toContain(`${real.MEDIA_PER_DRAFT}枚`);
  expect(real.MEDIA_LIMIT_MESSAGE.owner).toContain(
    `${real.MEDIA_OWNER_COUNT}枚・${real.MEDIA_OWNER_BYTES / 1048576} MiB`,
  );
});

it('moves the publication preview and the client list bound together with MEDIA_PER_DRAFT', async () => {
  expect(limits.MEDIA_PER_DRAFT).toBe(3);
  const { default: Preview } = await import('../src/editor/MediaPublicationPreview');
  const body = ids.map((id) => `![x](/api/media/${id})`).join('\n');
  const over = renderToStaticMarkup(
    createElement(Preview, { body, fetcher: fetch, scopeKey: 'k' }),
  );
  expect(over).toContain('公開できる画像は3枚までです。');
  const atLimit = renderToStaticMarkup(
    createElement(Preview, {
      body: ids
        .slice(0, 3)
        .map((id) => `/api/media/${id}`)
        .join(' '),
      fetcher: fetch,
      scopeKey: 'k',
    }),
  );
  expect(atLimit).not.toContain('role="alert"');

  const { createMediaClient } = await import('../src/editor/media-client');
  const receipt = (id: string) => ({ id, mime: 'image/png', width: 1, height: 1, bytes: 1 });
  const listing =
    (n: number): typeof fetch =>
    async () =>
      Response.json({ images: ids.slice(0, n).map(receipt) });
  await expect(
    createMediaClient('a'.repeat(43), listing(3)).list('articles', ids[0]),
  ).resolves.toHaveLength(3);
  await expect(
    createMediaClient('a'.repeat(43), listing(4)).list('articles', ids[0]),
  ).rejects.toThrow();
});

it('reads no literal media count in the UI and worker consumers', () => {
  for (const file of [
    'worker/media.ts',
    'src/editor/media-client.ts',
    'src/editor/MediaAttachments.tsx',
    'src/editor/MediaPublicationPreview.tsx',
    'src/editor/PublicationComposer.tsx',
    'src/editor/ProjectRegistration.tsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).toContain('MEDIA_PER_DRAFT');
    expect(source, file).not.toMatch(/LIMIT 8\b|(?:<=|>=|>|<) ?8\b|8枚/);
  }
});

it('turns a 409 limit refusal into a reasoned error and anything else into the generic one', async () => {
  const { createMediaClient, MediaLimitError, MediaClientError } =
    await import('../src/editor/media-client');
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const send = (body: unknown) =>
    createMediaClient('a'.repeat(43), async () => Response.json(body, { status: 409 })).upload(
      'articles',
      ids[0],
      1,
      ids[1],
      blob,
    );
  for (const limit of ['draft', 'owner', 'site'] as const) {
    const error = await send({ error: 'media_limit', limit }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaLimitError);
    expect((error as Error).message).toBe(limits.MEDIA_LIMIT_MESSAGE[limit]);
  }
  for (const body of [
    { error: 'media_limit', limit: 'disk' },
    { error: 'media_limit', limit: 'draft', detail: 'x' },
    { error: 'media_unavailable' },
  ])
    await expect(send(body)).rejects.toBeInstanceOf(MediaClientError);
});
