import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { bodySelection, bodyValue, expectBody, selectBody } from './helpers/body-editor';

/** C25 (#306): the body field is CodeMirror 6 and edits the Markdown string as it is. */
const body = (page: Page) => page.getByLabel('Markdown本文', { exact: true });
const save = (page: Page) => page.getByRole('button', { name: '下書きを保存', exact: true });

async function fresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('CM6-' + crypto.randomUUID().slice(0, 8));
  await body(page).click();
}

test('opening a stored draft and leaving it untouched changes neither the text nor the version', async ({
  page,
}) => {
  let csrf = '';
  await page.route('**/__fixture/session', async (route) => {
    const response = await route.fetch({ url: 'https://127.0.0.1:8788/__fixture/profile-session' });
    csrf = ((await response.json()) as { csrfToken: string }).csrfToken;
    await route.fulfill({ response });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  const raw =
    '## 手順\r\n\r\n（写真：完成した画面）\r\n\r\nhttps://www.youtube.com/watch?v=AbCdEf12345\r\n\r\n（AIメモ：ここは本人の言葉で）\r\n- 項目\r\n\t末尾  ';
  const title = 'CM6開閉の架空下書き';
  const created = await page.evaluate(
    async ({ csrf, raw, title }) => {
      const response = await fetch('/api/private/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer csrf.' + csrf },
        body: JSON.stringify({ title, body: raw }),
      });
      return (await response.json()) as { id: string; version: number };
    },
    { csrf, raw, title },
  );
  const writes: string[] = [];
  page.on('request', (request) => {
    if (['PATCH', 'PUT', 'POST'].includes(request.method()) && request.url().includes('/drafts'))
      writes.push(request.method());
  });
  await page.getByRole('button', { name: '一覧を更新', exact: true }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await expectBody(body(page), raw.replace(/\r\n/g, '\n'));
  // Focus, move the cursor and switch to the preview and back: no edit, nothing to save.
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await expect(save(page)).toBeDisabled();
  await page.waitForTimeout(500);
  expect(writes).toEqual([]);
  const stored = await page.evaluate(async (id) => {
    const response = await fetch('/api/private/drafts/' + id);
    return (await response.json()) as { body: string; version: number };
  }, created.id);
  expect(stored).toMatchObject({ body: raw, version: created.version });
});

test('Enter continues list, numbered and quote items and an empty item ends the list', async ({
  page,
}) => {
  await fresh(page);
  await page.keyboard.type('- りんご');
  await page.keyboard.press('Enter');
  await page.keyboard.type('みかん');
  await page.keyboard.press('Enter');
  await expectBody(body(page), '- りんご\n- みかん\n- ');
  // Enter on the empty item removes its marker instead of adding another one.
  await page.keyboard.press('Enter');
  await expectBody(body(page), '- りんご\n- みかん\n');
  await page.keyboard.type('1. 一つ目');
  await page.keyboard.press('Enter');
  await page.keyboard.type('二つ目');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> 引用');
  await page.keyboard.press('Enter');
  await page.keyboard.type('続き');
  await expectBody(body(page), '- りんご\n- みかん\n1. 一つ目\n2. 二つ目\n> 引用\n> 続き');
  await expect(save(page)).toBeEnabled();
});

test('selecting several lines and typing replaces them without a leftover line break', async ({
  page,
}) => {
  // @codemirror/view 6.44.1 left "X\n" here; the version is pinned in package.json until fixed.
  await fresh(page);
  await page.keyboard.type('一行目');
  await page.keyboard.press('Enter');
  await page.keyboard.type('二行目');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('X');
  await expectBody(body(page), 'X');
});

test('undo and redo, Ctrl/Cmd+B and the icon toolbar act on the body', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('最初の文');
  await page.waitForTimeout(600); // a separate undo step
  await page.keyboard.type('と続き');
  await page.keyboard.press('ControlOrMeta+z');
  await expectBody(body(page), '最初の文');
  // KeyZ, not "z": with Shift held a real keyboard sends key "Z". "Shift+z" sends key "z", which
  // CodeMirror reads as Ctrl-z (undo) on Linux, so the redo check failed only in CI (rc/5a8d172).
  await page.keyboard.press('ControlOrMeta+Shift+KeyZ');
  await expectBody(body(page), '最初の文と続き');

  await selectBody(body(page), 0, 4);
  await page.keyboard.press('ControlOrMeta+b');
  await expectBody(body(page), '**最初の文**と続き');
  expect((await bodySelection(body(page))).text).toBe('最初の文');
  await page.keyboard.press('ControlOrMeta+z');
  await expectBody(body(page), '最初の文と続き');

  const toolbar = page.getByLabel('Markdown補助', { exact: true });
  for (const name of ['見出し', '太字', 'コード', 'リンク', '箇条書き']) {
    const button = toolbar.getByRole('button', { name, exact: true });
    await expect(button).toHaveAttribute('aria-label', name);
    await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  }
  await selectBody(body(page), 0, 4);
  await toolbar.getByRole('button', { name: 'リンク', exact: true }).click();
  await expectBody(body(page), '[最初の文](https://)と続き');
  expect((await bodySelection(body(page))).text).toBe('https://');
  await expect(body(page)).toBeFocused();
  await page.keyboard.type('example.com');
  await expectBody(body(page), '[最初の文](example.com)と続き');

  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('一行目');
  await page.keyboard.press('Enter');
  await page.keyboard.type('二行目');
  const value = await bodyValue(body(page));
  await selectBody(body(page), value.indexOf('一行目'), value.length);
  await toolbar.getByRole('button', { name: '箇条書き', exact: true }).click();
  await expectBody(body(page), '[最初の文](example.com)と続き\n- 一行目\n- 二行目');
});

test('a conversion in progress blocks the toolbar and Ctrl/Cmd+B and keeps the text', async ({
  page,
}) => {
  await fresh(page);
  await page.keyboard.type('変換前の文');
  await selectBody(body(page), 0, 2);
  await body(page).dispatchEvent('compositionstart', { data: '' });
  for (const name of ['見出し', '太字', 'コード', 'リンク', '箇条書き', 'プレビュー'])
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(page.getByText('文字の変換を確定してから操作してください')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+b');
  await expectBody(body(page), '変換前の文');
  await body(page).dispatchEvent('compositionend', { data: '' });
  await expect(page.getByRole('button', { name: '太字', exact: true })).toBeEnabled();
  await selectBody(body(page), 0, 2);
  await page.keyboard.press('ControlOrMeta+b');
  await expectBody(body(page), '**変換**前の文');
});

test('the CodeMirror body passes axe and never scrolls the page sideways', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type(
    '## 見出し\n\n' + 'とても長い一行の本文'.repeat(30) + ' https://example.com/' + 'a'.repeat(120),
  );
  await expect(page.locator('.editor-body .cm-editor')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.draft-editor').analyze();
  expect(
    results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
