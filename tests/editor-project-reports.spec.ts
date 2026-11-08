import { test, expect, type Page } from '@playwright/test';
const origin = 'https://127.0.0.1:8788';
async function fresh(page: Page) {
  return page.evaluate(async () => {
    const r = await fetch('/__fixture/profile-session', { method: 'POST' });
    return ((await r.json()) as { csrfToken: string }).csrfToken;
  });
}
async function project(page: Page) {
  await page.goto('/lab/projects/00000000-0000-4000-8000-000000000000');
  const csrf = await fresh(page);
  return page.evaluate(async (csrf) => {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer csrf.' + csrf };
    async function post(path: string, value: unknown) {
      const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(value) });
      if (r.status !== 201) throw Error('project fixture failed');
      return r.json() as Promise<{ id: string; version: number; projectId: string }>;
    }
    await post('/api/private/profile', { displayName: '架空の作品投稿者', confirmPublic: true });
    const title = '通報確認の架空作品 ' + crypto.randomUUID().slice(0, 8);
    const d = await post('/api/private/project-drafts', {
      title,
      description: '作品の公開説明',
      githubUrl: '',
      demoUrl: '',
    });
    const p = await post('/api/private/project-publications/' + d.id, {
      expectedVersion: d.version,
      confirmPublic: true,
    });
    return { id: p.projectId, title };
  }, csrf);
}
const panel = (page: Page) => page.getByRole('region', { name: '作品の通報' });
async function prepare(page: Page) {
  await panel(page).getByRole('button', { name: '作品通報の準備を確認', exact: true }).click();
  const proceed = panel(page).getByRole('button', {
    name: '確認したセッションで通報画面を開く',
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await proceed.isVisible()) ||
        (await panel(page)
          .getByText(/このセッションの受付はまだありません/)
          .isVisible()),
    )
    .toBe(true);
  if (await proceed.isVisible()) await proceed.click();
  await expect(panel(page).getByText(/このセッションの受付はまだありません/)).toBeVisible();
}
async function input(page: Page, reason = '架空の通報理由') {
  await panel(page).getByLabel('作品の通報理由（必須）', { exact: true }).fill(reason);
  await panel(page).getByLabel('作品の通報詳細（任意）', { exact: true }).fill('非公開の架空詳細');
  await panel(page)
    .getByRole('checkbox', {
      name: '入力した理由・詳細を、この作品の通報として運営確認用に送信します',
      exact: true,
    })
    .check();
}
const received =
  'このアカウントの受付記録を確認しました。理由の一致や通知・非公開化・判断の確認ではありません。';
test('explicit project report stays private and a trusted read-only operator can inspect the saved record', async ({
  page,
}) => {
  const target = await project(page);
  await fresh(page);
  let privateCalls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/private/') || r.url().includes('/__fixture/')) privateCalls++;
  });
  await page.goto('/lab/projects/' + target.id);
  await expect(page.getByRole('heading', { name: target.title, exact: true })).toBeVisible();
  expect(privateCalls).toBe(0);
  const reason = '<script>window.projectReportInjected=true</script>';
  await prepare(page);
  await input(page, reason);
  await panel(page).getByRole('button', { name: '確認した作品通報を送信', exact: true }).click();
  await expect(panel(page).getByRole('status')).toHaveText(received);
  const publicResult = await page.evaluate(async (id) => {
    const r = await fetch('/__lab/projects/' + id, { credentials: 'omit' });
    return { status: r.status, text: await r.text() };
  }, target.id);
  expect(publicResult.status).toBe(200);
  expect(publicResult.text.includes(reason)).toBe(false);
  expect(publicResult.text.includes('非公開の架空詳細')).toBe(false);
  await page.evaluate(async () => {
    const r = await fetch('/__fixture/operator-session', { method: 'POST' });
    if (r.status !== 200) throw Error('operator fixture failed');
  });
  await page.goto('/lab/project-moderation');
  const queue = page.getByRole('region', { name: '作品通報の対象一覧' });
  await queue.getByRole('button').filter({ hasText: target.title }).click();
  const detail = page.getByRole('region', { name: '選択した作品通報' });
  await expect(detail.getByText(reason, { exact: true })).toBeVisible();
  await expect(detail.getByText('非公開の架空詳細', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => 'projectReportInjected' in window)).toBe(false);
  await expect(page.getByRole('button', { name: /復元|削除|通知を送信|非公開に/ })).toHaveCount(0);
  await page.route('**/api/private/project-moderation/cases/*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"PRIVATE_ERROR"}',
    }),
  );
  await queue.getByRole('button').filter({ hasText: target.title }).click();
  await expect(detail.getByText(reason, { exact: true })).toHaveCount(0);
  await expect(page.getByText('PRIVATE_ERROR')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('通報を確認できませんでした');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('a committed report with a lost response keeps its input and reconciles only through a manual receipt', async ({
  page,
}) => {
  const target = await project(page);
  await fresh(page);
  await page.goto('/lab/projects/' + target.id);
  await prepare(page);
  await input(page);
  let posts = 0;
  await page.route('**/api/private/project-reports/*', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      const r = await route.fetch();
      expect(r.status()).toBe(201);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"synthetic_lost_ack"}',
      });
    } else await route.continue();
  });
  await panel(page).getByRole('button', { name: '確認した作品通報を送信', exact: true }).click();
  await expect(panel(page).getByRole('status')).toContainText('送信結果を確認できませんでした');
  await expect(panel(page).getByLabel('作品の通報理由（必須）', { exact: true })).toHaveValue(
    '架空の通報理由',
  );
  await expect(
    panel(page).getByRole('button', { name: '確認した作品通報を送信', exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await panel(page).getByRole('button', { name: '作品通報の受付を確認', exact: true }).click();
  await expect(panel(page).getByRole('status')).toHaveText(received);
  await expect(panel(page).getByLabel('作品の通報理由（必須）', { exact: true })).toHaveValue(
    '架空の通報理由',
  );
  expect(posts).toBe(1);
});
test('a changed session cannot consume an old report acknowledgement or retain previous private input', async ({
  page,
}) => {
  const target = await project(page);
  await fresh(page);
  await page.goto('/lab/projects/' + target.id);
  await prepare(page);
  await input(page, '読者Aだけの私的入力');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed = false;
  await page.route('**/api/private/project-reports/*', async (route) => {
    if (route.request().method() === 'POST') {
      const r = await route.fetch();
      expect(r.status()).toBe(201);
      committed = true;
      await gate;
      await route.fulfill({ response: r });
    } else await route.continue();
  });
  await panel(page).getByRole('button', { name: '確認した作品通報を送信', exact: true }).click();
  await expect.poll(() => committed).toBe(true);
  await fresh(page);
  release();
  await expect(panel(page).getByText(/セッションが無効または変更されたため/)).toBeVisible();
  await expect(panel(page).getByLabel('作品の通報理由（必須）', { exact: true })).toHaveCount(0);
  await prepare(page);
  await expect(panel(page).getByLabel('作品の通報理由（必須）', { exact: true })).toHaveValue('');
  await page.goto('/lab/project-moderation');
  await expect(page.getByRole('status')).toContainText('通報を確認できませんでした');
  await expect(page.getByText('読者Aだけの私的入力', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: '作品通報の対象一覧' }).getByRole('button'),
  ).toHaveCount(0);
});

test('same-session focus and an unavailable proof keep private report input hidden then resume without remounting', async ({
  page,
}) => {
  const target = await project(page);
  await fresh(page);
  await page.goto('/lab/projects/' + target.id);
  await prepare(page);
  const reason = panel(page).getByLabel('作品の通報理由（必須）', { exact: true });
  await reason.fill('同じセッションで保持する未送信の理由');
  await reason.evaluate((element) => {
    (element as HTMLTextAreaElement & { __same?: boolean }).__same = true;
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    panel(page).getByText(
      '同じセッションを確認しました。保持した入力・通報内容を再開しています。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(reason).toHaveValue('同じセッションで保持する未送信の理由');
  for (let repeat = 0; repeat < 2; repeat++) {
    await panel(page).getByRole('button', { name: '作品通報の準備を確認', exact: true }).click();
    await expect(reason).toBeVisible();
    expect(
      await panel(page)
        .locator('.project-private-scope')
        .evaluate((element) => (element as HTMLElement).inert),
    ).toBe(false);
    expect(
      await reason.evaluate((element) =>
        Boolean((element as HTMLTextAreaElement & { __same?: boolean }).__same),
      ),
    ).toBe(true);
  }
  await page.route('**/api/private/session', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_unverified"}',
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel(page).getByText(/メモリに保持したまま隠しています/)).toBeVisible();
  await expect(reason).toBeHidden();
  expect(await reason.count()).toBe(1);
  await page.unroute('**/api/private/session');
  await panel(page).getByRole('button', { name: '作品通報の準備を確認', exact: true }).click();
  await expect(reason).toBeVisible();
  await expect(reason).toHaveValue('同じセッションで保持する未送信の理由');
  expect(
    await reason.evaluate((element) =>
      Boolean((element as HTMLTextAreaElement & { __same?: boolean }).__same),
    ),
  ).toBe(true);
});
