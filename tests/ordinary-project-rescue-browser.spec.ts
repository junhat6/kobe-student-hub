import { completeGoogleFormPost, fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { createProfileOnAccount, ensureProfileByApi } from './helpers/profile';

// C20 / #171: an expired session keeps unsaved project input in page memory only, and
// gives it back to the same project only after the server opens it for the new session.
const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const projectTitle = (page: Page) => page.getByLabel('作品タイトル', { exact: true });
const description = (page: Page) =>
  page.getByLabel('作品説明（プレーンテキスト）', { exact: true });
const technologies = (page: Page) =>
  page.getByLabel('使った技術（任意・読点かカンマ区切り・100文字まで）', { exact: true });
const rescueBox = (page: Page) =>
  page.getByRole('textbox', { name: '保存できなかった作品の入力の内容', exact: true });
const reopen = (page: Page) =>
  page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true });
const inSync = (page: Page) =>
  page.getByText('手元の入力と保存版は一致しています。', { exact: false });

async function register(page: Page, info: TestInfo, suffix = 'a') {
  const actor =
    'fictional-project-rescue-' + info.project.name + '-' + suffix + '-' + Date.now().toString(36);
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state')!,
      nonce = url.searchParams.get('nonce')!;
    expect(
      (
        await page
          .context()
          .request.get(ORIGIN + '/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.goto('/signup');
  await page.getByLabel('入学', { exact: true }).selectOption('2026');
  await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await createProfileOnAccount(page);
  await page.unroute(provider);
  await page.goto('/works/new');
  await expect(projectTitle(page)).toBeEditable();
  return actor;
}
// Signs the same browser context in again (as `actor`) without touching the observed page.
async function signInAgain(context: BrowserContext, actor = 'fictional-browser-b') {
  const headers = { Origin: ORIGIN };
  const boot = await context.request.post(ORIGIN + '/api/auth/bootstrap', { headers });
  expect([204, 409]).toContain(boot.status());
  const command = await context.request.post(ORIGIN + '/api/auth/command?action=login', {
    headers,
  });
  expect(command.status()).toBe(200);
  const proof = await command.json();
  const started = await context.request.post(ORIGIN + '/api/auth/start', {
    headers: { ...headers, Authorization: 'Bearer command.' + proof.commandToken },
  });
  expect(started.status()).toBe(200);
  const url = new URL((await started.json()).authorizationUrl),
    state = url.searchParams.get('state')!,
    nonce = url.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        ORIGIN + '/__control/token?' + new URLSearchParams({ state, nonce, actor }),
      )
    ).status(),
  ).toBe(200);
  expect(
    (await completeGoogleFormPost(context.request, ORIGIN, { state, code: state })).status(),
  ).toBe(303);
  await ensureProfileByApi(context.request, ORIGIN, '架空の別アカウント');
}
async function expire(context: BrowserContext) {
  expect((await context.request.get(ORIGIN + '/__control/expire')).status()).toBe(200);
}
async function expectRescued(page: Page, text: string) {
  await expect(
    page.getByRole('heading', { name: '保存できなかった作品の入力', exact: true }),
  ).toBeVisible();
  await expect(rescueBox(page)).toHaveValue(text);
  await expect(page.getByRole('link', { name: '新しいタブでログインし直す' })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(page.getByRole('button', { name: '入力をコピー', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'この入力を破棄', exact: true })).toBeVisible();
  await expect(projectTitle(page)).toBeHidden();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
}
async function image(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, scale: 'css' });
}
async function expireWhileEditingSaved(page: Page, context: BrowserContext) {
  await projectTitle(page).fill('期限切れの作品');
  await description(page).fill('最初の説明');
  await expect(inSync(page)).toBeVisible();
  await expire(context);
  await technologies(page).fill('React、TypeScript');
  await description(page).fill('最初の説明\n\n期限切れ後に書いた続き');
  await expectRescued(
    page,
    '期限切れの作品\n\n使った技術：React、TypeScript\n\n最初の説明\n\n期限切れ後に書いた続き',
  );
}

test('expired project input returns to the same project after the same account signs in', async ({
  page,
  context,
}, info) => {
  const actor = await register(page, info);
  await expireWhileEditingSaved(page, context);
  await image(page, info, 'project-expired-rescue');
  await signInAgain(context, actor);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await reopen(page).click();
  await expect(description(page)).toHaveValue('最初の説明\n\n期限切れ後に書いた続き');
  await expect(technologies(page)).toHaveValue('React、TypeScript');
  await expect(rescueBox(page)).toHaveCount(0);
  await expect(inSync(page)).toBeVisible();
  await image(page, info, 'project-rescue-restored');
  await page.reload();
  await page.getByRole('button', { name: '続きを編集：期限切れの作品', exact: true }).click();
  await expect(description(page)).toHaveValue('最初の説明\n\n期限切れ後に書いた続き');
  await expect(technologies(page)).toHaveValue('React、TypeScript');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('kept project input is never applied to another account and can be discarded', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  await expireWhileEditingSaved(page, context);
  await signInAgain(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await reopen(page).click();
  await expect(page.getByText(/このアカウントの作品として開けませんでした/)).toBeVisible();
  await expect(projectTitle(page)).toHaveValue('');
  await expect(description(page)).toHaveValue('');
  await expect(
    page.getByRole('button', { name: '続きを編集：期限切れの作品', exact: true }),
  ).toHaveCount(0);
  await expect(rescueBox(page)).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'この入力を破棄', exact: true }).click();
  await expect(rescueBox(page)).toHaveCount(0);
});

test('a never-saved project is kept for copying but not applied after signing in', async ({
  page,
  context,
}, info) => {
  const actor = await register(page, info);
  await expire(context);
  await projectTitle(page).fill('保存前の作品');
  await description(page).fill('まだ一度も保存していない説明');
  await expectRescued(page, '保存前の作品\n\nまだ一度も保存していない説明');
  await expect(page.getByText(/保存前の新しい作品だったため/)).toBeVisible();
  await signInAgain(context, actor);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/保存前の新しい作品の入力は自動では戻しません/)).toBeVisible();
  await reopen(page).click();
  await expect(projectTitle(page)).toHaveValue('');
  await expect(rescueBox(page)).toHaveValue('保存前の作品\n\nまだ一度も保存していない説明');
  await image(page, info, 'project-never-saved-rescue');
});
