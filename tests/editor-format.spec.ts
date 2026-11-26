import { bodySelection, bodyValue, expectBody, selectBody } from './helpers/body-editor';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function open(page: Page, source: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page
    .getByLabel('タイトル', { exact: true })
    .fill('補助操作-' + crypto.randomUUID().slice(0, 8));
  const body = page.getByLabel('Markdown本文', { exact: true });
  await body.fill(source);
  return body;
}
const select = (page: Page, start: number, end: number) =>
  selectBody(page.getByLabel('Markdown本文', { exact: true }), start, end);
const selected = (page: Page) => bodySelection(page.getByLabel('Markdown本文', { exact: true }));
test('keyboard heading formatting creates an actual heading at logical line boundaries and restores selection', async ({
  page,
}) => {
  const source = '前の段落\nalpha chosen omega\n後の段落';
  const body = await open(page, source);
  const start = source.indexOf('chosen');
  await select(page, start, start + 6);
  const heading = page.getByRole('button', { name: '見出し', exact: true });
  await heading.focus();
  await heading.press('Enter');
  await expectBody(body, '前の段落\n## alpha chosen omega\n後の段落');
  await expect(body).toBeFocused();
  expect(await selected(page)).toEqual({ text: 'chosen', start: start + 3, end: start + 9 });
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await expect(page.locator('.editor-preview h2')).toHaveText('alpha chosen omega');
  await expect(page.locator('.editor-preview')).toContainText('前の段落');
  await expect(page.locator('.editor-preview')).toContainText('後の段落');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('code formatting retains nested backticks inside one block and restores the selected payload for mouse or touch', async ({
  page,
}) => {
  const source = 'before\nalpha\n```\nbeta\nafter';
  const body = await open(page, source);
  const start = source.indexOf('alpha'),
    end = source.indexOf('\nafter');
  await select(page, start, end);
  const code = page.getByRole('button', { name: 'コード', exact: true });
  if (test.info().project.use.hasTouch) await code.tap();
  else await code.click();
  await expectBody(body, 'before\n````\nalpha\n```\nbeta\n````\nafter');
  await expect(body).toBeFocused();
  expect((await selected(page)).text).toBe('alpha\n```\nbeta');
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await expect(page.locator('.editor-preview pre')).toHaveCount(1);
  await expect(page.locator('.editor-preview pre')).toHaveText('alpha\n```\nbeta\n', {
    useInnerText: false,
  });
  await expect(page.locator('.editor-preview')).toContainText('before');
  await expect(page.locator('.editor-preview')).toContainText('after');
});
test('formatting remains an edit during a pending save and synthetic composition cannot invoke helpers or unmount the field', async ({
  page,
}) => {
  const body = await open(page, 'snapshot before save');
  let release: () => void = () => {},
    started: () => void = () => {};
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      started = resolve;
    });
  let saves = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (['PATCH', 'PUT'].includes(route.request().method())) {
      saves++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      started();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await ready;
  await body.fill('one chosen two');
  await select(page, 4, 10);
  await page.getByRole('button', { name: '太字', exact: true }).click();
  await expectBody(body, 'one **chosen** two');
  release();
  await expect(page.getByRole('status')).toHaveText(
    '送信した版を保存しました。新しい変更はまだ未保存です。',
  );
  await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeEnabled();
  expect(saves).toBe(1);
  await body.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '変換中' }),
    );
    document
      .querySelectorAll('.editor-format button')[1]
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document
      .querySelectorAll('.editor-tabs button')[1]
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  for (const name of ['見出し', '太字', 'コード', 'プレビュー'])
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(body).toBeVisible();
  await expectBody(body, 'one **chosen** two');
  await body.dispatchEvent('compositionend', { data: '確定' });
  for (const name of ['見出し', '太字', 'コード', 'プレビュー'])
    await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
  await body.fill('確定した入力');
  await select(page, 2, 2);
  await page.getByRole('button', { name: '見出し', exact: true }).click();
  await expectBody(body, '## 確定した入力');
  await expect(body).toBeFocused();
  expect(saves).toBe(1);
});
test('helper edits preserve all text when crossing the UTF8 save limit and never autosave', async ({
  page,
}) => {
  const source = 'あ'.repeat(87380);
  const body = await open(page, source);
  let saves = 0;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/private/drafts/') &&
      ['PATCH', 'PUT'].includes(request.method())
    )
      saves++;
  });
  await select(page, 0, source.length);
  await page.getByRole('button', { name: '太字', exact: true }).click();
  expect(new TextEncoder().encode(await bodyValue(body)).byteLength).toBe(262144);
  await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeEnabled();
  const length = (await bodyValue(body)).length;
  await select(page, 0, length);
  await page.getByRole('button', { name: '太字', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('本文の容量が上限の256 KiBを超えています。');
  await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeDisabled();
  const value = await bodyValue(body);
  expect({
    bytes: new TextEncoder().encode(value).byteLength,
    characters: value.split('あ').length - 1,
  }).toEqual({ bytes: 262148, characters: 87380 });
  expect(saves).toBe(0);
});
test('the title counter sits beside the title and the body footer only shows the body size', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  const title = page.getByLabel('タイトル', { exact: true });
  await title.fill('数える題名');
  await expect(title).toHaveAccessibleDescription('5/200文字');
  const counter = page.locator('#draft-title-count');
  const titleBox = await title.boundingBox();
  const counterBox = await counter.boundingBox();
  expect(counterBox && titleBox && counterBox.y < titleBox.y).toBe(true);
  await page.getByLabel('Markdown本文', { exact: true }).fill('本文');
  const footer = page.locator('.editor-writing-footer');
  await expect(footer).toContainText('本文の容量 0.0/256 KiB');
  await expect(footer).not.toContainText('文字');
});
test('a long title wraps whole, grows with its lines and stays one line of text (#281)', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  const title = page.getByLabel('タイトル', { exact: true });
  await title.fill('短い題');
  const oneLine = (await title.boundingBox())!.height;
  const long =
    '架空の記事タイトル：Gitのブランチ運用で迷ったことと、チームで決めた約束ごとの話'.repeat(2);
  await title.fill(long);
  // Every character is visible: nothing scrolls inside the field, and it grew instead.
  const fit = await title.evaluate((element) => ({
    clipped: element.scrollHeight > element.clientHeight + 1,
    sideways: element.scrollWidth > element.clientWidth + 1,
  }));
  expect(fit).toEqual({ clipped: false, sideways: false });
  expect((await title.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5);
  // Enter adds no line break, and pasted line breaks become spaces.
  await title.press('End');
  await title.press('Enter');
  await expect(title).toHaveValue(long);
  await title.fill('一行目\n二行目\r\n三行目');
  await expect(title).toHaveValue('一行目 二行目 三行目');
  await title.fill('短い題');
  await expect.poll(async () => (await title.boundingBox())!.height).toBe(oneLine);
  await title.fill(long);
  await page.screenshot({ path: info.outputPath('long-title.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('preview links only the URL of a bare link written inside Japanese brackets and punctuation (#258)', async ({
  page,
}, info) => {
  await open(
    page,
    '下書き画面（https://example.com/drafts）にこの下書きが表示されるか\n\n参考：https://example.com/page、詳しくは次節。\n\n「https://example.com/quote」を開く',
  );
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  const preview = page.locator('.editor-preview');
  await expect(preview.locator('a')).toHaveText([
    'https://example.com/drafts',
    'https://example.com/page',
    'https://example.com/quote',
  ]);
  expect(
    await preview.locator('a').evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
  ).toEqual([
    'https://example.com/drafts',
    'https://example.com/page',
    'https://example.com/quote',
  ]);
  await expect(preview).toContainText('）にこの下書きが表示されるか');
  await preview.screenshot({ path: info.outputPath('autolink-preview.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('the AI memo note removes 「（AIメモ：…）」 and the saved version warns until it is gone (#302)', async ({
  page,
}) => {
  const source = '（AIメモ：候補（3つ）から授業の話を選んだ）\n\n## はじめに\n本文です。';
  const body = await open(page, source);
  const note = page.locator('.editor-ai-memo');
  await expect(note).toContainText('1件');
  const axe = await new AxeBuilder({ page }).include('.editor-ai-memo').analyze();
  expect(axe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.publication-ai-memo-notice')).toContainText('1件');
  await note.getByRole('button', { name: 'AIメモを消す', exact: true }).click();
  await expectBody(body, '## はじめに\n本文です。');
  await expect(note).toHaveCount(0);
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.publication-ai-memo-notice')).toHaveCount(0);
});
