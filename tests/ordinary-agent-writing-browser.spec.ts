import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { createProfileOnAccount } from './helpers/profile';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-agent-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
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
  await page.unroute(provider);
  await createProfileOnAccount(page, '架空のエージェント利用者');
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const agentFile = (key: string) =>
  [
    '---',
    `title: 架空のエージェント記事-${key}`,
    'summary: AIエージェントが書いた架空の概要です。',
    'tags: [AIエージェント, 架空]',
    'audience: 架空の読者',
    'prerequisite: なし',
    'outcome: 読み込みの流れがわかる',
    'minutes: 3',
    '---',
    '',
    `# 架空のエージェント記事-${key}`,
    '',
    '## 試したこと',
    '',
    'AGENT_IMPORTED_BODY',
  ].join('\n');

test('a student hands the draft to their own agent, imports its file, and publishes after review', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await register(page, info);
  const AGENT_FILE = agentFile(info.project.name);
  await page.goto('/drafts');
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('自分で書き始めたタイトル');
  await page.getByLabel('Markdown本文', { exact: true }).fill('MY_OWN_START');

  // 1. The copied request carries the rules, the file format and the current draft.
  await page.locator('summary', { hasText: '自分のAIエージェントと書く' }).click();
  await page.getByRole('button', { name: '依頼文をコピー', exact: true }).click();
  await expect(page.locator('.agent-panel [role="status"]')).toHaveText('コピーしました');
  const request = await page.evaluate(() => navigator.clipboard.readText());
  expect(request).toContain('## 守ること');
  expect(request).toContain('minutes:');
  expect(request).toContain('MY_OWN_START');
  expect(await noHorizontalScroll(page)).toBe(true);

  // 2. Nothing changes until the student checks the parsed content and applies it.
  await page.getByLabel('AIの出力', { exact: true }).fill(AGENT_FILE);
  await page.getByRole('button', { name: '内容を確認', exact: true }).click();
  const check = page.getByRole('region', { name: '読み込む内容の確認' });
  await expect(check).toContainText('架空のエージェント記事');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(
    '自分で書き始めたタイトル',
  );
  await check.getByRole('button', { name: '下書きに反映', exact: true }).click();
  await expect(page.locator('.editor-preview')).toContainText('AGENT_IMPORTED_BODY');
  // The duplicated `# title` heading is dropped from the body.
  await expect(page.locator('.editor-preview h1')).toHaveCount(0);

  // 3. The import can be undone while the student is reviewing.
  await page.getByRole('button', { name: '反映する前の文章に戻す', exact: true }).click();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(
    '自分で書き始めたタイトル',
  );
  await expect(page.getByLabel('Markdown本文', { exact: true })).toHaveValue('MY_OWN_START');

  // 4. Apply again and keep it with the ordinary save.
  await page.getByLabel('AIの出力', { exact: true }).fill(AGENT_FILE);
  await page.getByRole('button', { name: '内容を確認', exact: true }).click();
  await check.getByRole('button', { name: '下書きに反映', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み', { timeout: 15000 });
  await page.screenshot({ path: info.outputPath('agent-import.png'), fullPage: true });
  // Applying and saving keep it a private draft: nothing reaches the public list.
  const beforePublish = await page.request.get('/api/articles');
  expect(beforePublish.status()).toBe(200);
  expect(await beforePublish.text()).not.toContain('AGENT_IMPORTED_BODY');
  expect(await beforePublish.text()).not.toContain('架空のエージェント記事-' + info.project.name);

  // 5. The reader-facing fields come from the file only when the student asks.
  await page.getByText('記事を公開する', { exact: true }).click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  const summary = composer.getByLabel('記事の概要（300文字以内）');
  await expect(summary).toHaveValue('');
  await expect(composer.getByLabel('タグ（カンマ区切り、5件まで）')).toHaveValue('');
  await expect(composer.getByLabel('想定読者（任意）')).toHaveValue('');
  await composer.getByRole('button', { name: 'AIの出力から入れる', exact: true }).click();
  await expect(summary).toHaveValue('AIエージェントが書いた架空の概要です。');
  await expect(composer.getByLabel('タグ（カンマ区切り、5件まで）')).toHaveValue(
    'AIエージェント, 架空',
  );
  await expect(composer.getByLabel('想定読者（任意）')).toHaveValue('架空の読者');
  await expect(composer.getByLabel('読了時間の目安（分）')).toHaveValue('3');
  await composer.getByRole('checkbox').check();
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  const publicLink = composer.getByRole('link', { name: 'ログインなしの読者画面を開く' });
  await expect(publicLink).toBeVisible();
  const articlePath = (await publicLink.getAttribute('href'))!;

  // A later unpublished edit stays in the private draft and never reaches the reader's copy.
  await page.getByRole('button', { name: '編集', exact: true }).click();
  const body = page.getByLabel('Markdown本文', { exact: true });
  await body.fill((await body.inputValue()) + '\n\nDRAFT_ONLY_AFTER_PUBLISH');
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み', { timeout: 15000 });

  // 6. A reader can hand the published article to their own agent as Markdown with its source.
  await page.goto(articlePath);
  await page.getByRole('button', { name: /AIに渡す/ }).click();
  await expect(page.locator('.agent-handoff [role="status"]')).toHaveText('コピーしました');
  const handed = await page.evaluate(() => navigator.clipboard.readText());
  expect(handed).toContain('# 架空のエージェント記事');
  expect(handed).toContain(ORIGIN + articlePath);
  expect(handed).toContain('- 想定読者: 架空の読者');
  expect(handed).toContain('AGENT_IMPORTED_BODY');
  // Only the public DTO: no draft-only text, school email, account id or enrollment years.
  expect(handed).not.toContain('DRAFT_ONLY_AFTER_PUBLISH');
  expect(handed).not.toContain('@');
  expect(handed).not.toContain('fictional-agent-');
  expect(handed.replace(ORIGIN + articlePath, '')).not.toMatch(/2026|2028/);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('the agents guide and the writing kit are public', async ({ page }, info) => {
  await page.goto('/agents');
  await expect(
    page.getByRole('heading', { name: '自分のAIエージェントと使う', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('エージェントへの依頼文', { exact: true })).toContainText(
    ORIGIN + '/agent-kit/ksh-article/SKILL.md',
  );
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('agents-page.png'), fullPage: true });
  for (const path of [
    '/agent-kit/ksh-article/SKILL.md',
    '/agent-kit/ksh-article/scripts/session_index.py',
    '/llms.txt',
  ]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).not.toContain('<!doctype html>');
  }
  await page.goto('/');
  await expect(page.getByRole('link', { name: '自分のAIエージェントと使う' })).toBeVisible();
});
