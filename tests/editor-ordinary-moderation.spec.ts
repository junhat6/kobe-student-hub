import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
const ORIGIN = 'https://127.0.0.1:8788';
async function context(browser: Browser) {
  return browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
}
async function student(ctx: BrowserContext) {
  const response = await ctx.request.post('/__fixture/profile-session', {
    headers: { Origin: ORIGIN },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}
async function post(ctx: BrowserContext, path: string, csrf: string, data: unknown) {
  return ctx.request.post(path, {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + csrf },
    data,
  });
}
async function setup(browser: Browser, reports = 3) {
  const contexts: BrowserContext[] = [];
  const author = await context(browser);
  contexts.push(author);
  const csrf = await student(author);
  expect(
    (
      await post(author, '/api/private/profile', csrf, {
        displayName: '架空の著者',
        department: '',
        yearLabel: '',
        bio: '',
        confirmPublic: true,
      })
    ).status(),
  ).toBe(201);
  const title = '運営確認の架空記事-' + crypto.randomUUID().slice(0, 8);
  const draft = await post(author, '/api/private/drafts', csrf, {
    title,
    body: '# 保存した本文\n\n運営が確認する架空の本文です。',
  });
  const draftId = ((await draft.json()) as { id: string }).id;
  const publication = await post(author, '/api/private/publications/' + draftId, csrf, {
    expectedVersion: 1,
    confirmPublic: true,
    summary: '架空の検証記事',
    tags: [],
    minutes: 1,
  });
  expect(publication.status()).toBe(201);
  const id = ((await publication.json()) as { contentId: string }).contentId;
  const reporters: { ctx: BrowserContext; csrf: string }[] = [];
  for (let n = 0; n < reports; n++) {
    const ctx = await context(browser);
    contexts.push(ctx);
    const token = await student(ctx);
    expect(
      (
        await post(ctx, '/api/private/reports/' + id, token, {
          reason: '架空の通報理由' + n,
          detail: '架空の非公開詳細',
        })
      ).status(),
    ).toBe(200);
    reporters.push({ ctx, csrf: token });
  }
  return { id, title, reporters, contexts };
}
async function operator(page: Page, destination = '/moderation') {
  expect(
    (
      await page.request.post('/__fixture/operator-session', { headers: { Origin: ORIGIN } })
    ).status(),
  ).toBe(200);
  await page.goto(destination);
  await expect(
    page.getByText('セッションと運営権限を確認しました。各判断でもサーバーが権限を確認します。', {
      exact: true,
    }),
  ).toBeVisible();
}
async function select(page: Page, title: string) {
  await page.locator('.moderation-queue button').filter({ hasText: title }).click();
  await expect(page.getByRole('region', { name: '運営判断', exact: true })).toBeVisible();
}
async function confirm(page: Page, action: '復元' | '削除', reason: string) {
  const form = page.getByRole('region', { name: '運営判断', exact: true });
  await form.getByLabel('判断の理由 必須', { exact: true }).fill(reason);
  await form.getByRole('button', { name: action + 'を確認', exact: true }).click();
  await expect(
    form.getByRole('button', { name: '確認した内容で' + action, exact: true }),
  ).toBeDisabled();
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: '確認した内容で' + action, exact: true }).click();
}
test('ordinary operator reviews a case, explicitly restores, receives a new report round, and soft-deletes', async ({
  page,
  browser,
}, info) => {
  const target = await setup(browser);
  try {
    await operator(page);
    await select(page, target.title);
    await page.getByText('対象の記事本文を確認', { exact: true }).click();
    await expect(page.locator('.moderation-article')).toContainText(
      '運営が確認する架空の本文です。',
    );
    let posts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/decision')) posts++;
    });
    const form = page.getByRole('region', { name: '運営判断', exact: true });
    await form
      .getByLabel('判断の理由 必須', { exact: true })
      .fill('本文と通報を確認し、公開を継続できると判断しました。');
    await form.getByRole('button', { name: '復元を確認', exact: true }).click();
    expect(posts).toBe(0);
    await expect(form).toContainText(target.title);
    await page.screenshot({ path: info.outputPath('01-confirm-restore.png'), fullPage: true });
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: '確認した内容で復元', exact: true }).click();
    await expect(page.getByRole('region', { name: '判断結果', exact: true })).toContainText(
      '復元の記録を確認しました',
    );
    expect(posts).toBe(1);
    for (const reporter of target.reporters)
      expect(
        (
          await post(reporter.ctx, '/api/private/reports/' + target.id, reporter.csrf, {
            reason: '復元後の架空の通報',
            detail: '',
          })
        ).status(),
      ).toBe(200);
    await page.getByRole('button', { name: '一覧を再確認', exact: true }).click();
    await select(page, target.title);
    await confirm(page, '削除', '新しい通報内容も確認し、公開表示から削除します。');
    await expect(page.getByRole('region', { name: '判断結果', exact: true })).toContainText(
      '削除の記録を確認しました',
    );
    await expect(page.getByRole('region', { name: '判断結果', exact: true })).toContainText(
      '本人のお知らせ欄に説明を記録しました',
    );
    expect(posts).toBe(2);
    await page.screenshot({
      path: info.outputPath('02-deleted-author-notice.png'),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await Promise.all(target.contexts.map((ctx) => ctx.close()));
  }
});
test('unknown result retains the exact reason and reconciles by GET without reposting', async ({
  page,
  browser,
}, info) => {
  const target = await setup(browser);
  try {
    await operator(page);
    await select(page, target.title);
    let posts = 0;
    await page.route(
      '**/api/private/moderation/cases/' + target.id + '/decision',
      async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        posts++;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort('failed');
      },
    );
    const reason = '結果不明でも保持する架空の判断理由';
    await confirm(page, '復元', reason);
    const form = page.getByRole('region', { name: '運営判断', exact: true });
    await expect(form).not.toBeVisible();
    await page.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
    await expect(form).toContainText('自動再送はしません');
    await expect(form).toContainText(reason);
    await expect(form.getByRole('button', { name: '同じ判断を再送', exact: true })).toBeDisabled();
    await page.screenshot({
      path: info.outputPath('03-unknown-reason-retained.png'),
      fullPage: true,
    });
    expect(posts).toBe(1);
    await form.getByRole('button', { name: '判断の記録を再確認', exact: true }).click();
    await expect(page.getByRole('region', { name: '判断結果', exact: true })).toContainText(
      '復元の記録を確認しました',
    );
    expect(posts).toBe(1);
  } finally {
    await Promise.all(target.contexts.map((ctx) => ctx.close()));
  }
});
test('actor change discards the previous case, reason and command; ordinary students cannot admit themselves', async ({
  page,
  browser,
}) => {
  const target = await setup(browser);
  try {
    await operator(page);
    await select(page, target.title);
    const form = page.getByRole('region', { name: '運営判断', exact: true });
    await form.getByLabel('判断の理由 必須', { exact: true }).fill('ACTOR_PRIVATE_REASON');
    await student(page.context());
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await expect(form).not.toBeVisible();
    await page.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
    await expect(
      page.getByText(
        'セッションまたは運営権限を確認できませんでした。通報内容と入力は表示しません。運営セッションを再確認してください。',
        { exact: true },
      ),
    ).toBeVisible();
    expect(await page.locator('textarea').count()).toBe(0);
    await expect(page.locator('body')).not.toContainText('ACTOR_PRIVATE_REASON');
    await expect(page.locator('body')).not.toContainText(target.title);
    expect(
      (
        await page.request.get('/api/private/moderation/cases', {
          headers: { 'X-Operator': 'editor-operator', 'X-Email': 'operator@example.invalid' },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await Promise.all(target.contexts.map((ctx) => ctx.close()));
  }
});

// A concurrent restore followed by three reports can return the same status/count
// for a newer round. The old detail must not become evidence for that round.
test('a new decision round with the same status and count rejects old case details', async ({
  page,
  browser,
}) => {
  const target = await setup(browser);
  try {
    await operator(page);
    const decisionPath = '/api/private/moderation/cases/' + target.id + '/decision';
    let caseRequested = false;
    let stateReads = 0;
    let posts = 0;
    await page.route('**/api/private/moderation/cases/' + target.id, async (route) => {
      caseRequested = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({ response });
    });
    await page.route('**' + decisionPath, async (route) => {
      if (route.request().method() !== 'GET') {
        posts++;
        return route.abort();
      }
      stateReads++;
      // The restored-and-reported round begins after the old case request starts.
      // These are synthetic version proofs; the server/session fixture stays real.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contentId: target.id,
          round: caseRequested ? 2 : 1,
          version: caseRequested ? 7 : 3,
          status: 'hidden',
          reportCount: 3,
        }),
      });
    });
    await page.locator('.moderation-queue button').filter({ hasText: target.title }).click();
    await expect(
      page.getByText(
        'この対象の通報内容を確認できませんでした。古い表示を残さず、未確認として扱います。',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: '運営判断', exact: true })).not.toBeVisible();
    await expect(page.locator('.moderation-reports')).toHaveCount(0);
    await expect(page.locator('.moderation-article')).toHaveCount(0);
    expect(caseRequested).toBe(true);
    expect(stateReads).toBe(2);
    expect(posts).toBe(0);
  } finally {
    await Promise.all(target.contexts.map((ctx) => ctx.close()));
  }
});

test('protected email link selects its case only after operator verification and exposes pending delivery separately', async ({
  page,
  browser,
}, info) => {
  const target = await setup(browser);
  try {
    let decisions = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/decision')) decisions++;
    });
    await operator(page, '/moderation?case=' + target.id);
    await expect(
      page
        .getByRole('region', { name: '選択した通報内容', exact: true })
        .getByRole('heading', { name: target.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('判断の理由 必須', { exact: true })).toHaveValue('');
    expect(decisions).toBe(0);
    const mail = page.getByRole('region', { name: '運営メールの配送', exact: true });
    await mail.getByRole('button', { name: '配送状態を確認', exact: true }).click();
    const selected = mail
      .locator('li')
      .filter({ has: page.locator('a[href="/moderation?case=' + target.id + '"]') });
    await expect(selected).toHaveCount(3);
    await expect(selected.filter({ hasText: '送信待ち' })).toHaveCount(3);
    await expect(
      mail.getByRole('button', { name: 'この未受理通知の再送を確認', exact: true }),
    ).toHaveCount(0);
    expect(decisions).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('notifications-operator.png'), fullPage: true });
  } finally {
    await Promise.all(target.contexts.map((ctx) => ctx.close()));
  }
});
