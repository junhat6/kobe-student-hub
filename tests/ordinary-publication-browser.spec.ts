import { completeGoogleFormPost, fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { ensureProfileByApi } from './helpers/profile';
import { accountMenu } from './helpers/header';
import { japanDayOfIso, japanDaysSince, japanTitle, recentLabel } from './helpers/japan-day';
import { chooseReport, reportDialog } from './helpers/report-menu';

/** Each date / reading-time label of the article header stays on a single line. */
async function expectUnbrokenDates(page: Page) {
  const parts = page.locator('.detail-dates .nowrap');
  expect(await parts.count()).toBeGreaterThanOrEqual(2);
  // An inline label returns one rect per text fragment; all of them share one line when unbroken.
  expect(
    await parts.evaluateAll((nodes) =>
      nodes.map(
        (node) => new Set([...node.getClientRects()].map((rect) => Math.round(rect.top))).size,
      ),
    ),
  ).toEqual(Array(await parts.count()).fill(1));
}

const testStartedAt = Date.now();

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

test('ordinary moderation route keeps signed-out readers and ordinary students outside operator data', async ({
  page,
}, info) => {
  await page.goto('/moderation');
  await expect(page.getByRole('heading', { name: '通報の確認と判断', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
  await expect(page.locator('.operator-read-private')).toBeHidden();
  await register(page, info);
  await expect(page.getByRole('link', { name: '運営者用画面', exact: true })).toHaveCount(0);
  await page.goto('/moderation');
  const denied = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/private/moderation/cases',
  );
  await page.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
  expect((await denied).status()).toBe(404);
  await expect(page.locator('.operator-read-private')).toBeHidden();
  await expect(page.getByRole('button', { name: '確認した内容で復元', exact: true })).toHaveCount(
    0,
  );
});

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-publishing-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    const state = url.searchParams.get('state')!;
    const nonce = url.searchParams.get('nonce')!;
    expect(
      (
        await page.request.get('/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.goto('/signup');
  await page.getByLabel('入学', { exact: true }).selectOption('2026');
  await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  // A new account starts by making its public profile.
  await expect(page.getByRole('region', { name: 'プロフィールをつくる' })).toBeVisible();
  await page.unroute(provider);
}

async function publishArticle(page: Page, info: TestInfo, title = '架空のAI技術選定ノート') {
  await register(page, info);
  const profile = page.getByRole('region', { name: 'プロフィールをつくる' });
  await profile.getByLabel('表示名', { exact: true }).fill('架空の学生');
  await profile.getByLabel('自己紹介', { exact: true }).fill('架空の制作プロフィール');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '記事の管理', exact: true }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill(title);
  await page
    .getByLabel('Markdown本文', { exact: true })
    .fill('## 条件\n\nこの文章は公開する保存版です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  // #230: like Zenn・note, 「公開する」 sits beside the save state at the top right; the panel
  // with summary and tags opens only after it is pressed, and the reader is moved to it.
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  const panelHeading = composer.locator('details > summary').first();
  await expect(composer.getByLabel('記事の概要（300文字以内）')).toBeHidden();
  // #267: no second entry below the editor; the panel heading appears only after the press.
  await expect(panelHeading).toBeHidden();
  const publishOpen = page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true });
  const [openBox, saveBox] = await Promise.all([
    publishOpen.boundingBox(),
    page.locator('.editor-save-state').boundingBox(),
  ]);
  expect(
    Math.abs(openBox!.y + openBox!.height / 2 - (saveBox!.y + saveBox!.height / 2)),
  ).toBeLessThan(4);
  await publishOpen.click();
  await expect(panelHeading).toBeFocused();
  await expect(panelHeading).toBeInViewport();
  // The panel's heading is not hidden under the sticky site header.
  const [headerBox, headingBox] = await Promise.all([
    page.locator('.site-header').boundingBox(),
    panelHeading.boundingBox(),
  ]);
  expect(headingBox!.y).toBeGreaterThanOrEqual(
    (await page.locator('.site-header').evaluate((h) => getComputedStyle(h).position)) === 'sticky'
      ? headerBox!.height
      : 0,
  );
  await composer.getByLabel('記事の概要（300文字以内）').fill('条件・判断・確認の記録');
  await composer.getByLabel('タグ（5件まで）').fill('AI');
  await composer.getByText('読者向けの補足（任意）', { exact: true }).click();
  await composer.getByLabel('想定読者（任意）').fill('AIで制作している学生');
  await composer.getByLabel('前提知識（任意）').fill('特別な前提知識は不要');
  await composer.getByLabel('読んだあとにできること（任意）').fill('自分の判断を説明する');
  await expect(composer.getByLabel('読了時間の目安（分）')).toHaveValue('1');
  // C09: the owner can read the exact saved snapshot before publishing, and nothing is
  // published until the explicit confirmation is checked and the button is pressed.
  const snapshot = composer.locator('details.publication-snapshot');
  await snapshot.getByText(/^保存済みの版 \d+ の本文を確認$/).click();
  await expect(snapshot.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(snapshot).toContainText('この文章は公開する保存版です。');
  const submit = composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true });
  await expect(submit).toBeDisabled();
  // Earlier tests leave same-title articles and the feed is the newest 20, so a same-title
  // count can drop an old one; instead the article just published must be in the anonymous feed.
  const publicIds = async () => {
    const response = await page.request.get('/api/articles');
    expect(response.status()).toBe(200);
    const { cards } = (await response.json()) as { cards: { entry: { id: string } }[] };
    return cards.map((card) => card.entry.id);
  };
  await composer.getByRole('checkbox').check();
  await expect(submit).toBeEnabled();
  await submit.click();
  const publicLink = composer.getByRole('link', { name: 'ログインなしの読者画面を開く' });
  await expect(publicLink).toBeVisible();
  const articlePath = await publicLink.getAttribute('href');
  expect(articlePath).toMatch(/^\/articles\/[0-9a-f-]{36}$/);
  expect(await publicIds()).toContain(articlePath!.slice('/articles/'.length));
  // #190: on a 390px phone the published heading must not split mid-word ("更新す／る");
  // the close pill moves to its own line instead.
  const summary = composer.locator('details > summary').first();
  await expect(summary).toHaveText('記事を公開・更新する');
  const headingLines = await summary.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(headingLines).toBe(1);
  // #267: one entry to publishing. Closing takes the panel off the page and returns focus to
  // the top-right 「公開する」, which brings the same panel back.
  await summary.click();
  await expect(summary).toBeHidden();
  const publishAgain = page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true });
  await expect(publishAgain).toBeFocused();
  await publishAgain.click();
  await expect(publicLink).toBeVisible();
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
    // #308: a fresh publication reads relative; #142: its exact time is in the Japan day of the run.
    const publicDate = reader.locator('.detail-author time');
    await expect(publicDate).toHaveText(recentLabel);
    await expect(publicDate).toHaveAttribute('title', japanTitle);
    expect(japanDaysSince(testStartedAt)).toContain(
      japanDayOfIso(await publicDate.getAttribute('datetime')),
    );
    // #184: a first publication reads 「公開」, not 「更新」, and no label breaks mid-phrase.
    await expect(reader.locator('.detail-dates')).toHaveText(/^(たった今|\d+分前) 公開 · 約\d+分$/);
    await expectUnbrokenDates(reader);
    const readerContext = reader.getByRole('region', { name: '読む前の目安' });
    for (const text of ['AIで制作している学生', '特別な前提知識は不要', '自分の判断を説明する'])
      await expect(readerContext.getByText(text, { exact: true })).toBeVisible();
    await expect(readerContext.locator('.reader-context-missing')).toHaveCount(0);
    await expect(reader.locator('main')).not.toContainText('PRIVATE_FICTIONAL_CONTINUATION');
    expect(
      forwarded.every(
        (path) => !path.startsWith('/api/private/') || path === '/api/private/session',
      ),
    ).toBe(true);
    const authorHref = await reader.locator('.detail-author .author').getAttribute('href');
    expect(authorHref).toMatch(/^\/students\/[A-Za-z0-9_-]+$/);
    await reader.locator('.detail-author .author').click();
    await expect(reader.getByRole('heading', { name: '架空の学生', exact: true })).toBeVisible();
    await expect(
      reader.getByRole('link', { name: '架空のAI技術選定ノート', exact: true }),
    ).toBeVisible();
    await reader
      .getByRole('navigation', { name: '投稿者の活動' })
      .getByRole('link', { name: 'いいね', exact: true })
      .click();
    await expect(reader).toHaveURL(/\/students\/[A-Za-z0-9_-]+\/likes$/);
    await expect(reader.getByRole('heading', { name: '架空の学生', exact: true })).toBeVisible();
    // #309: the top has no search box of its own; search lives on /search.
    await reader.goto('/search');
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

    await accountMenu(page, 'マイページ');
    const records = page.getByRole('region', { name: '自分の公開記録', exact: true });
    const stopButton = records.getByRole('button', {
      name: '公開を止める：架空のAI技術選定ノート',
      exact: true,
    });
    // #203: one dialog names the target; cancelling it stops nothing.
    await stopButton.click();
    const stop = page.getByRole('alertdialog', { name: 'この記事の公開を止めますか？' });
    await expect(stop).toContainText('架空のAI技術選定ノート');
    await expect(stop).toContainText('もう一度公開することはできません');
    await expect(stop).toContainText('下書きは残ります');
    await expect(stop.getByRole('button', { name: '公開を止める', exact: true })).toBeEnabled();
    await stop.getByRole('button', { name: 'やめる', exact: true }).click();
    await expect(stop).toBeHidden();
    await reader.reload();
    await expect(
      reader.getByRole('heading', { name: '架空のAI技術選定ノート', exact: true }),
    ).toBeVisible();
    await stopButton.click();
    await stop.getByRole('button', { name: '公開を止める', exact: true }).click();
    await expect(stop).toBeHidden();
    await expect(page.getByText(/の公開を止めました/)).toBeVisible();
    // The list re-reads after the stop: the row is marked stopped and offers no second stop.
    const stoppedRow = records.getByRole('listitem').filter({ hasText: '架空のAI技術選定ノート' });
    await expect(stoppedRow.locator('.own-publications-state-published')).toHaveCount(0);
    await expect(stoppedRow.locator('.own-publications-state')).toBeVisible();
    await expect(stopButton).toHaveCount(0);
    await reader.reload();
    await expect(reader.getByRole('heading', { name: '記事が見つかりません' })).toBeVisible();
    await reader.goto('/');
    await expect(
      reader.getByRole('link', { name: '架空のAI技術選定ノート', exact: true }),
    ).toHaveCount(0);
    // C09: after the owner's stop the article also leaves search and the author's profile.
    await reader.goto('/search');
    await reader.getByRole('searchbox').fill('AI技術選定');
    await reader.getByRole('button', { name: '検索', exact: true }).click();
    await expect(reader).toHaveURL(/\/search\?/);
    await expect(
      reader.getByRole('heading', { name: '一致する記事・作品はありません', exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByRole('link', { name: '架空のAI技術選定ノート', exact: true }),
    ).toHaveCount(0);
    // The stopped article was this author's only publication, so the profile itself is no
    // longer public (a profile without public content is not shown), not merely the card.
    await reader.goto(authorHref!);
    await expect(
      reader.getByRole('heading', { name: '投稿者が見つかりません', exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByRole('link', { name: '架空のAI技術選定ノート', exact: true }),
    ).toHaveCount(0);
  } finally {
    await guest.close();
  }
});

test('ordinary profile input survives cancelled SPA navigation', async ({ page }, info) => {
  await register(page, info);
  await page.getByLabel('表示名', { exact: true }).fill('未保存の架空プロフィール');
  const dialog = page.waitForEvent('dialog');
  const click = page
    .getByRole('navigation', { name: 'メイン' })
    .getByRole('link', { name: 'ホーム', exact: true })
    .click();
  await (await dialog).dismiss();
  await click;
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(page.getByLabel('表示名', { exact: true })).toHaveValue('未保存の架空プロフィール');
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
    (await completeGoogleFormPost(context.request, ORIGIN, { state, code: state })).status(),
  ).toBe(303);
  await ensureProfileByApi(context.request, ORIGIN, '架空の別アカウント');
  expect((await context.request.get(ORIGIN + '/api/private/session')).status()).toBe(200);
}

const reportReason = (page: Page) => page.getByLabel('通報理由（必須）', { exact: true });
async function openReport(page: Page, articlePath: string) {
  let privateReads = 0;
  const observe = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith('/api/private/') &&
      // The header reads the signed-in reader's own profile, icon version and notices, and the
      // like button its own state.
      ![
        '/api/private/session',
        '/api/private/reading-history',
        '/api/private/profile',
        '/api/private/profile-avatar',
        '/api/private/notifications',
      ].includes(path) &&
      !path.startsWith('/api/private/article-likes/') &&
      // The operator-only editorial review asks once; a non-operator reader gets the same 404.
      !path.startsWith('/api/private/editorial-reviews/')
    )
      privateReads++;
  };
  const editorialStatuses: number[] = [];
  const observeEditorial = (response: import('@playwright/test').Response) => {
    if (new URL(response.url()).pathname.startsWith('/api/private/editorial-reviews/'))
      editorialStatuses.push(response.status());
  };
  page.on('request', observe);
  page.on('response', observeEditorial);
  await page.goto(articlePath);
  await expect(page.locator('.prose')).toContainText('この文章は公開する保存版です。');
  expect(privateReads).toBe(0);
  await expect.poll(() => editorialStatuses).toEqual([404]);
  await expect(page.getByRole('region', { name: /編集レビュー/ })).toHaveCount(0);
  await chooseReport(page, '記事');
  await expect(reportReason(page)).toBeEditable();
  page.off('request', observe);
  page.off('response', observeEditorial);
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
  await reportDialog(page, '記事').screenshot({
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
  await reportDialog(page, '記事').screenshot({
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
  // Finish the unrelated best-effort history attempt before holding the report's
  // initial proof. A history transport failure must not weaken report isolation.
  await page.route('**/api/private/reading-history', (route) => route.abort('blockedbyclient'));
  const historyFailed = page.waitForEvent('requestfailed', {
    predicate: (request) =>
      new URL(request.url()).pathname === '/api/private/reading-history' &&
      request.method() === 'PUT',
  });
  await page.goto(articlePath);
  await historyFailed;
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
    await chooseReport(page, '記事');
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

test('owner reads a temporary-hide explanation and another session cannot retain it', async ({
  page,
  browser,
}, info) => {
  const articlePath = await publishArticle(page, info, '架空の通知記事-' + info.project.name);
  const id = articlePath.split('/').at(-1)!;
  const reporters: BrowserContext[] = [];
  try {
    for (let n = 0; n < 3; n++) {
      const ctx = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
      reporters.push(ctx);
      const reporter = await ctx.newPage();
      await register(reporter, info);
      const session = await ctx.request.get('/api/private/moderation/session');
      expect(session.status()).toBe(200);
      const { csrfToken } = await session.json();
      expect(
        (
          await ctx.request.post('/api/private/reports/' + id, {
            headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + csrfToken },
            data: { reason: 'PRIVATE_REPORTER_REASON_' + n, detail: 'PRIVATE_REPORTER_DETAIL' },
          })
        ).status(),
      ).toBe(200);
    }
    // #232: the header bell shows a dot for the new notice on any page, without opening /account.
    await page.evaluate(() => localStorage.removeItem('ksh:notices-seen-at'));
    await page.goto('/');
    const bell = page.getByRole('button', { name: 'お知らせ（新しいお知らせがあります）' });
    await expect(bell).toBeVisible();
    await bell.click();
    const panel = page.getByRole('dialog', { name: 'お知らせ' });
    await expect(panel).toContainText('記事が一時非公開になりました');
    await expect(panel).toContainText('架空の通知記事-' + info.project.name);
    await expect(panel).not.toContainText('PRIVATE_REPORTER');
    await panel.screenshot({ path: info.outputPath('notifications-bell.png') });
    await panel.getByRole('link', { name: '理由と相談先をマイページで見る' }).click();
    await expect(page).toHaveURL(/\/account#notifications$/);
    // Opened once: the dot is gone, and stays gone after a reload.
    await expect(page.getByRole('button', { name: 'お知らせ', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'お知らせ', exact: true })).toBeVisible();
    const notices = page.getByRole('region', { name: '運営からのお知らせ', exact: true });
    await expect(notices).toContainText('記事が一時非公開になりました');
    await expect(notices).toContainText('架空の通知記事-' + info.project.name);
    await expect(notices).not.toContainText('PRIVATE_REPORTER');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await notices.screenshot({ path: info.outputPath('notifications-owner.png') });
    await replaceSession(page.context());
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(notices).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('架空の通知記事-' + info.project.name);
    // The bell of the new session does not carry the previous account's notice either.
    await page.getByRole('button', { name: /^お知らせ/ }).click();
    await expect(page.getByRole('dialog', { name: 'お知らせ' })).toContainText(
      'お知らせはまだありません',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '確認したアカウントを開く', exact: true }).click();
    // No notices for the newly opened account: the section stays out of the way.
    await expect(page.getByRole('heading', { name: 'プロフィール', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '運営からのお知らせ', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await Promise.all(reporters.map((ctx) => ctx.close()));
  }
});

test('ordinary author corrects an article at the same URL after saving and explicit confirmation', async ({
  page,
  browser,
}, info) => {
  const path = await publishArticle(page, info, '架空の訂正前の記事');
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await page.getByLabel('タイトル', { exact: true }).fill('架空の訂正後の記事');
  await page
    .getByLabel('Markdown本文', { exact: true })
    .fill('## 比較結果の訂正\n\n扱うデータ量を再計測し、判断を訂正しました。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    await reader.goto(path);
    await expect(
      reader.getByRole('heading', { name: '架空の訂正前の記事', exact: true }),
    ).toBeVisible();
    await composer.getByLabel('記事の概要（300文字以内）').fill('再計測した条件に基づく訂正');
    await composer.getByRole('checkbox').check();
    await composer
      .getByRole('button', { name: '確認した保存済み版で公開記事を更新', exact: true })
      .click();
    await expect(composer.locator('.publication-message')).toContainText('確認した保存済みの版 3');
    await expect(
      composer.getByRole('link', { name: 'ログインなしの読者画面を開く' }),
    ).toHaveAttribute('href', path);
    await reader.reload();
    await expect(
      reader.getByRole('heading', { name: '架空の訂正後の記事', exact: true }),
    ).toBeVisible();
    await expect(reader.locator('.prose')).toContainText(
      '扱うデータ量を再計測し、判断を訂正しました。',
    );
    await expect(reader.locator('main')).not.toContainText('この文章は公開する保存版です。');
    // #184: after an explicit revision the reader sees both the first publication and the update.
    await expect(reader.locator('.detail-dates')).toHaveText(
      /^(たった今|\d+分前) 公開 · (たった今|\d+分前) 更新 · 約\d+分$/,
    );
    await expectUnbrokenDates(reader);
    expect(
      await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await reader.screenshot({
      path: info.outputPath('article-correction-reader.png'),
      fullPage: true,
    });
    await page.screenshot({
      path: info.outputPath('article-correction-author.png'),
      fullPage: true,
    });
    await accountMenu(page, 'マイページ');
    const records = page.getByRole('region', { name: '自分の公開記録', exact: true });
    await records
      .getByRole('button', { name: '公開を止める：架空の訂正後の記事', exact: true })
      .click();
    const stop = page.getByRole('alertdialog', { name: /の公開を止めますか/ });
    await stop.getByRole('button', { name: '公開を止める', exact: true }).click();
    await expect(stop).toBeHidden();
    await expect(page.getByText(/の公開を止めました/)).toBeVisible();
    await reader.reload();
    await expect(reader.getByRole('heading', { name: '記事が見つかりません' })).toBeVisible();
  } finally {
    await guest.close();
  }
});

test('a title a reader cannot see is not saved and the editor says why (#286)', async ({
  page,
}, info) => {
  await register(page, info);
  const profile = page.getByRole('region', { name: 'プロフィールをつくる' });
  await profile.getByLabel('表示名', { exact: true }).fill('架空の学生');
  await profile.getByLabel('自己紹介', { exact: true }).fill('架空の制作プロフィール');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '記事の管理', exact: true }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  const saves: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() !== 'GET' &&
      new URL(request.url()).pathname.startsWith('/api/private/drafts')
    )
      saves.push(request.url());
  });
  // U+1D159 and the braille blank are not white space for trim(), but nothing shows on screen.
  await page.getByLabel('タイトル', { exact: true }).fill('\u{1d159}\u2800');
  await page.getByLabel('Markdown本文', { exact: true }).fill('本文は見える文字です。');
  await expect(
    page.getByRole('alert').filter({ hasText: 'タイトルには見える文字を1つ以上入れてください。' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath(`invisible-title-${info.project.name}.png`) });
  // Autosave waits 2 s; nothing is sent while the title shows nothing, and the input stays.
  await page.waitForTimeout(2600);
  expect(saves).toEqual([]);
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('\u{1d159}\u2800');
  await page.getByLabel('タイトル', { exact: true }).fill('見える題');
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
});
