import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { encode as pngEncode } from 'fast-png';
import jpeg from 'jpeg-js';
import { readFileSync } from 'node:fs';
const O = 'https://127.0.0.1:8790';
function pixels(width: number, height: number) {
  return Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (Math.floor(i / 4) % width) % 80 < 4 ? 35 : 235,
  );
}
const screen = Buffer.from(
  pngEncode({ width: 1000, height: 800, channels: 4, data: pixels(1000, 800) }),
);
const photo = Buffer.from(
  jpeg.encode({ width: 1200, height: 800, data: pixels(1200, 800) }, 75).data,
);
async function register(page: Page, info: TestInfo) {
  const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    actor = `fictional-media-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const u = new URL(route.request().url()),
      state = u.searchParams.get('state')!,
      nonce = u.searchParams.get('nonce')!;
    expect(u.searchParams.get('response_mode')).toBe('form_post');
    expect(
      (
        await page.request.get('/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, O, { state, code: state });
  });
  await page.goto('/signup');
  await page.getByLabel('入学年度 必須', { exact: true }).fill('2026');
  await page.getByLabel('卒業予定年度 必須', { exact: true }).fill('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(O + '/account');
  await page.unroute(provider);
  await page.getByText('公開プロフィールを準備する', { exact: true }).click();
  const profile = page.getByRole('region', { name: '公開プロフィールの初回作成' });
  await profile.getByLabel('表示名 必須').fill('架空の画像投稿者');
  await profile.getByRole('checkbox').check();
  await profile
    .getByRole('button', { name: '確認した内容でプロフィールを作成', exact: true })
    .click();
  await expect(profile.locator('.profile-setup-status')).toHaveText(
    '公開プロフィールを作成しました。',
  );
}
async function article(page: Page, info: TestInfo) {
  await register(page, info);
  await page.getByRole('link', { name: '下書きを書く・再開する' }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('架空の画像付き記事');
  await page
    .getByLabel('Markdown本文', { exact: true })
    .fill('## 実験の画面\n\n保存した画面を説明します。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
}
async function attach(page: Page, mime: 'image/png' | 'image/jpeg', buffer: Buffer) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'PUT' && new URL(r.url()).pathname.startsWith('/api/private/media/'),
  );
  await page.getByLabel('下書きへ画像を追加', { exact: true }).setInputFiles({
    name: mime === 'image/png' ? 'synthetic-screen.png' : 'synthetic-photo.jpg',
    mimeType: mime,
    buffer,
  });
  const r = await response;
  expect(r.status()).toBe(201);
  const receipt = (await r.json()) as { id: string; width: number; height: number };
  await expect(page.locator('.media-attachments img[src^="blob:"]')).toBeVisible();
  return receipt;
}
test('real static CSP permits guarded private Blob images and explicit nocookie frames only after consent', async ({
  page,
}, info) => {
  await article(page, info);
  const headers = (await page.request.get('/drafts')).headers();
  const csp = readFileSync('.generation-preview/_headers', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('  Content-Security-Policy: '))!
    .slice('  Content-Security-Policy: '.length);
  expect(headers['content-security-policy']).toBe(csp);
  await page.evaluate(() => {
    const directives: string[] = [];
    Object.defineProperty(window, '__fixtureCspDirectives', { value: directives });
    document.addEventListener('securitypolicyviolation', (event) => {
      directives.push(event.effectiveDirective);
    });
  });
  const externalRequests: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:8790\/)/, async (route) => {
    externalRequests.push(route.request().url());
    expect(route.request().url()).toBe('https://www.youtube-nocookie.com/embed/AbCdEf12345');
    expect(route.request().headers()['referer']).toBe(O + '/');
    // Browser policy/navigation proof only. No request reaches a vendor or tests playback.
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'Content-Security-Policy': "default-src 'none'" },
      body: '<!doctype html><title>Synthetic embedded frame</title><p>Synthetic embedded frame</p>',
    });
  });
  await attach(page, 'image/png', screen);
  const attachment = page.locator('.media-attachments img[src^="blob:"]');
  await expect
    .poll(() =>
      attachment.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  const body = page.getByLabel('Markdown本文', { exact: true });
  await body.fill(
    (await body.inputValue()) + '\n\n[架空の動画](https://youtu.be/AbCdEf12345?tracking=discarded)',
  );
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  const preview = page.getByLabel('Markdownプレビュー', { exact: true });
  const image = preview.locator('img[src^="blob:"]');
  await expect(image).toHaveCount(1);
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  const consent = preview.getByRole('button', { name: 'YouTube動画を読み込む', exact: true });
  await expect(consent).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  await consent.click();
  await expect(
    preview.frameLocator('iframe').getByText('Synthetic embedded frame', { exact: true }),
  ).toBeVisible();
  expect(externalRequests).toEqual(['https://www.youtube-nocookie.com/embed/AbCdEf12345']);
  await page.screenshot({
    path: info.outputPath('static-csp-private-image-and-consented-video.png'),
    fullPage: true,
  });
  await preview.getByRole('button', { name: '動画を閉じる', exact: true }).click();
  await expect(preview.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__fixtureCspDirectives'))).toEqual([]);
});
test('article image stays private until explicit saved-version publication and fresh acquisition stops with owner stop', async ({
  page,
  browser,
}, info) => {
  await article(page, info);
  const image = await attach(page, 'image/png', screen);
  expect(image.width * image.height).toBeLessThanOrEqual(1000000);
  expect((await page.request.get('/api/media/' + image.id)).status()).toBe(404);
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page.getByText('記事を公開する', { exact: true }).click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await expect(composer.getByRole('region', { name: '公開する画像の確認' })).toContainText('1枚');
  await composer.getByLabel('記事の概要（300文字以内）').fill('画像で説明する保存版');
  await composer.getByRole('checkbox').check();
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  const link = composer.getByRole('link', { name: 'ログインなしの読者画面を開く' });
  await expect(link).toBeVisible();
  const path = (await link.getAttribute('href'))!;
  const guest = await browser.newContext({
    baseURL: O,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage(),
      privateRequests: string[] = [];
    reader.on('request', (r) => {
      if (
        new URL(r.url()).pathname.startsWith('/api/private/') &&
        new URL(r.url()).pathname !== '/api/private/session'
      )
        privateRequests.push(r.url());
    });
    await reader.goto(path);
    const img = reader.locator('.prose img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(
      true,
    );
    expect(privateRequests).toEqual([]);
    expect((await guest.request.get('/api/media/' + image.id)).headers()['cache-control']).toBe(
      'private, no-store',
    );
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({ path: info.outputPath('public-article-image.png'), fullPage: true });
    await page.getByRole('link', { name: 'アカウントへ戻る', exact: true }).click();
    await page
      .getByRole('button', { name: '公開停止を確認：架空の画像付き記事', exact: true })
      .click();
    const stop = page.getByRole('region', { name: '選択した公開の停止' });
    await stop.getByRole('checkbox').check();
    await stop.getByRole('button', { name: '確認した公開保存版を停止' }).click();
    await expect(stop.getByRole('status')).toContainText('公開停止記録を確認しました');
    expect((await guest.request.get('/api/media/' + image.id)).status()).toBe(404);
  } finally {
    await guest.close();
  }
});
test('project JPEG is resized, privately previewed, explicitly published and then unavailable after owner stop', async ({
  page,
  browser,
}, info) => {
  await register(page, info);
  await page.getByRole('link', { name: '作品を登録する', exact: true }).click();
  await page.getByLabel('作品タイトル', { exact: true }).fill('架空の画像作品');
  await page
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('画面の制作意図を説明します。');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(
    page.getByText('手元の入力と保存版は一致しています。', { exact: false }),
  ).toBeVisible();
  const image = await attach(page, 'image/jpeg', photo);
  expect(image.width * image.height).toBeLessThanOrEqual(524288);
  expect(image.width).toBeLessThan(1200);
  expect((await page.request.get('/api/media/' + image.id)).status()).toBe(404);
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(
    page.getByText('手元の入力と保存版は一致しています。', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '作品の公開準備・記録を確認', exact: true }).click();
  await page.getByRole('button', { name: '確認した保存版の作品を公開', exact: true }).click();
  const link = page.getByRole('link', { name: 'ログインなしで作品を見る' });
  await expect(link).toBeVisible();
  const path = (await link.getAttribute('href'))!;
  const guest = await browser.newContext({
    baseURL: O,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    await reader.goto(path);
    const img = reader.locator('.project-description img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(image.width);
    await reader.screenshot({ path: info.outputPath('public-project-image.png'), fullPage: true });
    await page.goto('/account');
    await page.getByRole('button', { name: '公開停止を確認：架空の画像作品', exact: true }).click();
    const stop = page.getByRole('region', { name: '選択した公開の停止' });
    await stop.getByRole('checkbox').check();
    await stop.getByRole('button', { name: '確認した公開保存版を停止' }).click();
    await expect(stop.getByRole('status')).toContainText('公開停止記録を確認しました');
    expect((await guest.request.get('/api/media/' + image.id)).status()).toBe(404);
  } finally {
    await guest.close();
  }
});
test('lost upload response keeps the same command for explicit retry; session loss removes and revokes private Blob previews', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    (window as unknown as { revoked: string[] }).revoked = [];
    URL.revokeObjectURL = (url: string) => {
      (window as unknown as { revoked: string[] }).revoked.push(url);
      original(url);
    };
  });
  await article(page, info);
  let commands: string[] = [];
  await page.route('**/api/private/media/articles/*/*', async (route) => {
    commands.push(route.request().url());
    const response = await route.fetch();
    if (commands.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page
    .getByLabel('下書きへ画像を追加', { exact: true })
    .setInputFiles({ name: 'synthetic-screen.png', mimeType: 'image/png', buffer: screen });
  // The existing guard hides all private controls after transport uncertainty.
  // A same-session recheck reveals the retained command; it never retries the upload itself.
  await expect(page.locator('.media-attachments')).toBeHidden();
  await page.getByRole('button', { name: 'ログイン状態を確認', exact: true }).click();
  await expect(
    page.getByText('結果未確定の画像があります。別の画像を送る前に確認してください。'),
  ).toBeVisible();
  expect(commands).toHaveLength(1);
  await page.getByRole('button', { name: '同じ画像の保存を確認・再送', exact: true }).click();
  await expect(page.locator('.media-attachments img[src^="blob:"]')).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toBe(commands[1]);
  const blob = (await page.locator('.media-attachments img').getAttribute('src'))!;
  await page
    .locator('.media-attachments')
    .screenshot({ path: info.outputPath('private-image-attachment.png') });
  await page.request.get('/__control/expire');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.media-attachments')).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        (url) => (window as unknown as { revoked: string[] }).revoked.includes(url),
        blob,
      ),
    )
    .toBe(true);
});
