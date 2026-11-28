import AxeBuilder from '@axe-core/playwright';
import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { createProfileOnAccount } from './helpers/profile';
import { AGENT_MCP_RELEASE_ENABLED } from '../src/shared/agent-release';
import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

// C21 / #219: the MCP connection screens, walked in a real browser. They only exist in a build
// with the release flag open, so this spec runs exactly when the flag is flipped (and then
// gates the release CI). With the flag closed it is skipped, and the closed-gate behaviour is
// covered by tests/agent-mcp.test.ts.
test.skip(!AGENT_MCP_RELEASE_ENABLED, 'AGENT_MCP_RELEASE_ENABLED is closed');

const ORIGIN = 'https://127.0.0.1:8790';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const b64 = (buf: Buffer) => buf.toString('base64url');

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-mcp-${info.project.name}-${Date.now().toString(36)}`;
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
  await createProfileOnAccount(page, '架空のMCP利用者');
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** The agent side: dynamic registration and a PKCE authorization request, as an MCP client does. */
async function startAgent(agent: APIRequestContext, clientName: string) {
  const registered = await agent.post('/api/oauth/register', {
    data: { client_name: clientName, redirect_uris: [REDIRECT] },
  });
  expect(registered.status()).toBe(201);
  const clientId = (await registered.json()).client_id as string;
  const verifier = b64(randomBytes(32));
  const authorize =
    '/api/oauth/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: b64(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      state: 'fictional-state',
      scope: 'drafts',
      resource: ORIGIN + '/api/mcp',
    });
  return { clientId, verifier, authorize };
}

async function mcp(agent: APIRequestContext, token: string, name: string, args: object) {
  const response = await agent.post('/api/mcp', {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  return response;
}

test('a student allows their own agent, sees its draft marked, uses its suggestions with the secret notice, and revokes it', async ({
  page,
  playwright,
}, info) => {
  const agent = await playwright.request.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  await register(page, info);
  const clientName = '架空のエージェント ' + info.project.name;

  // 1. The agent asks for permission; the browser lands on the consent screen at /connect.
  const { clientId, verifier, authorize } = await startAgent(agent, clientName);
  let callback: URL | null = null;
  await page.route(REDIRECT + '**', async (route) => {
    callback = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>fictional agent</p>' });
  });
  await page.goto(authorize);
  await expect(page).toHaveURL(/\/connect\?request=[A-Za-z0-9_-]{43}$/);
  const consent = page.locator('.agent-consent');
  await expect(consent).toContainText(clientName);
  await expect(consent).toContainText('この端末のアプリ');
  // A client names itself through open registration, so the screen says hub did not make it.
  await expect(consent.getByRole('note')).toContainText(
    'このアプリは Kobe Student Hub が作ったものではありません',
  );
  await expect(consent).toContainText(
    '初めての公開・削除、公開済みの作品を直す、プロフィール・いいね・通報、ほかの人の下書き',
  );
  await expect(consent).toContainText('まだ公開していない作品の下書きを作る・読む・直す');
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('connect-consent.png'), fullPage: true });
  await page.getByRole('button', { name: '接続を許可する', exact: true }).click();
  await expect.poll(() => callback?.searchParams.get('state') ?? null).toBe('fictional-state');
  const code = callback!.searchParams.get('code')!;
  expect(callback!.searchParams.get('iss')).toBe(ORIGIN);

  const tokenResponse = await agent.post('/api/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: ORIGIN + '/api/mcp',
    },
  });
  expect(tokenResponse.status()).toBe(200);
  const token = (await tokenResponse.json()).access_token as string;

  // 2. The agent writes a private draft with a summary/tag suggestion and a secret-looking line.
  const secret = 'ghp_' + 'A'.repeat(36);
  const title = '架空のMCP下書き ' + info.project.name;
  const made = await mcp(agent, token, 'create_draft', {
    title,
    body: `## 試したこと\n\nMCP_AGENT_BODY\n\nトークン ${secret}`,
    summary: 'エージェントが提案した架空の概要です。',
    tags: ['MCP', '架空'],
  });
  expect(made.status()).toBe(200);
  const madeText = await made.text();
  expect(madeText).toContain('本文 5 行目：アクセストークン');
  expect(madeText).not.toContain(secret);
  // Nothing reaches the public list from an agent alone.
  expect(await (await page.request.get('/api/articles')).text()).not.toContain('MCP_AGENT_BODY');

  // 3. The drafts list marks the agent's draft; the publication form offers its suggestion.
  await page.goto('/drafts');
  const item = page.locator('.editor-draft-list li', { hasText: title });
  await expect(item).toContainText('AIエージェントが作成');
  expect(await noHorizontalScroll(page)).toBe(true);
  await item.getByRole('button').click();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(title);
  await page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true })
    .click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  const notice = composer.locator('.publication-secret-notice');
  await expect(notice).toContainText('公開前に確かめてください');
  await expect(notice).toContainText('アクセストークン');
  await expect(notice).not.toContainText(secret);
  const summary = composer.getByLabel('記事の概要（300文字以内）');
  await expect(summary).toHaveValue('');
  await composer.getByRole('button', { name: 'AIの出力から入れる', exact: true }).click();
  await expect(summary).toHaveValue('エージェントが提案した架空の概要です。');
  await expect(composer.getByLabel('公開されるタグ')).toHaveText('MCP架空');
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('drafts-suggestion.png'), fullPage: true });

  // 4. The account page lists the connection; revoking it stops the agent at once.
  await page.goto('/account');
  const connections = page.getByRole('region', { name: 'AIエージェントとの接続' });
  await expect(connections.locator('li', { hasText: clientName })).toContainText('許可した日');
  expect(await noHorizontalScroll(page)).toBe(true);
  await connections.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('account-connections.png'), fullPage: true });
  await connections
    .getByRole('button', { name: `${clientName}との接続を解除`, exact: true })
    .click();
  await expect(connections.getByRole('status')).toHaveText(
    `「${clientName}」との接続を解除しました。`,
  );
  await expect(connections.locator('li', { hasText: clientName })).toHaveCount(0);
  const after = await mcp(agent, token, 'list_my_drafts', {});
  expect(after.status()).toBe(401);
  await agent.dispose();
});

test('"許可しない" sends the agent back without a code and leaves no connection', async ({
  page,
  playwright,
}, info) => {
  const agent = await playwright.request.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  await register(page, info);
  const clientName = '断られる架空のエージェント ' + info.project.name;
  const { authorize } = await startAgent(agent, clientName);
  let callback: URL | null = null;
  await page.route(REDIRECT + '**', async (route) => {
    callback = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>fictional agent</p>' });
  });
  await page.goto(authorize);
  await expect(page).toHaveURL(/\/connect\?request=/);
  const consentUrl = page.url();
  await page.getByRole('button', { name: '許可しない', exact: true }).click();
  await expect.poll(() => callback?.searchParams.get('error') ?? null).toBe('access_denied');
  expect(callback!.searchParams.has('code')).toBe(false);
  await page.goto('/account');
  const connections = page.getByRole('region', { name: 'AIエージェントとの接続' });
  await expect(connections).toContainText('接続中のAIエージェントはありません');
  // A used request cannot be decided again from the same screen.
  await page.goto(consentUrl);
  await expect(page.locator('main')).toContainText('この接続の依頼は使えません');
  await agent.dispose();
});

/** Consent in the browser and a token for the agent, as in the first test, without its checks. */
async function connectAgent(page: Page, agent: APIRequestContext, clientName: string) {
  const { clientId, verifier, authorize } = await startAgent(agent, clientName);
  let callback: URL | null = null;
  await page.route(REDIRECT + '**', async (route) => {
    callback = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>fictional agent</p>' });
  });
  await page.goto(authorize);
  await page.getByRole('button', { name: '接続を許可する', exact: true }).click();
  await expect.poll(() => callback?.searchParams.get('code') ?? null).not.toBeNull();
  const tokenResponse = await agent.post('/api/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: callback!.searchParams.get('code')!,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: ORIGIN + '/api/mcp',
    },
  });
  expect(tokenResponse.status()).toBe(200);
  await page.unroute(REDIRECT + '**');
  return (await tokenResponse.json()).access_token as string;
}

async function publishDraftInApp(page: Page, title: string) {
  await page.goto('/drafts');
  const item = page.locator('.editor-draft-list li', { hasText: title });
  await expect(item).toContainText('AIエージェントが作成');
  await item.getByRole('button').click();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(title);
  await page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true })
    .click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await composer.getByLabel('記事の概要（300文字以内）').fill('架空の制作日誌');
  await composer.getByRole('checkbox').check();
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  await expect(composer.getByRole('link', { name: 'ログインなしの読者画面を開く' })).toBeVisible();
}

// #276: the student's agent reads their own projects, drafts journal entries for one of them,
// and only the student's own publication in the app puts them on the project page, by date.
test("an agent's journal drafts for the student's project appear on it only after the student publishes them", async ({
  page,
  playwright,
  browser,
}, info) => {
  const agent = await playwright.request.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  await register(page, info);
  const projectTitle = `架空の日誌つき作品-${info.project.name}`;
  await page.goto('/works/new');
  await page.getByLabel('作品タイトル', { exact: true }).fill(projectTitle);
  await page.getByLabel('作品の説明', { exact: true }).fill('架空の作品説明');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(page.getByText('保存済みです。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '作品を公開する', exact: true }).click();
  const open = page.getByRole('link', { name: 'ログインなしで作品を見る' });
  await expect(open).toBeVisible();
  const projectPath = (await open.getAttribute('href'))!;
  const projectId = projectPath.split('/').pop()!;

  const token = await connectAgent(page, agent, '架空の日誌エージェント ' + info.project.name);
  const listed = await mcp(agent, token, 'list_my_projects', {});
  expect(listed.status()).toBe(200);
  const projects = (await listed.json()).result.structuredContent.projects as {
    id: string;
    title: string;
  }[];
  expect(projects).toEqual([expect.objectContaining({ id: projectId, title: projectTitle })]);
  expect(JSON.stringify(projects)).not.toContain('@');

  const day1 = `架空のMCP日誌1日目-${info.project.name}`,
    day2 = `架空のMCP日誌2日目-${info.project.name}`;
  for (const title of [day1, day2]) {
    const made = await mcp(agent, token, 'create_draft', {
      title,
      body: '## 今日やったこと\n\n架空の制作記録です。',
      project_id: projectId,
    });
    expect((await made.json()).result.isError).toBeUndefined();
  }

  // #285: a third entry the student sees is headed for the project, and removes before publishing.
  const day3 = `架空のMCP日誌3日目-${info.project.name}`;
  const made3 = await mcp(agent, token, 'create_draft', {
    title: day3,
    body: '## 今日やったこと\n\n日誌に入れない架空の記録です。',
    project_id: projectId,
  });
  expect((await made3.json()).result.isError).toBeUndefined();
  await page.goto('/drafts');
  const item3 = page.locator('.editor-draft-list li', { hasText: day3 });
  await expect(
    item3.getByLabel(`作品「${projectTitle}」の制作日誌に入る予定`, { exact: true }),
  ).toBeVisible();
  await item3.getByRole('button').click();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(day3);
  await expect(page.locator('.editor-draft-project-line')).toContainText(
    `作品「${projectTitle}」の制作日誌に入る予定です`,
  );
  await page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true })
    .click();
  const composer3 = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  const projectNotice = composer3.getByRole('note').filter({ hasText: '制作日誌に入ります' });
  await expect(projectNotice).toContainText(`作品「${projectTitle}」の制作日誌に入ります`);
  expect(await noHorizontalScroll(page)).toBe(true);
  const { violations } = await new AxeBuilder({ page })
    .include('.agent-project-notice')
    .include('.editor-draft-list')
    .include('.editor-draft-project-line')
    .analyze();
  expect(
    violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id),
  ).toEqual([]);
  await projectNotice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('draft-project-notice.png'), fullPage: true });
  await projectNotice.getByRole('button', { name: '制作日誌に入れない', exact: true }).click();
  await expect(projectNotice).toHaveCount(0);
  await expect(page.locator('.editor-draft-project-line')).toHaveCount(0);
  await expect(item3.locator('.editor-draft-project')).toHaveCount(0);
  await composer3.getByLabel('記事の概要（300文字以内）').fill('日誌に入れない記録');
  await composer3.getByRole('checkbox').check();
  await composer3.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  await expect(composer3.getByRole('link', { name: 'ログインなしの読者画面を開く' })).toBeVisible();

  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    await reader.goto(projectPath);
    await expect(reader.getByRole('heading', { name: projectTitle })).toBeVisible();
    // Drafts are private: nothing is on the project page before the student publishes.
    await expect(reader.getByRole('link', { name: day1 })).toHaveCount(0);
    await expect(reader.getByRole('link', { name: day2 })).toHaveCount(0);
    // The entry the student removed stays out of the journal even though it is published.
    // It is still the author's public article, so the author card may link it (#312, #315).
    const journal = reader.getByRole('region', { name: '制作日誌' });
    await expect(journal.getByRole('link', { name: day3 })).toHaveCount(0);
    await expect(
      reader.getByRole('region', { name: 'つくった学生' }).getByRole('link', { name: day3 }),
    ).toHaveCount(1);

    // The student publishes day 1, then day 2, in the app; the page lists them in that order.
    await publishDraftInApp(page, day1);
    await publishDraftInApp(page, day2);
    await reader.reload();
    const section = reader.getByRole('region', { name: '制作日誌' });
    // #307: journal entries are article cards; the title links are the card links.
    await expect(section.locator('.content-card-link')).toHaveText([day1, day2]);
    await expect(section.locator('time')).toHaveCount(2);
    expect(await noHorizontalScroll(reader)).toBe(true);
    await reader.screenshot({
      path: info.outputPath('project-journal-from-agent.png'),
      fullPage: true,
    });
  } finally {
    await guest.close();
    await agent.dispose();
  }
});

test("an agent's project draft stays private and shows as the agent's in the student's saved projects (#298)", async ({
  page,
  playwright,
}, info) => {
  const agent = await playwright.request.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  try {
    await register(page, info);
    const token = await connectAgent(page, agent, '架空の作品エージェント ' + info.project.name);
    const title = `架空のMCP作品-${info.project.name}`;
    const made = await mcp(agent, token, 'create_project_draft', {
      title,
      description: '## つくったもの\n\nMCP_PROJECT_BODY',
      github_url: 'https://github.com/example/fictional-mcp-project',
      technologies: 'React, Cloudflare Workers',
    });
    expect(made.status()).toBe(200);
    const result = (await made.json()).result;
    expect(result.isError).toBeUndefined();
    const { id } = result.structuredContent.draft;
    // Nothing reaches the public list from an agent alone.
    expect(await (await page.request.get('/api/projects')).text()).not.toContain(
      'MCP_PROJECT_BODY',
    );

    await page.goto('/works/new');
    const item = page.locator('.project-draft-list li', { hasText: title });
    await expect(item).toContainText('AIエージェントが作成');
    // A draft the student saves in the app is not marked.
    await page.getByLabel('作品タイトル', { exact: true }).fill('アプリで保存した架空の作品');
    await page.getByLabel('作品の説明', { exact: true }).fill('架空の説明');
    await page.getByRole('button', { name: '作品を保存', exact: true }).click();
    await expect(page.getByText('保存済みです。', { exact: false })).toBeVisible();
    const own = page.locator('.project-draft-list li', { hasText: 'アプリで保存した架空の作品' });
    await expect(own).toBeVisible();
    await expect(own).not.toContainText('AIエージェントが作成');
    await expect(item).toContainText('AIエージェントが作成');
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('works-agent-project.png'), fullPage: true });

    // The student opens it and sees exactly what the agent wrote, ready to add images and publish.
    await item.getByRole('button', { name: '続きを編集：' + title, exact: true }).click();
    await expect(page.getByLabel('作品タイトル', { exact: true })).toHaveValue(title);
    await expect(page.getByLabel('作品の説明', { exact: true })).toHaveValue(
      '## つくったもの\n\nMCP_PROJECT_BODY',
    );
    await expect(page.getByLabel('GitHub URL（任意）', { exact: true })).toHaveValue(
      'https://github.com/example/fictional-mcp-project',
    );
    // The agent can still read it while it is unpublished.
    const read = await mcp(agent, token, 'get_my_project_draft', { id });
    expect((await read.json()).result.structuredContent.draft.title).toBe(title);
  } finally {
    await agent.dispose();
  }
});
