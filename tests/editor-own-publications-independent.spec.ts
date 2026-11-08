import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const origin = 'https://127.0.0.1:8788',
  own = (page: Page) => page.getByRole('region', { name: '自分の公開記録' });
async function shot(locator: Locator, project: string, name: string) {
  const root = process.env.KOBE_LOCAL_EVIDENCE_DIR;
  if (!root) return;
  const dir = resolve(root, project);
  if (!dir.startsWith('/tmp/')) throw Error('Local evidence must stay under/tmp');
  await mkdir(dir, { recursive: true });
  await locator.screenshot({ path: join(dir, name), scale: 'css' });
}
async function setup(page: Page, count: number) {
  await page.goto('/lab/account');
  const prefix = '本人記録の架空公開-' + crypto.randomUUID().slice(0, 8);
  await page.evaluate(
    async ({ count, prefix }) => {
      const { csrfToken } = (await (
        await fetch('/__fixture/profile-session', { method: 'POST' })
      ).json()) as { csrfToken: string };
      async function post(path: string, value: unknown) {
        const r = await fetch(path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer csrf.' + csrfToken,
          },
          body: JSON.stringify(value),
        });
        if (!r.ok) throw Error('fictional setup failed');
        return r.json() as Promise<{ id: string; version: number }>;
      }
      await post('/api/private/profile', {
        displayName: '本人公開記録の架空投稿者',
        confirmPublic: true,
      });
      for (let n = 0; n < count; n++) {
        const title = prefix + '-' + n;
        if (n % 2) {
          const draft = await post('/api/private/project-drafts', {
            title,
            description: '架空の作品説明',
            githubUrl: '',
            demoUrl: '',
          });
          await post('/api/private/project-publications/' + draft.id, {
            expectedVersion: draft.version,
            confirmPublic: true,
          });
        } else {
          const draft = await post('/api/private/drafts', { title, body: '架空の記事本文' });
          await post('/api/private/publications/' + draft.id, {
            expectedVersion: draft.version,
            confirmPublic: true,
            summary: '架空の概要',
            tags: [],
            minutes: 1,
          });
        }
      }
    },
    { count, prefix },
  );
  await page.reload();
  await expect(own(page).getByRole('status')).toContainText(
    'このアカウントの公開記録を読み込みました',
  );
  return prefix;
}
test('independent mixed twenty-one stored publications produce one combined bounded partial own list', async ({
  page,
}, info) => {
  const prefix = await setup(page, 21);
  await expect(own(page).locator('ul > li')).toHaveCount(20);
  await expect(
    own(page).getByText('最新20件のみを表示しています。他にも公開記録があります。', {
      exact: true,
    }),
  ).toBeVisible();
  const r = await page.context().request.get('/api/private/own-publications');
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toBe('private, no-store');
  expect(Object.hasOwn(r.headers(), 'set-cookie')).toBe(false);
  const data = (await r.json()) as { publications: Record<string, unknown>[]; moreExists: boolean };
  expect(data.moreExists).toBe(true);
  expect(data.publications).toHaveLength(20);
  expect(new Set(data.publications.map((x) => x.kind))).toEqual(new Set(['article', 'project']));
  for (const row of data.publications) {
    expect(Object.keys(row).sort()).toEqual([
      'kind',
      'publicId',
      'publishedAt',
      'sourceVersion',
      'status',
      'title',
    ]);
    expect(String(row.title).startsWith(prefix)).toBe(true);
  }
  await shot(own(page), info.project.name, '01-mixed-twenty-records-partial.png');
  await own(page).getByRole('link', { name: '読者表示を確認 ↗', exact: true }).first().focus();
  await shot(
    own(page).locator('ul > li').first(),
    info.project.name,
    '02-stored-state-source-version-and-time.png',
  );
});
test('independent delayed own-record EOF cannot expose old author titles after an actual cookie scope change', async ({
  page,
}, info) => {
  const prefix = await setup(page, 1);
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('Markdown本文', { exact: true }).fill('前の本人だけの未保存入力');
  const path = origin + '/api/private/own-publications';
  let headerAt = 0,
    proofs = 0;
  page.on('response', (r) => {
    if (r.url() === path && r.request().method() === 'GET') headerAt = Date.now();
    else if (headerAt && r.url().endsWith('/api/private/session') && r.status() === 200) proofs++;
  });
  await page.route(path, (r) =>
    r.continue({ headers: { ...r.request().headers(), 'X-Lab-Body-Delay': '5000' } }),
  );
  await own(page).getByRole('button', { name: '自分の公開記録を更新', exact: true }).click();
  await expect.poll(() => proofs).toBeGreaterThan(0);
  expect(Date.now() - headerAt).toBeLessThan(4000);
  expect(
    (
      await page
        .context()
        .request.post('/__fixture/profile-session', { headers: { Origin: origin }, data: {} })
    ).status(),
  ).toBe(200);
  expect(Date.now() - headerAt).toBeLessThan(4000);
  await expect(
    page.getByText(
      '別のセッションを検出したため、前の編集画面を閉じました。セッションを再確認してから続行してください。',
      { exact: true },
    ),
  ).toBeVisible({ timeout: 10000 });
  await expect(own(page)).toHaveCount(0);
  await expect(page.getByText(prefix + '-0', { exact: true })).toHaveCount(0);
  await expect(page.locator('#draft-body')).toHaveCount(0);
  await shot(
    page.getByRole('region', { name: '既存セッションの確認' }),
    info.project.name,
    '03-delayed-old-record-scope-closed.png',
  );
  await page.unroute(path);
  await page.getByRole('button', { name: 'セッションを再確認', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }),
  ).toBeVisible();
  await expect(own(page)).toHaveCount(0);
  await page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }).click();
  await expect(own(page).getByRole('status')).toHaveText('このアカウントの公開記録はありません。');
  await expect(own(page).locator('ul > li')).toHaveCount(0);
  await expect(page.getByText(prefix + '-0', { exact: true })).toHaveCount(0);
  await shot(own(page), info.project.name, '04-new-author-empty-own-records.png');
});
