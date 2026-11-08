import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
async function shot(locator: Locator, project: string, name: string) {
  const root = process.env.KOBE_LOCAL_EVIDENCE_DIR;
  if (!root) return;
  const dir = resolve(root, project);
  if (!dir.startsWith('/tmp/')) throw Error('Local evidence must remain under/tmp');
  await mkdir(dir, { recursive: true });
  await locator.screenshot({ path: join(dir, name), scale: 'css' });
}
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
test('independent twenty-one work reports stay public and read-only case clearly limits to twenty', async ({
  page,
  playwright,
}, info) => {
  const target = await project(page);
  for (let n = 0; n < 21; n++) {
    const reporter = await playwright.request.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      const { csrfToken } = (await (
        await reporter.post('/__fixture/profile-session', { headers: { Origin: origin }, data: {} })
      ).json()) as { csrfToken: string };
      expect(
        (
          await reporter.post('/api/private/project-reports/' + target.id, {
            headers: { Origin: origin, Authorization: 'Bearer csrf.' + csrfToken },
            data: { reason: '上限表示の架空理由 ' + n, detail: '架空の私的な詳細' },
          })
        ).status(),
      ).toBe(201);
    } finally {
      await reporter.dispose();
    }
  }
  const publicResponse = await page.context().request.get('/__lab/projects/' + target.id);
  expect(publicResponse.status()).toBe(200);
  expect((await publicResponse.text()).includes('上限表示の架空理由')).toBe(false);
  await page.goto('/lab/projects/' + target.id);
  await expect(page.getByRole('heading', { name: target.title, exact: true })).toBeVisible();
  await shot(page.locator('main'), info.project.name, '01-many-reports-no-auto-hide.png');
  expect(
    (
      await page
        .context()
        .request.post('/__fixture/operator-session', { headers: { Origin: origin }, data: {} })
    ).status(),
  ).toBe(200);
  await page.goto('/lab/project-moderation');
  await page
    .getByRole('region', { name: '作品通報の対象一覧' })
    .getByRole('button')
    .filter({ hasText: target.title })
    .click();
  const detail = page.getByRole('region', { name: '選択した作品通報' });
  await expect(detail.getByRole('note')).toHaveText(
    '最新20件のみを表示しています。他にも受付記録があります。すべての通報を確認したことにはなりません。',
  );
  await expect(detail.locator('ol > li')).toHaveCount(20);
  await expect(
    page.getByRole('button', { name: /非公開に|復元|削除|通知を送信|判断を保存/ }),
  ).toHaveCount(0);
  await shot(detail, info.project.name, '02-readonly-case-partial-twenty.png');
  const raw = await page
    .context()
    .request.get('/api/private/project-moderation/cases/' + target.id);
  expect(raw.status()).toBe(200);
  expect(raw.headers()['cache-control']).toBe('private, no-store');
  expect(Object.hasOwn(raw.headers(), 'set-cookie')).toBe(false);
  const value = (await raw.json()) as {
    reports: Record<string, unknown>[];
    reportsTruncated: boolean;
  };
  expect(value.reportsTruncated).toBe(true);
  expect(value.reports).toHaveLength(20);
  for (const row of value.reports)
    expect(Object.keys(row).sort()).toEqual(['detail', 'reason', 'receivedAt']);
  expect(
    (
      await page
        .context()
        .request.get('/api/private/project-moderation/cases/' + target.id + '?x=1')
    ).status(),
  ).toBe(404);
});
test('independent unknown proof resumes same reason while confirmed invalid proof discards private report state', async ({
  page,
}, info) => {
  const target = await project(page);
  const csrf = await fresh(page);
  await page.goto('/lab/projects/' + target.id);
  await prepare(page);
  const reason = panel(page).getByLabel('作品の通報理由（必須）', { exact: true });
  await reason.fill('同じ本人だけに保持する未送信理由');
  await reason.evaluate((e) => {
    (e as HTMLTextAreaElement & { __qaSame?: boolean }).__qaSame = true;
  });
  let status = 503;
  await page.route('**/api/private/session', (r) =>
    r.fulfill({
      status,
      contentType: 'application/json',
      body: '{"error":"synthetic_scope_check"}',
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(reason).toBeHidden();
  expect(await reason.count()).toBe(1);
  expect(await reason.inputValue()).toBe('同じ本人だけに保持する未送信理由');
  expect(
    await panel(page)
      .locator('.project-private-scope')
      .evaluate((e) => (e as HTMLElement).inert),
  ).toBe(true);
  await page.unroute('**/api/private/session');
  await panel(page).getByRole('button', { name: '作品通報の準備を確認', exact: true }).click();
  await expect(reason).toBeVisible();
  expect(
    await reason.evaluate((e) =>
      Boolean((e as HTMLTextAreaElement & { __qaSame?: boolean }).__qaSame),
    ),
  ).toBe(true);
  for (let n = 0; n < 2; n++) {
    await panel(page).getByRole('button', { name: '作品通報の準備を確認', exact: true }).click();
    await expect(reason).toBeVisible();
    expect(
      await panel(page)
        .locator('.project-private-scope')
        .evaluate((e) => (e as HTMLElement).inert),
    ).toBe(false);
  }
  await shot(panel(page), info.project.name, '03-same-session-reason-retained.png');
  expect(
    (
      await page
        .context()
        .request.post('/api/private/logout', {
          headers: { Origin: origin, Authorization: 'Bearer csrf.' + csrf },
        })
    ).status(),
  ).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    panel(page).getByText(/現在ログインしていません。前の入力・通報内容は閉じています/),
  ).toBeVisible();
  await expect(reason).toHaveCount(0);
  await shot(panel(page), info.project.name, '04-confirmed-invalid-private-reason-cleared.png');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
