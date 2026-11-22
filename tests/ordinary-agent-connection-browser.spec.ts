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
  await expect(consent).toContainText('公開・削除、プロフィール・いいね・通報、ほかの人の下書き');
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
  await page.getByText('記事を公開する', { exact: true }).click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  const notice = composer.locator('.publication-secret-notice');
  await expect(notice).toContainText('公開前に確かめてください');
  await expect(notice).toContainText('アクセストークン');
  await expect(notice).not.toContainText(secret);
  const summary = composer.getByLabel('記事の概要（300文字以内）');
  await expect(summary).toHaveValue('');
  await composer.getByRole('button', { name: 'AIの出力から入れる', exact: true }).click();
  await expect(summary).toHaveValue('エージェントが提案した架空の概要です。');
  await expect(composer.getByLabel('タグ（カンマ区切り、5件まで）')).toHaveValue('MCP, 架空');
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
