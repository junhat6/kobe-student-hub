import { completeGoogleFormPost, fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const title = (page: Page) => page.getByLabel('タイトル', { exact: true });
const body = (page: Page) => page.getByLabel('Markdown本文', { exact: true });
const save = (page: Page) => page.getByRole('button', { name: '下書きを保存', exact: true });
const projectTitle = (page: Page) => page.getByLabel('作品タイトル', { exact: true });
const projectBody = (page: Page) =>
  page.getByLabel('作品説明（プレーンテキスト）', { exact: true });
const latch = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-autosave-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url()),
      state = url.searchParams.get('state')!,
      nonce = url.searchParams.get('nonce')!;
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('redirect_uri')).toBe(ORIGIN + '/api/auth/callback');
    expect(
      (
        await page.request.get('/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.goto('/signup');
  await page.getByLabel('入学年度 必須', { exact: true }).fill('2026');
  await page.getByLabel('卒業予定年度 必須', { exact: true }).fill('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await page.unroute(provider);
}
async function article(page: Page) {
  await page.getByRole('link', { name: '下書きを書く・再開する', exact: true }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await expect(title(page)).toBeEditable();
}
async function privateBuffer(page: Page) {
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('');
}
async function image(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, scale: 'css' });
}
async function replaceSession(context: BrowserContext) {
  const headers = { Origin: ORIGIN };
  expect([204, 409]).toContain(
    (await context.request.post(ORIGIN + '/api/auth/bootstrap', { headers })).status(),
  );
  const command = await context.request.post(ORIGIN + '/api/auth/command?action=login', {
    headers,
  });
  expect(command.status()).toBe(200);
  const proof = await command.json();
  const start = await context.request.post(ORIGIN + '/api/auth/start', {
    headers: { ...headers, Authorization: 'Bearer command.' + proof.commandToken },
  });
  expect(start.status()).toBe(200);
  const url = new URL((await start.json()).authorizationUrl),
    state = url.searchParams.get('state')!,
    nonce = url.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        ORIGIN +
          '/__control/token?' +
          new URLSearchParams({ state, nonce, actor: 'fictional-browser-b' }),
      )
    ).status(),
  ).toBe(200);
  expect(
    (await completeGoogleFormPost(context.request, ORIGIN, { state, code: state })).status(),
  ).toBe(303);
}

test('idle article edits save once and reopen from the server without browser persistence or publication', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  await article(page);
  let patches = 0,
    publications = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PATCH' && path.startsWith('/api/private/drafts/')) patches++;
    if (request.method() === 'POST' && path.startsWith('/api/private/publications/'))
      publications++;
  });
  await title(page).fill('架空の自動保存ノート');
  await body(page).fill('## 判断の条件\n\n端末をまたいで続けるための架空の本文。');
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み', { timeout: 7000 });
  expect(patches).toBe(1);
  await image(page, info, 'article-autosaved');
  await privateBuffer(page);
  const second = await context.newPage();
  try {
    await second.goto('/drafts');
    await second.getByRole('button', { name: '架空の自動保存ノート', exact: true }).click();
    await expect(body(second)).toHaveValue(/端末をまたいで/);
    await second.reload();
    await second.getByRole('button', { name: '架空の自動保存ノート', exact: true }).click();
    await expect(body(second)).toHaveValue(/端末をまたいで/);
    await privateBuffer(second);
    expect(publications).toBe(0);
    expect((await page.request.get('/api/private/profile')).status()).toBe(200);
    expect(await (await page.request.get('/api/private/profile')).json()).toEqual({
      profile: null,
    });
  } finally {
    await second.close();
  }
});

test('an in-flight autosave preserves later typing and serializes the next version', async ({
  page,
}, info) => {
  await register(page, info);
  await article(page);
  const entered = latch(),
    released = latch();
  const requests: { title: string; expectedVersion: number }[] = [];
  let inFlight = 0,
    maximum = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    requests.push(route.request().postDataJSON());
    inFlight++;
    maximum = Math.max(maximum, inFlight);
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (requests.length === 1) {
        entered.release();
        await released.promise;
      }
      await route.fulfill({ response });
    } finally {
      inFlight--;
    }
  });
  try {
    await title(page).fill('先に送信した版');
    await entered.promise;
    await title(page).fill('送信中に書き足した最新版');
    await page.waitForTimeout(2400);
    expect(requests).toHaveLength(1);
    await expect(title(page)).toHaveValue('送信中に書き足した最新版');
    released.release();
    await expect(page.locator('.editor-save-state')).toHaveText('保存済み', { timeout: 7000 });
    expect(requests.map(({ title, expectedVersion }) => [title, expectedVersion])).toEqual([
      ['先に送信した版', 1],
      ['送信中に書き足した最新版', 2],
    ]);
    expect(maximum).toBe(1);
    await privateBuffer(page);
  } finally {
    released.release();
  }
});

test('lost autosave acknowledgement pauses retries and readback/rebase does not silently overwrite', async ({
  page,
}, info) => {
  await register(page, info);
  await article(page);
  const entered = latch(),
    released = latch();
  let patches = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patches++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (patches === 1) {
      entered.release();
      await released.promise;
      return route.fulfill({
        response,
        status: 503,
        contentType: 'application/json',
        body: '{"error":"synthetic_ack_lost"}',
      });
    }
    await route.fulfill({ response });
  });
  try {
    await title(page).fill('送信した保存版');
    await entered.promise;
    await title(page).fill('まだ送信していない手元の変更');
    released.release();
    await expect(page.getByRole('alert', { name: '保存結果の確認' })).toBeVisible();
    await page.waitForTimeout(2400);
    expect(patches).toBe(1);
    await expect(save(page)).toBeDisabled();
    await page.getByRole('button', { name: '保存済みの版を確認', exact: true }).click();
    await expect(page.getByLabel('保存済みタイトル', { exact: true })).toHaveValue(
      '送信した保存版',
    );
    await page.getByRole('button', { name: '確認した版を基準にする', exact: true }).click();
    await page.waitForTimeout(2400);
    expect(patches).toBe(1);
    await expect(title(page)).toHaveValue('まだ送信していない手元の変更');
    await image(page, info, 'article-autosave-readback');
    await save(page).click();
    await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
    expect(patches).toBe(2);
  } finally {
    released.release();
  }
});

test('IME, invalid text and the deletion confirmation each suspend pending article autosave', async ({
  page,
}, info) => {
  await register(page, info);
  await article(page);
  let patches = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname.startsWith('/api/private/drafts/')
    )
      patches++;
  });
  await title(page).dispatchEvent('compositionstart');
  await title(page).fill('変換中の架空タイトル');
  await page.waitForTimeout(2400);
  expect(patches).toBe(0);
  await title(page).dispatchEvent('compositionend');
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み', { timeout: 7000 });
  expect(patches).toBe(1);
  await title(page).fill('x'.repeat(201));
  await expect(page.getByRole('alert').filter({ hasText: 'タイトルは200文字以内' })).toBeVisible();
  await page.waitForTimeout(2400);
  expect(patches).toBe(1);
  await title(page).fill('削除を確認している間は送信しない');
  await page.getByRole('button', { name: 'この下書きを削除', exact: true }).click();
  await page.waitForTimeout(2400);
  expect(patches).toBe(1);
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み', { timeout: 7000 });
  expect(patches).toBe(2);
});

test('a real server version conflict keeps both texts and stops autosave until explicit reconciliation', async ({
  page,
}, info) => {
  await register(page, info);
  await article(page);
  await title(page).fill('最初の確定版');
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み', { timeout: 7000 });
  const rows = await (await page.request.get('/api/private/drafts')).json();
  const draft = rows[0];
  const proof = await (await page.request.get('/api/private/session')).json();
  const changed = await page.request.patch('/api/private/drafts/' + draft.id, {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + proof.csrfToken },
    data: { title: '別端末で確定した版', body: '別端末の本文', expectedVersion: draft.version },
  });
  expect(changed.status()).toBe(200);
  let attempts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname.startsWith('/api/private/drafts/')
    )
      attempts++;
  });
  await title(page).fill('この画面で続けた版');
  await expect(page.getByRole('alert', { name: '保存結果の確認' })).toBeVisible({ timeout: 7000 });
  await page.waitForTimeout(2400);
  expect(attempts).toBe(1);
  await expect(title(page)).toHaveValue('この画面で続けた版');
  await page.getByRole('button', { name: '保存済みの版を確認', exact: true }).click();
  await expect(page.getByLabel('保存済みタイトル', { exact: true })).toHaveValue(
    '別端末で確定した版',
  );
  await expect(page.getByLabel('保存済み本文', { exact: true })).toHaveValue('別端末の本文');
  await privateBuffer(page);
});

test('session replacement cancels a queued save before another account can consume its buffer', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  await article(page);
  let attempts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname.startsWith('/api/private/drafts/')
    )
      attempts++;
  });
  await title(page).fill('前の本人だけの未送信タイトル');
  await replaceSession(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true }),
  ).toBeEnabled();
  await expect(title(page)).toHaveCount(0);
  await page.waitForTimeout(2400);
  expect(attempts).toBe(0);
  await privateBuffer(page);
});

test('ordinary project input autosaves, resumes after reload and never publishes itself', async ({
  page,
}, info) => {
  await register(page, info);
  await page.getByRole('link', { name: '作品を登録する', exact: true }).click();
  let saves = 0,
    publications = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      ['POST', 'PATCH'].includes(request.method()) &&
      path.startsWith('/api/private/project-drafts')
    )
      saves++;
    if (request.method() === 'POST' && path.startsWith('/api/private/project-publications'))
      publications++;
  });
  await projectTitle(page).fill('架空の自動保存作品');
  await projectBody(page).fill('作品説明を保存して、別の日に再開する。');
  await expect(
    page.getByText('手元の入力と保存版は一致しています。', { exact: false }),
  ).toBeVisible({ timeout: 7000 });
  expect(saves).toBe(1);
  await image(page, info, 'project-autosaved');
  await page.reload();
  await page.getByRole('button', { name: '保存版を確認：架空の自動保存作品', exact: true }).click();
  await page.getByRole('button', { name: 'この保存版を開く', exact: true }).click();
  await expect(projectBody(page)).toHaveValue('作品説明を保存して、別の日に再開する。');
  await privateBuffer(page);
  expect(publications).toBe(0);
});

test('lost project creation acknowledgement does not create duplicates or discard the input', async ({
  page,
}, info) => {
  await register(page, info);
  await page.getByRole('link', { name: '作品を登録する', exact: true }).click();
  let creates = 0;
  await page.route('**/api/private/project-drafts', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    creates++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.fulfill({
      response,
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_project_ack_lost"}',
    });
  });
  await projectTitle(page).fill('結果が未確定の架空作品');
  await projectBody(page).fill('重複して作成せず、この文章を保持する。');
  await expect(
    page.getByRole('status').filter({ hasText: '新規保存の結果を確認できませんでした' }),
  ).toBeVisible({ timeout: 7000 });
  await page.waitForTimeout(2400);
  expect(creates).toBe(1);
  await expect(projectTitle(page)).toHaveValue('結果が未確定の架空作品');
  await expect(projectBody(page)).toHaveValue('重複して作成せず、この文章を保持する。');
  await expect(page.getByRole('button', { name: '作品を保存', exact: true })).toBeDisabled();
  const rows = await (await page.request.get('/api/private/project-drafts')).json();
  expect(rows).toHaveLength(1);
  await image(page, info, 'project-autosave-unknown');
  await privateBuffer(page);
});
