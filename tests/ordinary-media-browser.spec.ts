import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { accountMenu } from './helpers/header';
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
  await page.getByLabel('入学', { exact: true }).selectOption('2026');
  await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(O + '/account');
  await page.unroute(provider);
  const profile = page.getByRole('region', { name: 'プロフィールをつくる' });
  await profile.getByLabel('表示名', { exact: true }).fill('架空の画像投稿者');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
}
async function article(page: Page, info: TestInfo) {
  await register(page, info);
  await page.getByRole('link', { name: '記事を書く', exact: true }).click();
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
test('pasted Google マップ embed HTML and an Instagram URL become consent-gated sandboxed frames under the real CSP', async ({
  page,
}, info) => {
  await article(page, info);
  await page.evaluate(() => {
    const directives: string[] = [];
    Object.defineProperty(window, '__fixtureCspDirectives', { value: directives });
    document.addEventListener('securitypolicyviolation', (event) => {
      directives.push(event.effectiveDirective);
    });
  });
  const pb =
    '!1m18!1m12!1m3!1d3280.6!2d135.19!3d34.69!3m3!1m2!1s0x0%3A0x0!2z5Y+N5oi4=!5e0!3m2!1sja!2sjp';
  const map = 'https://www.google.com/maps/embed?pb=' + pb;
  const insta = 'https://www.instagram.com/p/AbC_12-x/embed/';
  const externalRequests: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:8790\/)/, async (route) => {
    externalRequests.push(route.request().url());
    expect([map, insta]).toContain(route.request().url());
    expect(route.request().headers()['referer']).toBe(O + '/');
    // Synthetic frames only: no request reaches Google or Instagram.
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'Content-Security-Policy': "default-src 'none'" },
      body: '<!doctype html><title>Synthetic embedded frame</title><p>Synthetic embedded frame</p>',
    });
  });
  const body = page.getByLabel('Markdown本文', { exact: true });
  await body.focus();
  await body.evaluate((area: HTMLTextAreaElement) =>
    area.setSelectionRange(area.value.length, area.value.length),
  );
  // What Google マップ「共有 → 地図を埋め込む」 copies. Raw HTML would be dropped, so it becomes one URL line.
  await body.evaluate((area: HTMLTextAreaElement, html: string) => {
    const data = new DataTransfer();
    data.setData('text/plain', html);
    area.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, `<iframe src="${map}" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy"></iframe>`);
  await expect(body).toHaveValue('## 実験の画面\n\n保存した画面を説明します。\n\n' + map);
  await body.fill(
    (await body.inputValue()) + '\n\nhttps://www.instagram.com/p/AbC_12-x/?igsh=tracking',
  );
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  const preview = page.getByLabel('Markdownプレビュー', { exact: true });
  await expect(preview.getByRole('button', { name: '地図を読み込む', exact: true })).toBeVisible();
  await expect(preview.getByRole('link', { name: 'Instagramで開く', exact: true })).toHaveAttribute(
    'href',
    'https://www.instagram.com/p/AbC_12-x/',
  );
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  await preview.getByRole('button', { name: '地図を読み込む', exact: true }).click();
  await preview.getByRole('button', { name: 'Instagramの投稿を読み込む', exact: true }).click();
  for (const title of ['Google マップ', 'Instagramの投稿']) {
    const frame = preview.locator(`iframe[title="${title}"]`);
    await expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
    );
    await expect(
      preview
        .frameLocator(`iframe[title="${title}"]`)
        .getByText('Synthetic embedded frame', { exact: true }),
    ).toBeVisible();
  }
  expect(externalRequests.sort()).toEqual([map, insta].sort());
  await page.screenshot({
    path: info.outputPath('consented-map-and-instagram.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => Reflect.get(window, '__fixtureCspDirectives'))).toEqual([]);
});
test('article image stays private until explicit saved-version publication and fresh acquisition stops with owner stop', async ({
  page,
  browser,
}, info) => {
  await article(page, info);
  const image = await attach(page, 'image/png', screen);
  expect(image.width * image.height).toBeLessThanOrEqual(1000000);
  // The bytes are in the private bucket (#12), yet a draft image is still not public.
  const objects = async () =>
    (
      (await (await page.request.get('/__control/media-object?id=' + image.id)).json()) as {
        objects: number;
      }
    ).objects;
  expect(await objects()).toBe(1);
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
    await accountMenu(page, 'マイページ');
    await page
      .getByRole('button', { name: '公開を止める：架空の画像付き記事', exact: true })
      .click();
    const stop = page.getByRole('alertdialog', { name: /の公開を止めますか/ });
    await stop.getByRole('button', { name: '公開を止める', exact: true }).click();
    await expect(stop).toBeHidden();
    await expect(page.getByText(/の公開を止めました/)).toBeVisible();
    expect((await guest.request.get('/api/media/' + image.id)).status()).toBe(404);
    // Still stored: the denial comes from the D1 publication check, not from a missing object.
    expect(await objects()).toBe(1);
  } finally {
    await guest.close();
  }
});
test('project JPEG is resized, privately previewed, explicitly published and then unavailable after owner stop', async ({
  page,
  browser,
}, info) => {
  await register(page, info);
  await page.getByRole('link', { name: '作品を登録', exact: true }).click();
  await page.getByLabel('作品タイトル', { exact: true }).fill('架空の画像作品');
  await page.getByLabel('作品の説明', { exact: true }).fill('画面の制作意図を説明します。');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(page.getByText('保存済みです。', { exact: false })).toBeVisible();
  const image = await attach(page, 'image/jpeg', photo);
  expect(image.width * image.height).toBeLessThanOrEqual(524288);
  expect(image.width).toBeLessThan(1200);
  expect((await page.request.get('/api/media/' + image.id)).status()).toBe(404);
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(page.getByText('保存済みです。', { exact: false })).toBeVisible();
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
    await page.getByRole('button', { name: '公開を止める：架空の画像作品', exact: true }).click();
    const stop = page.getByRole('alertdialog', { name: /の公開を止めますか/ });
    await stop.getByRole('button', { name: '公開を止める', exact: true }).click();
    await expect(stop).toBeHidden();
    await expect(page.getByText(/の公開を止めました/)).toBeVisible();
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
test('unsupported, oversized, unreadable and too-many-pixel images are refused with their own reason before any upload', async ({
  page,
}, info) => {
  await article(page, info);
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && new URL(r.url()).pathname.startsWith('/api/private/media/'))
      uploads.push(r.url());
  });
  const input = page.getByLabel('下書きへ画像を追加', { exact: true }),
    status = page.locator('.media-attachments p[aria-live="polite"]');
  await expect(page.locator('.media-attachments')).toHaveAttribute('aria-busy', 'false');
  const ihdr = (width: number, height: number) => {
    const b = Buffer.alloc(64);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).copy(b);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
  };
  for (const [file, reason] of [
    [
      { name: 'synthetic.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
      'この形式の画像は添付できません。JPEGかPNGの画像を選んでください',
    ],
    [
      {
        name: 'synthetic-huge.png',
        mimeType: 'image/png',
        buffer: Buffer.concat([ihdr(800, 600), Buffer.alloc(12 * 1024 * 1024)]),
      },
      '画像が大きすぎます（12.0 MiB）。12 MiB以内の画像を選んでください。',
    ],
    [
      { name: 'synthetic-text.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
      '画像の中身をJPEG・PNGとして読み取れませんでした。',
    ],
    [
      { name: 'synthetic-wide.png', mimeType: 'image/png', buffer: ihdr(20000, 1000) },
      '画像の画素数が大きすぎます（20000 × 1000）。1600万画素以内の画像を選んでください。',
    ],
  ] as const) {
    await input.setInputFiles(file);
    await expect(status).toContainText(reason);
    // A refusal is final and local: no pending retry command and the picker stays usable.
    await expect(page.getByText('結果未確定の画像があります。', { exact: false })).toHaveCount(0);
    await expect(input).toBeEnabled();
  }
  expect(uploads).toEqual([]);
  await expect(page.locator('.media-grid figure')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.media-attachments')
    .screenshot({ path: info.outputPath('refused-image-reason.png') });
});
test('a storage-limit refusal names the limit and leaves no resend command', async ({
  page,
}, info) => {
  await article(page, info);
  const status = page.locator('.media-attachments p[aria-live="polite"]');
  await expect(page.locator('.media-attachments')).toHaveAttribute('aria-busy', 'false');
  // The worker refusal shape is fixed by tests/media.test.ts; here the request is answered with it
  // before reaching the server, so nothing is saved and the UI must not offer a resend.
  await page.route('**/api/private/media/articles/*/*', (route) =>
    route.fulfill({ status: 409, json: { error: 'media_limit', limit: 'owner' } }),
  );
  await page
    .getByLabel('下書きへ画像を追加', { exact: true })
    .setInputFiles({ name: 'synthetic-screen.png', mimeType: 'image/png', buffer: screen });
  await expect(status).toHaveText(
    'あなたが保存できる画像の合計（512枚・64 MiB）に達しました。使っていない下書きの画像を削除してから追加してください。',
  );
  await expect(page.getByText('結果未確定の画像があります。', { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('下書きへ画像を追加', { exact: true })).toBeEnabled();
  await expect(page.locator('.media-grid figure')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.media-attachments')
    .screenshot({ path: info.outputPath('storage-limit-reason.png') });
});
test('the image panel reads its own list, shows only a short private label, and offers a retry only when the read fails', async ({
  page,
}, info) => {
  let failures = 1;
  await page.route('**/api/private/media/articles/*', (route) => {
    if (route.request().method() === 'GET' && failures > 0) {
      failures -= 1;
      return route.fulfill({ status: 503, body: '' });
    }
    return route.continue();
  });
  await article(page, info);
  const panel = page.locator('.media-attachments'),
    status = panel.locator('p[aria-live="polite"]');
  await expect(panel).toHaveAttribute('aria-busy', 'false');
  await expect(panel.getByText('公開するまで本人だけ', { exact: true })).toBeVisible();
  // Limits and storage rules are not printed up front; they appear only when a file is refused.
  await expect(panel).not.toContainText('512 KiB');
  await expect(panel).not.toContainText('メタデータ');
  await expect(page.getByText('JPEG・PNG画像に対応', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '保存済み画像を確認' })).toHaveCount(0);
  await expect(status).toHaveText('保存した画像を読み込めませんでした。');
  await panel.getByRole('button', { name: 'もう一度', exact: true }).click();
  await expect(status).toHaveText('');
  await expect(panel.getByRole('button', { name: 'もう一度', exact: true })).toHaveCount(0);
  await attach(page, 'image/png', screen);
  await expect(status).toHaveText('画像を保存して本文に入れました。位置情報などは消してあります。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: info.outputPath('image-panel-after-retry.png') });
});
test('the picker waits for the first image list so a slow list cannot overwrite a just-saved image', async ({
  page,
}, info) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let first = true;
  await page.route('**/api/private/media/articles/*', async (route) => {
    if (route.request().method() === 'GET' && first) {
      first = false;
      await gate;
    }
    return route.continue();
  });
  await article(page, info);
  const panel = page.locator('.media-attachments'),
    input = page.getByLabel('下書きへ画像を追加', { exact: true });
  await expect(panel).toHaveAttribute('aria-busy', 'true');
  await expect(input).toBeDisabled();
  release();
  await expect(panel).toHaveAttribute('aria-busy', 'false');
  await expect(input).toBeEnabled();
  await attach(page, 'image/png', screen);
  await expect(panel.locator('.media-grid figure')).toHaveCount(1);
});
