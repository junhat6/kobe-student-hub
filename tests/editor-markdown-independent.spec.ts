import { bodySelection, bodyValue, expectBody, selectBody } from './helpers/body-editor';
import { test, expect } from '@playwright/test';
test('independent server-loaded CRLF selection keeps untouched source endings through heading and save', async ({
  page,
}, info) => {
  let csrf = '';
  await page.route('**/__fixture/session', async (route) => {
    const response = await route.fetch({ url: 'https://127.0.0.1:8788/__fixture/profile-session' });
    expect(response.status()).toBe(200);
    csrf = ((await response.json()) as { csrfToken: string }).csrfToken;
    await route.fulfill({ response });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  const raw = '前の行\r\nmiddle chosen tail\r\n後の行';
  const title = 'CRLF境界の架空下書き';
  const draft = await page.evaluate(
    async ({ csrf, raw, title }) => {
      const response = await fetch('/api/private/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer csrf.' + csrf },
        body: JSON.stringify({ title, body: raw }),
      });
      if (response.status !== 201) throw new Error('fixture draft unavailable');
      return (await response.json()) as { id: string };
    },
    { csrf, raw, title },
  );
  await page.getByRole('button', { name: '一覧を更新', exact: true }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  const body = page.getByLabel('Markdown本文', { exact: true });
  await expectBody(body, raw.replace(/\r\n/g, '\n'));
  {
    const value = await bodyValue(body);
    await selectBody(body, value.indexOf('middle'), value.indexOf('後の行'));
  }
  const heading = page.getByRole('button', { name: '見出し', exact: true });
  await heading.focus();
  await heading.press('Enter');
  await expectBody(body, '前の行\n## middle chosen tail\n後の行');
  expect((await bodySelection(body)).text).toBe('middle chosen tail\n');
  await page
    .getByRole('region', { name: '下書きの編集' })
    .screenshot({ path: info.outputPath('01-crlf-heading-selection.png'), scale: 'css' });
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('下書きを保存しました。');
  const stored = await page.evaluate(async (id) => {
    const response = await fetch('/api/private/drafts/' + id);
    return (await response.json()) as { body: string };
  }, draft.id);
  expect(stored.body).toBe('前の行\r\n## middle chosen tail\r\n後の行');
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await expect(page.locator('.editor-preview h2')).toHaveText('middle chosen tail');
  await expect(page.locator('.editor-preview')).toContainText('後の行');
  await page
    .locator('.editor-preview')
    .screenshot({ path: info.outputPath('02-crlf-heading-preview.png'), scale: 'css' });
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await body.fill('alpha\n```\nbeta');
  await selectBody(body, 0, (await bodyValue(body)).length);
  await page.getByRole('button', { name: 'コード', exact: true }).click();
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await expect(page.locator('.editor-preview pre code')).toHaveCount(1);
  await expect(page.locator('.editor-preview pre code')).toHaveText('alpha\n```\nbeta\n');
  await page
    .locator('.editor-preview')
    .screenshot({ path: info.outputPath('03-backtick-code-preview.png'), scale: 'css' });
});
