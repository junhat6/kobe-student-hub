import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'fast-png';
const O = 'https://127.0.0.1:8788';
async function student(ctx: BrowserContext) {
  const r = await ctx.request.post('/__fixture/profile-session', { headers: { Origin: O } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { csrfToken: string }).csrfToken;
}
async function post(ctx: BrowserContext, path: string, csrf: string, data: unknown) {
  return ctx.request.post(path, {
    headers: { Origin: O, Authorization: 'Bearer csrf.' + csrf },
    data,
  });
}
async function seed(browser: Browser) {
  const contexts: BrowserContext[] = [];
  const author = await browser.newContext({ baseURL: O, ignoreHTTPSErrors: true });
  contexts.push(author);
  const csrf = await student(author);
  expect(
    (
      await post(author, '/api/private/profile', csrf, {
        displayName: '架空の作品制作者',
        department: '',
        yearLabel: '',
        bio: '',
        confirmPublic: true,
      })
    ).status(),
  ).toBe(201);
  const title = '運営が確認する作品-' + crypto.randomUUID().slice(0, 8),
    image = crypto.randomUUID();
  const d = await post(author, '/api/private/project-drafts', csrf, {
    title,
    description: '## 保存した作品',
    githubUrl: '',
    demoUrl: '',
  });
  expect(d.status()).toBe(201);
  const draft = ((await d.json()) as { id: string }).id;
  const png = Buffer.from(
    encode({
      width: 48,
      height: 32,
      channels: 4,
      data: Uint8Array.from({ length: 48 * 32 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : i % 3 === 0 ? 40 : 180,
      ),
    }),
  );
  expect(
    (
      await author.request.put('/api/private/media/projects/' + draft + '/' + image, {
        headers: {
          Origin: O,
          Authorization: 'Bearer csrf.' + csrf,
          'Content-Type': 'image/png',
          'If-Match': '"1"',
        },
        data: png,
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await author.request.put('/api/private/project-drafts/' + draft, {
        headers: { Origin: O, Authorization: 'Bearer csrf.' + csrf },
        data: {
          expectedVersion: 1,
          title,
          description:
            '## 保存した作品\n\n作品の説明と判断に必要な画像です。\n\n![保存版の画像](/api/media/' +
            image +
            ')',
          githubUrl: 'https://github.com/example/project',
          demoUrl: '',
        },
      })
    ).status(),
  ).toBe(200);
  const pub = await post(author, '/api/private/project-publications/' + draft, csrf, {
    expectedVersion: 2,
    confirmPublic: true,
    mediaIds: [image],
  });
  expect(pub.status()).toBe(201);
  const id = ((await pub.json()) as { projectId: string }).projectId;
  const reporter = await browser.newContext({ baseURL: O, ignoreHTTPSErrors: true });
  contexts.push(reporter);
  const token = await student(reporter);
  expect(
    (
      await post(reporter, '/api/private/project-reports/' + id, token, {
        reason: '架空の作品通報',
        detail: '運営だけが読む説明',
      })
    ).status(),
  ).toBe(201);
  return { contexts, author, id, title, image };
}
async function operator(page: Page, id: string) {
  expect(
    (await page.request.post('/__fixture/operator-session', { headers: { Origin: O } })).status(),
  ).toBe(200);
  await page.goto('/moderation?type=project&case=' + id);
  await expect(page.getByRole('region', { name: '運営判断', exact: true })).toBeVisible();
}
async function confirm(page: Page, action: string, reason: string) {
  const form = page.getByRole('region', { name: '運営判断', exact: true });
  await form.getByLabel('判断の理由 必須', { exact: true }).fill(reason);
  await form.getByRole('button', { name: action + 'を確認', exact: true }).click();
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: '確認した内容で' + action, exact: true }).click();
  await expect(page.getByRole('region', { name: '判断結果', exact: true })).toBeVisible();
}
async function reopen(page: Page, title: string) {
  await page.getByRole('button', { name: '一覧を再確認', exact: true }).click();
  await page.locator('.moderation-queue button').filter({ hasText: title }).click();
  await expect(page.getByRole('region', { name: '運営判断', exact: true })).toBeVisible();
}
test('ordinary project operator explicitly hides, inspects private images, restores and soft-deletes with owner reasons', async ({
  page,
  browser,
}, info) => {
  const target = await seed(browser);
  try {
    await operator(page, target.id);
    await expect(
      page.getByRole('heading', { name: '作品の通報と手動判断', exact: true }),
    ).toBeVisible();
    await confirm(page, '一時非公開', '画像と説明を確認するため、一時非公開にします。');
    expect((await target.author.request.get('/api/media/' + target.image)).status()).toBe(404);
    await reopen(page, target.title);
    await page.getByText('対象の作品情報を確認', { exact: true }).click();
    await expect(page.locator('.moderation-article img[src^="blob:"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath('project-hidden-review.png'), fullPage: true });
    await confirm(page, '復元', '作品の説明を確認し、公開してよいと判断しました。');
    await reopen(page, target.title);
    await confirm(page, '削除', '作品を公開表示から削除します。保存版の物理消去ではありません。');
    await expect(page.getByRole('region', { name: '判断結果', exact: true })).toContainText(
      '本人のお知らせ欄に説明を記録しました',
    );
    const notices = await (await target.author.request.get('/api/private/notifications')).json();
    expect(notices).toContainEqual(
      expect.objectContaining({
        contentId: target.id,
        kind: 'deleted',
        reason: '作品を公開表示から削除します。保存版の物理消去ではありません。',
      }),
    );
    await page.screenshot({
      path: info.outputPath('project-owner-reason-recorded.png'),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await Promise.all(target.contexts.map((c) => c.close()));
  }
});
test('unknown project judgment never resends automatically and pagehide/session change conceals private inputs', async ({
  page,
  browser,
}) => {
  const target = await seed(browser);
  try {
    await operator(page, target.id);
    let posts = 0;
    await page.route('**/api/private/project-moderation/review/*/decision', async (route) => {
      if (route.request().method() === 'POST') {
        posts++;
        await route.abort('failed');
      } else await route.continue();
    });
    await confirmUnknown();
    expect(posts).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect(page.getByRole('region', { name: '運営判断', exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
    await expect(page.getByLabel('判断の理由 必須', { exact: true })).not.toBeVisible();
    await expect(page.getByText('保持する作品の判断理由', { exact: true })).toBeVisible();
    expect(posts).toBe(1);
    await page.request.post('/__fixture/profile-session', { headers: { Origin: O } });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
    await expect(page.getByRole('region', { name: '運営判断', exact: true })).not.toBeVisible();
    await expect(page.getByText('保持する作品の判断理由', { exact: true })).not.toBeVisible();
    expect(posts).toBe(1);
    async function confirmUnknown() {
      const form = page.getByRole('region', { name: '運営判断', exact: true });
      await form.getByLabel('判断の理由 必須', { exact: true }).fill('保持する作品の判断理由');
      await form.getByRole('button', { name: '一時非公開を確認', exact: true }).click();
      await form.getByRole('checkbox').check();
      await form.getByRole('button', { name: '確認した内容で一時非公開', exact: true }).click();
      await expect(form).not.toBeVisible();
      await page.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
      await expect(form).toContainText('判断の結果を確認できません');
    }
  } finally {
    await Promise.all(target.contexts.map((c) => c.close()));
  }
});
