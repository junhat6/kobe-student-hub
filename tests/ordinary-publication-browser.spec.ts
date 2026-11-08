import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-publishing-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state')!;
    const nonce = url.searchParams.get('nonce')!;
    expect(
      (
        await page.request.get('/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await route.fulfill({
      status: 302,
      headers: {
        Location: ORIGIN + '/api/auth/callback?' + new URLSearchParams({ state, code: state }),
        'Cache-Control': 'no-store',
      },
      body: '',
    });
  });
  await page.goto('/signup');
  await page.getByLabel('入学年度 必須', { exact: true }).fill('2026');
  await page.getByLabel('卒業予定年度 必須', { exact: true }).fill('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(page.getByRole('link', { name: '下書きを書く・再開する' })).toBeVisible();
  await page.unroute(provider);
}

async function publishArticle(page: Page, info: TestInfo, title = '架空のAI技術選定ノート') {
  await register(page, info);
  await page.getByText('公開プロフィールを準備する', { exact: true }).click();
  const profile = page.getByRole('region', { name: '公開プロフィールの初回作成' });
  await profile.getByLabel('表示名 必須').fill('架空の学生');
  await profile.getByLabel('自己紹介（任意）').fill('架空の制作プロフィール');
  await profile.getByRole('checkbox').check();
  await profile
    .getByRole('button', { name: '確認した内容でプロフィールを作成', exact: true })
    .click();
  await expect(profile.locator('.profile-setup-status')).toHaveText(
    '公開プロフィールを作成しました。',
  );
  await page.getByRole('link', { name: '下書きを書く・再開する' }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill(title);
  await page
    .getByLabel('Markdown本文', { exact: true })
    .fill('## 条件\n\nこの文章は公開する保存版です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page.getByText('記事を公開する', { exact: true }).click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await composer.getByLabel('記事の概要（300文字以内）').fill('条件・判断・確認の記録');
  await composer.getByLabel('タグ（カンマ区切り、5件まで）').fill('AI');
  await composer.getByLabel('想定読者（任意）').fill('AIで制作している学生');
  await composer.getByLabel('前提知識（任意）').fill('特別な前提知識は不要');
  await composer.getByLabel('読んだあとにできること（任意）').fill('自分の判断を説明する');
  await expect(composer.getByLabel('読了時間の目安（分）')).toHaveValue('1');
  await composer.getByRole('checkbox').check();
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  const publicLink = composer.getByRole('link', { name: 'ログインなしの読者画面を開く' });
  await expect(publicLink).toBeVisible();
  const articlePath = await publicLink.getAttribute('href');
  expect(articlePath).toMatch(/^\/articles\/[0-9a-f-]{36}$/);
  return articlePath!;
}

test('ordinary saved article → anonymous reader/author/feed → owner publication stop', async ({
  page,
  browser,
}, info) => {
  const articlePath = await publishArticle(page, info);

  // A subsequent saved draft is private; publication remains the explicitly confirmed snapshot.
  await page.getByLabel('Markdown本文', { exact: true }).fill('PRIVATE_FICTIONAL_CONTINUATION');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    expect((await guest.request.get('/api/private/session')).status()).toBe(401);
    const reader = await guest.newPage();
    const forwarded: string[] = [];
    reader.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/'))
        forwarded.push(new URL(request.url()).pathname);
    });
    await reader.goto(articlePath!);
    await expect(
      reader.getByRole('heading', { name: '架空のAI技術選定ノート', exact: true }),
    ).toBeVisible();
    await expect(reader.locator('.prose')).toContainText('この文章は公開する保存版です。');
    await expect(reader.locator('main')).not.toContainText('PRIVATE_FICTIONAL_CONTINUATION');
    expect(forwarded.every((path) => !path.startsWith('/api/private/'))).toBe(true);
    const authorHref = await reader.locator('.detail-author .author').getAttribute('href');
    expect(authorHref).toMatch(/^\/students\/[A-Za-z0-9_-]+$/);
    await reader.locator('.detail-author .author').click();
    await expect(reader.getByRole('heading', { name: '架空の学生', exact: true })).toBeVisible();
    await expect(
      reader.getByRole('link', { name: '架空のAI技術選定ノート', exact: true }),
    ).toBeVisible();
    await reader.getByRole('link', { name: '公開いいねを見る', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: '架空の学生の公開いいね', exact: true }),
    ).toBeVisible();
    await reader.goto('/');
    await reader.getByRole('searchbox').fill('AI技術選定');
    await reader.getByRole('button', { name: '検索', exact: true }).click();
    await expect(
      reader.getByRole('link', { name: '架空のAI技術選定ノート', exact: true }),
    ).toBeVisible();
    await reader.goto(articlePath!);
    await expect(
      reader.getByRole('heading', { name: '架空のAI技術選定ノート', exact: true }),
    ).toBeVisible();
    await expect(reader.locator('.prose')).toContainText('この文章は公開する保存版です。');
    expect(
      await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await reader.screenshot({
      path: info.outputPath('ordinary-public-article.png'),
      fullPage: true,
    });

    await page.getByRole('link', { name: 'アカウントへ戻る', exact: true }).click();
    const records = page.getByRole('region', { name: '自分の公開記録', exact: true });
    await records
      .getByRole('button', { name: '公開停止を確認：架空のAI技術選定ノート', exact: true })
      .click();
    const stop = page.getByRole('region', { name: '選択した公開の停止' });
    await expect(stop.getByRole('checkbox')).toBeEnabled();
    await stop.getByRole('checkbox').check();
    await stop.getByRole('button', { name: '確認した公開保存版を停止' }).click();
    await expect(stop.getByRole('status')).toContainText('公開停止記録を確認しました');
    await reader.reload();
    await expect(reader.getByRole('heading', { name: '記事を表示できませんでした' })).toBeVisible();
    await reader.goto('/');
    await expect(
      reader.getByRole('link', { name: '架空のAI技術選定ノート', exact: true }),
    ).toHaveCount(0);
  } finally {
    await guest.close();
  }
});

test('ordinary profile input survives cancelled SPA navigation', async ({ page }, info) => {
  await register(page, info);
  await page.getByText('公開プロフィールを準備する', { exact: true }).click();
  await page.getByLabel('表示名 必須').fill('未保存の架空プロフィール');
  const dialog = page.waitForEvent('dialog');
  const click = page
    .getByRole('navigation', { name: 'メイン' })
    .getByRole('link', { name: 'ホーム', exact: true })
    .click();
  await (await dialog).dismiss();
  await click;
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(page.getByLabel('表示名 必須')).toHaveValue('未保存の架空プロフィール');
});

// Use the existing signed-provider HTTP flow to replace a cookie without changing the observed page.
// Proofs remain local variables and are not returned or written to browser storage.
async function replaceSession(context: BrowserContext) {
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
        ORIGIN +
          '/__control/token?' +
          new URLSearchParams({ state, nonce, actor: 'fictional-browser-b' }),
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.get(
        ORIGIN + '/api/auth/callback?' + new URLSearchParams({ state, code: state }),
        { maxRedirects: 0 },
      )
    ).status(),
  ).toBe(303);
  expect((await context.request.get(ORIGIN + '/api/private/session')).status()).toBe(200);
}

const reportReason = (page: Page) => page.getByLabel('通報理由（必須）', { exact: true });
async function openReport(page: Page, articlePath: string) {
  let privateReads = 0;
  const observe = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname.startsWith('/api/private/')) privateReads++;
  };
  page.on('request', observe);
  await page.goto(articlePath);
  await expect(page.locator('.prose')).toContainText('この文章は公開する保存版です。');
  expect(privateReads).toBe(0);
  await page.getByRole('button', { name: 'この記事を通報する', exact: true }).click();
  await expect(reportReason(page)).toBeEditable();
  page.off('request', observe);
}

test('ordinary report retains same-session input while an unknown session stays concealed', async ({
  page,
}, info) => {
  const articlePath = await publishArticle(page, info, '架空の通報境界ノート');
  await openReport(page, articlePath);
  await reportReason(page).fill('同じセッションだけで再開する架空の理由');
  await page.getByLabel('詳しい説明（任意）').fill('同じページのメモリに保持する架空の詳細');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(reportReason(page)).toBeHidden();
  await expect(reportReason(page)).toHaveValue('同じセッションだけで再開する架空の理由');
  await page.route('**/api/private/session', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"unavailable"}',
    }),
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText(/セッションを確認できませんでした。入力・通報内容は/)).toBeVisible();
  await expect(reportReason(page)).toBeHidden();
  await expect(reportReason(page)).toHaveValue('同じセッションだけで再開する架空の理由');
  await page.unroute('**/api/private/session');
  await page.getByRole('button', { name: 'この記事を通報する', exact: true }).click();
  await expect(reportReason(page)).toBeEditable();
  await expect(reportReason(page)).toHaveValue('同じセッションだけで再開する架空の理由');
  await expect(page.getByLabel('詳しい説明（任意）')).toHaveValue(
    '同じページのメモリに保持する架空の詳細',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('region', { name: '記事の通報', exact: true }).screenshot({
    path: info.outputPath('ordinary-report-same-session.png'),
  });
});

test('ordinary report blocks A input under B without a lifecycle event and requires explicit continuation', async ({
  page,
  context,
}, info) => {
  const articlePath = await publishArticle(page, info, '架空の通報境界ノート');
  await openReport(page, articlePath);
  await reportReason(page).fill('Aのセッションでだけ扱う架空の理由');
  await page.getByLabel('詳しい説明（任意）').fill('Aの架空の詳細');
  await page
    .getByRole('checkbox', { name: '入力した理由・詳細を運営の確認用として送信します' })
    .check();
  let reportPosts = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/private/reports/') &&
      request.method() === 'POST'
    )
      reportPosts++;
  });
  await replaceSession(context);
  await page.getByRole('button', { name: '確認した内容で通報を送信', exact: true }).click();
  await expect(reportReason(page)).toHaveCount(0);
  await expect(
    page.getByText(/セッションが無効または変更されたため、前の入力・通報内容を消しました/),
  ).toBeVisible();
  expect(reportPosts).toBe(0);
  await page.getByRole('button', { name: 'この記事を通報する', exact: true }).click();
  await page
    .getByRole('button', { name: '確認したセッションで通報画面を開く', exact: true })
    .click();
  await expect(reportReason(page)).toBeEditable();
  await expect(reportReason(page)).toHaveValue('');
  await expect(page.getByLabel('詳しい説明（任意）')).toHaveValue('');
  await expect(
    page.getByRole('checkbox', { name: '入力した理由・詳細を運営の確認用として送信します' }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: '確認した内容で通報を送信', exact: true }),
  ).toBeDisabled();
  expect(reportPosts).toBe(0);
  await page.getByRole('region', { name: '記事の通報', exact: true }).screenshot({
    path: info.outputPath('ordinary-report-changed-session.png'),
  });
});

test('ordinary report removes its input after logout in another tab', async ({
  page,
  context,
}, info) => {
  const articlePath = await publishArticle(page, info, '架空の通報境界ノート');
  await openReport(page, articlePath);
  await reportReason(page).fill('ログアウトで消える架空の理由');
  const session = await context.request.get('/api/private/session');
  expect(session.status()).toBe(200);
  const { csrfToken } = await session.json();
  expect(
    (
      await context.request.post('/api/private/logout', {
        headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + csrfToken },
      })
    ).status(),
  ).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(reportReason(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ログインしてください', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '確認した内容で通報を送信', exact: true }),
  ).toHaveCount(0);
});

test('ordinary report cancels a pending initial session proof on hide and ignores its late response', async ({
  page,
}, info) => {
  const articlePath = await publishArticle(page, info, '架空の通報境界ノート');
  await page.goto(articlePath);
  await expect(page.locator('.prose')).toContainText('この文章は公開する保存版です。');
  const latch = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };
  const held = latch(),
    release = latch(),
    settled = latch();
  let sessionReads = 0;
  await page.route('**/api/private/session', async (route) => {
    if (++sessionReads !== 1) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    held.release();
    await release.promise;
    try {
      await route.fulfill({ response });
    } catch {
      /* The suspended request was cancelled. */
    } finally {
      settled.release();
    }
  });
  const aborted = page.waitForEvent('requestfailed', {
    predicate: (request) => new URL(request.url()).pathname === '/api/private/session',
  });
  try {
    await page.getByRole('button', { name: 'この記事を通報する', exact: true }).click();
    await held.promise;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await aborted;
    release.release();
    await settled.promise;
    await expect(page.locator('.project-private-scope')).toBeHidden();
    await expect(page.locator('.project-private-scope')).toHaveAttribute('inert', '');
    await expect(reportReason(page)).toHaveCount(0);
    expect(sessionReads).toBe(1);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(reportReason(page)).toBeEditable();
    expect(sessionReads).toBeGreaterThan(1);
    await expect(reportReason(page)).toHaveValue('');
  } finally {
    release.release();
    await page.unroute('**/api/private/session');
  }
});
