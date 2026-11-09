import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { completeGoogleFormPost } from './helpers/google-form-post';
import type { OwnPublicProfile } from '../worker/public-profile';
import type { RelatedDiscovery } from '../src/community/discovery-types';
import type { ReadingHistoryPage } from '../src/history/types';

const ORIGIN = process.env.KSH_PROFILE_BROWSER_ORIGIN ?? 'https://127.0.0.1:8790';
type Owner = { context: BrowserContext; csrf: string; profile: OwnPublicProfile };
async function owner(
  browser: Browser,
  label: string,
  viewport?: { width: number; height: number },
): Promise<Owner> {
  const context = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true, viewport });
  const headers = { Origin: ORIGIN };
  expect((await context.request.post('/api/auth/bootstrap', { headers })).status()).toBe(204);
  const command = await context.request.post('/api/auth/command?action=self-registration', {
    headers,
  });
  expect(command.status()).toBe(200);
  const start = await context.request.post('/api/auth/register', {
    headers: { ...headers, Authorization: 'Bearer command.' + (await command.json()).commandToken },
    data: { admissionYear: 2026, graduationYear: 2028 },
  });
  expect(start.status()).toBe(200);
  const authorization = new URL((await start.json()).authorizationUrl);
  const state = authorization.searchParams.get('state')!,
    nonce = authorization.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        '/__control/token?' +
          new URLSearchParams({
            state,
            nonce,
            actor: 'fictional-integration-' + crypto.randomUUID(),
          }),
      )
    ).status(),
  ).toBe(200);
  expect(
    (await completeGoogleFormPost(context.request, ORIGIN, { state, code: state })).status(),
  ).toBe(303);
  const session = await context.request.get('/api/private/session');
  expect(session.status()).toBe(200);
  const csrf = (await session.json()).csrfToken;
  const response = await context.request.post('/api/private/profile', {
    headers: { ...headers, Authorization: 'Bearer csrf.' + csrf },
    data: { displayName: label, department: '', yearLabel: '', bio: '', confirmPublic: true },
  });
  expect(response.status()).toBe(201);
  return { context, csrf, profile: (await response.json()).profile };
}
async function write(actor: Owner, path: string, data: object, method = 'POST', expected = 201) {
  const response = await actor.context.request.fetch(path, {
    method,
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + actor.csrf },
    data,
  });
  expect(response.status()).toBe(expected);
  return response.json();
}
const metadata = (tag: string) => ({
  confirmPublic: true,
  summary: '架空の条件と判断の記録',
  tags: [tag],
  minutes: 1,
  audience: '',
  prerequisite: '',
  outcome: '',
});
async function article(actor: Owner, title: string, tag: string) {
  const draft = await write(actor, '/api/private/drafts', {
    title,
    body: '## 架空の本文\n\n明示して公開する保存版です。',
  });
  const publication = await write(actor, '/api/private/publications/' + draft.id, {
    ...metadata(tag),
    expectedVersion: draft.version,
  });
  return {
    id: publication.contentId as string,
    draftId: draft.id as string,
    version: draft.version as number,
  };
}
async function revise(
  actor: Owner,
  previous: Awaited<ReturnType<typeof article>>,
  title: string,
  tag: string,
) {
  const draft = await write(
    actor,
    '/api/private/drafts/' + previous.draftId,
    {
      title,
      body: '## 改稿した架空の本文\n\n判断の条件を更新しました。',
      expectedVersion: previous.version,
    },
    'PATCH',
    200,
  );
  const publication = await write(actor, '/api/private/publications/' + previous.draftId, {
    ...metadata(tag),
    expectedVersion: draft.version,
    expectedPublicationVersion: previous.version,
  });
  expect(publication.contentId).toBe(previous.id);
  return { ...previous, version: draft.version as number };
}
async function related(context: BrowserContext, id: string): Promise<RelatedDiscovery> {
  const response = await context.request.get('/api/discovery/articles/' + id);
  expect(response.status()).toBe(200);
  return response.json();
}
test('article corrections, profile edits, related reading and private history stay consistent through withdrawal', async ({
  browser,
  page,
}, info) => {
  const key = info.project.name + '-' + Date.now().toString(36),
    tagA = '旧-' + Date.now().toString(36) + '-' + info.project.name.slice(-5),
    tagB = '新-' + Date.now().toString(36) + '-' + info.project.name.slice(-5);
  const actor = await owner(browser, '架空の更新前作者-' + key, page.viewportSize() ?? undefined);
  try {
    let source = await article(actor, '更新前の制作ノート-' + key, tagA);
    let old = await article(actor, '旧条件の関連記事-' + key, tagA);
    const next = await article(actor, '新条件の関連記事-' + key, tagB);
    expect(
      (await related(page.context(), source.id)).articles.map((card) => card.entry.id),
    ).toEqual([old.id]);
    const title = '改稿後の制作ノート-' + key;
    source = await revise(actor, source, title, tagB);
    expect(
      (await related(page.context(), source.id)).articles.map((card) => card.entry.id),
    ).toEqual([next.id]);
    old = await revise(actor, old, 'タグを訂正した関連記事-' + key, tagB);
    expect(
      new Set((await related(page.context(), source.id)).articles.map((card) => card.entry.id)),
    ).toEqual(new Set([next.id, old.id]));

    const name = '更新した架空の作者-' + key;
    const update = await write(
      actor,
      '/api/private/profile',
      {
        displayName: name,
        department: '制作コース',
        yearLabel: '本人の表示',
        bio: '自分で確認した公開紹介',
        confirmPublic: true,
        expectedProfile: actor.profile,
      },
      'PATCH',
      200,
    );
    expect(update.profile.id).toBe(actor.profile.id);
    expect(
      (await related(page.context(), source.id)).articles.every(
        (card) => card.author.id === actor.profile.id && card.author.name === name,
      ),
    ).toBe(true);
    await page.goto('/articles/' + source.id);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.locator('.detail-author .author')).toContainText(name);
    const region = page.getByRole('region', { name: '関連する記事・作品', exact: true });
    await expect(
      region.getByRole('link', { name: 'タグを訂正した関連記事-' + key, exact: true }),
    ).toBeVisible();
    await expect(region).toContainText(name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('integrated-revision-profile-related.png'),
      fullPage: true,
    });

    const reader = await actor.context.newPage();
    const recorded = reader.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/private/reading-history' &&
        r.request().method() === 'PUT' &&
        r.status() === 200,
    );
    await reader.goto('/articles/' + source.id);
    expect(await (await recorded).json()).toEqual({ recorded: true });
    const history = await actor.context.request.get('/api/private/reading-history');
    expect(history.status()).toBe(200);
    expect(
      ((await history.json()) as ReadingHistoryPage).entries.find(
        (row) => row.contentId === source.id,
      ),
    ).toMatchObject({ title, isSample: false });
    await reader.goto('/history');
    const panel = reader.getByRole('region', { name: '自分の閲覧履歴', exact: true });
    await expect(panel.getByRole('link', { name: title, exact: true })).toBeVisible();
    expect((await page.request.get('/api/private/reading-history')).status()).toBe(401);

    expect(
      (await related(page.context(), next.id)).articles.some((card) => card.entry.id === source.id),
    ).toBe(true);
    await write(
      actor,
      '/api/private/publication-stops/article/' + source.id,
      { expectedSourceVersion: source.version, confirmStop: true },
      'POST',
      200,
    );
    const withdrawn = await actor.context.request.get('/api/private/reading-history');
    expect(withdrawn.status()).toBe(200);
    expect(
      ((await withdrawn.json()) as ReadingHistoryPage).entries.find(
        (row) => row.contentId === source.id,
      ),
    ).toMatchObject({ title: null, isSample: null });
    expect(
      (await related(page.context(), next.id)).articles.some((card) => card.entry.id === source.id),
    ).toBe(false);
    expect((await page.request.get('/api/discovery/articles/' + source.id)).status()).toBe(404);
    await panel.getByRole('button', { name: '履歴を再読み込み', exact: true }).click();
    await expect(panel.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    await expect(
      panel.getByRole('heading', { name: '現在は公開されていません', exact: true }),
    ).toBeVisible();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('integrated-withdrawal-history-redacted.png'),
      fullPage: true,
    });
  } finally {
    await actor.context.close();
  }
});
