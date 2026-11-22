import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { scanForSecrets } from '../src/shared/secret-scan';

const ORIGIN = 'https://app.example.invalid';
const NOW = 1_800_000_000_000;
const REDIRECT = 'http://127.0.0.1:33418/callback';
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
type Http = { status: number; headers: Record<string, string>; body: string } | null;
let users: Record<string, Session>;

async function call<T>(input: Record<string, unknown>): Promise<T> {
  return (await (
    await mf.dispatchFetch('https://fixture.test', {
      method: 'POST',
      body: JSON.stringify({ now: NOW, ...input }),
    })
  ).json()) as T;
}
const http = (
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; now?: number } = {},
) => call<Http>({ action: 'http', url: ORIGIN + path, ...init });
const cookie = (s: Session) =>
  [s.setCookie, s.contextCookie].map((v) => v.split(';')[0]).join('; ');
const browser = (s: Session, write = false): Record<string, string> =>
  write
    ? {
        Cookie: cookie(s),
        Origin: ORIGIN,
        Authorization: 'Bearer csrf.' + s.csrfToken,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      }
    : { Cookie: cookie(s) };
const b64 = (buf: Buffer) => buf.toString('base64url');
const form = (values: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(values).toString(),
});

async function registerClient(name = 'Claude Code') {
  const r = await http('/api/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT] }),
  });
  expect(r!.status).toBe(201);
  return JSON.parse(r!.body).client_id as string;
}
async function startAuthorization(clientId: string, extra: Record<string, string> = {}) {
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st-1',
    scope: 'drafts',
    resource: ORIGIN + '/api/mcp',
    ...extra,
  });
  const r = await http('/api/oauth/authorize?' + q);
  return { r: r!, verifier };
}
async function connect(who = 'a') {
  const clientId = await registerClient();
  const { r, verifier } = await startAuthorization(clientId);
  expect(r.status).toBe(302);
  const location = new URL(r.headers.location);
  expect(location.origin + location.pathname).toBe(ORIGIN + '/connect');
  const requestId = location.searchParams.get('request')!;
  const consent = await http('/api/private/agent-connections/requests/' + requestId, {
    headers: browser(users[who]),
  });
  expect(JSON.parse(consent!.body)).toEqual({
    clientName: 'Claude Code',
    destination: 'この端末のアプリ',
    scope: 'drafts',
  });
  const decided = await http('/api/private/agent-connections/requests/' + requestId, {
    method: 'POST',
    headers: browser(users[who], true),
    body: JSON.stringify({ decision: 'allow' }),
  });
  const redirectTo = new URL(JSON.parse(decided!.body).redirectTo);
  expect(redirectTo.searchParams.get('state')).toBe('st-1');
  expect(redirectTo.searchParams.get('iss')).toBe(ORIGIN);
  const code = redirectTo.searchParams.get('code')!;
  const token = await http(
    '/api/oauth/token',
    form({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: ORIGIN + '/api/mcp',
    }),
  );
  expect(token!.status).toBe(200);
  const pair = JSON.parse(token!.body);
  return { clientId, code, verifier, ...pair } as {
    clientId: string;
    code: string;
    verifier: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}
let rpcId = 0;
async function rpc(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const r = await http('/api/mcp', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: r!.status, headers: r!.headers, json: r!.body ? JSON.parse(r!.body) : null };
}
const tool = async (token: string, name: string, args: Record<string, unknown> = {}) =>
  (await rpc(token, 'tools/call', { name, arguments: args })).json.result as {
    content: { text: string }[];
    structuredContent?: Record<string, any>;
    isError?: boolean;
  };

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/agent-mcp-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + file, 'utf8');
    const statements = (
      raw.includes('-- @statement') ? raw.split(/^-- @statement\s*$/m) : raw.split(/;\s*(?:\n|$)/)
    )
      .map((sql) => sql.replace(/^--.*$/gm, '').trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  for (const who of ['a', 'b', 'c', 'd', 'e'])
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + who, 'subject-' + who, who + '@st.kobedenshi.ac.jp', NOW)
      .run();
  await db
    .prepare(
      "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES('pub-b','公開名B','分野','学年','自己紹介','B',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES('account-b','pub-b')",
    )
    .run();
  users = {};
  for (const who of ['a', 'b', 'c', 'd'])
    users[who] = await call<Session>({ action: 'session', who });
  // "e" has a live session but no enrollment period (graduated / not yet declared).
  users.e = await call<Session>({ action: 'session', who: 'e', enrollment: false });
});
afterAll(async () => {
  await mf?.dispose();
});

describe('discovery and the closed release gate', () => {
  it('stays unmounted unless the release flag is set', async () => {
    expect(
      await call<boolean>({ action: 'disabled', url: ORIGIN + '/api/mcp', method: 'POST' }),
    ).toBe(true);
  });
  it('serves RFC 9728 / RFC 8414 metadata and a 401 that points to it', async () => {
    const prm = JSON.parse((await http('/.well-known/oauth-protected-resource/api/mcp'))!.body);
    expect(prm).toMatchObject({
      resource: ORIGIN + '/api/mcp',
      authorization_servers: [ORIGIN],
      scopes_supported: ['drafts'],
    });
    const asm = JSON.parse((await http('/.well-known/oauth-authorization-server'))!.body);
    expect(asm).toMatchObject({
      issuer: ORIGIN,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      registration_endpoint: ORIGIN + '/api/oauth/register',
    });
    const r = await http('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r!.status).toBe(401);
    expect(r!.headers['www-authenticate']).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    const bad = await rpc('ksh_at_' + 'x'.repeat(43), 'tools/list');
    expect(bad.status).toBe(401);
    expect(bad.headers['www-authenticate']).toContain('error="invalid_token"');
    expect((await http('/api/mcp'))!.status).toBe(405);
  });
});

describe('authorization flow', () => {
  it('rejects unregistered redirect URIs without redirecting, and non-https/loopback registration', async () => {
    const clientId = await registerClient();
    const { r } = await startAuthorization(clientId, { redirect_uri: 'https://evil.example/cb' });
    expect(r.status).toBe(400);
    expect(r.headers.location).toBeUndefined();
    const reg = await http('/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    });
    expect(reg!.status).toBe(400);
  });
  it('requires PKCE S256 and a known resource', async () => {
    const clientId = await registerClient();
    const plain = await startAuthorization(clientId, { code_challenge_method: 'plain' });
    expect(new URL(plain.r.headers.location).searchParams.get('error')).toBe('invalid_request');
    const other = await startAuthorization(clientId, { resource: 'https://other.example/mcp' });
    expect(new URL(other.r.headers.location).searchParams.get('error')).toBe('invalid_target');
  });
  it('never redirects to a self-registered https URI before the student decides (no open redirect)', async () => {
    // Anyone can register a client through DCR, so an https redirect URI is not trusted
    // until the student has seen its host on the consent screen (RFC 9700 §4.11.2).
    const evil = 'https://evil.example/cb';
    const reg = await http('/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude Code', redirect_uris: [evil] }),
    });
    const clientId = JSON.parse(reg!.body).client_id as string;
    const broken: Record<string, string>[] = [
      { response_type: 'token' },
      { code_challenge_method: 'plain' },
      { resource: 'https://other.example/mcp' },
      { scope: 'admin' },
    ];
    for (const extra of broken) {
      const { r } = await startAuthorization(clientId, { redirect_uri: evil, ...extra });
      expect(r.status).toBe(400);
      expect(r.headers.location).toBeUndefined();
    }
    const ok = await startAuthorization(clientId, { redirect_uri: evil });
    expect(new URL(ok.r.headers.location).origin).toBe(ORIGIN);
  });
  it('tells an https client the server is busy, not that the request is wrong, when requests run out', async () => {
    const reg = await http('/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.example/cb'] }),
    });
    const clientId = JSON.parse(reg!.body).client_id as string;
    // A window 10 hours earlier, so filling it does not touch the other tests' hour.
    const past = NOW - 10 * 3_600_000;
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000)
         INSERT INTO agent_oauth_requests(request_hash,client_id,redirect_uri,state,code_challenge,created_at_ms,expires_at_ms)
         SELECT printf('%064d',i),?,'https://claude.example/cb',NULL,printf('%043d',0),?,? FROM n`,
      )
      .bind(clientId, past, past + 600_000)
      .run();
    const challenge = b64(
      createHash('sha256')
        .update(b64(randomBytes(32)))
        .digest(),
    );
    const query = (redirect: string) =>
      '/api/oauth/authorize?' +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirect,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
    const busy = await http(query('https://claude.example/cb'), { now: past + 1 });
    expect(busy!.status).toBe(503);
    expect(busy!.headers.location).toBeUndefined();
    expect(busy!.body).toContain('混み合っています');
    expect(busy!.body).not.toContain('正しくありません');
    const wrong = await http(query('https://claude.example/cb').replace('S256', 'plain'), {
      now: past + 1,
    });
    expect(wrong!.status).toBe(400);
    expect(wrong!.body).toContain('正しくありません');
  });
  it('needs a signed-in session to see or decide the consent request, and deny returns access_denied', async () => {
    const clientId = await registerClient();
    const { r } = await startAuthorization(clientId);
    const id = new URL(r.headers.location).searchParams.get('request')!;
    expect((await http('/api/private/agent-connections/requests/' + id))!.status).toBe(401);
    const noCsrf = await http('/api/private/agent-connections/requests/' + id, {
      method: 'POST',
      headers: { ...browser(users.a), 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ decision: 'allow' }),
    });
    expect(noCsrf!.status).toBe(401);
    const denied = await http('/api/private/agent-connections/requests/' + id, {
      method: 'POST',
      headers: browser(users.a, true),
      body: JSON.stringify({ decision: 'deny' }),
    });
    const to = new URL(JSON.parse(denied!.body).redirectTo);
    expect(to.searchParams.get('error')).toBe('access_denied');
    expect(to.searchParams.get('code')).toBeNull();
    // A decided request cannot be reused.
    const again = await http('/api/private/agent-connections/requests/' + id, {
      method: 'POST',
      headers: browser(users.a, true),
      body: JSON.stringify({ decision: 'allow' }),
    });
    expect(again!.status).toBe(404);
  });
  it('rejects a wrong verifier, and a replayed code revokes the connection', async () => {
    const c = await connect('c');
    const wrong = await http(
      '/api/oauth/token',
      form({
        grant_type: 'authorization_code',
        code: c.code,
        client_id: c.clientId,
        redirect_uri: REDIRECT,
        code_verifier: b64(randomBytes(32)),
      }),
    );
    expect(wrong!.status).toBe(400);
    expect((await rpc(c.access_token, 'tools/list')).status).toBe(401);
  });
  it('rotates refresh tokens and revokes the connection when a spent refresh token is reused', async () => {
    const c = await connect('c');
    const next = await http(
      '/api/oauth/token',
      form({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.clientId }),
    );
    const pair = JSON.parse(next!.body);
    expect(pair.refresh_token).not.toBe(c.refresh_token);
    expect((await rpc(c.access_token, 'tools/list')).status).toBe(401);
    expect((await rpc(pair.access_token, 'tools/list')).status).toBe(200);
    const reuse = await http(
      '/api/oauth/token',
      form({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.clientId }),
    );
    expect(reuse!.status).toBe(400);
    expect((await rpc(pair.access_token, 'tools/list')).status).toBe(401);
  });
  it('expires access tokens after an hour', async () => {
    const c = await connect('c');
    const later = await http('/api/mcp', {
      method: 'POST',
      now: NOW + 3_600_001,
      headers: { Authorization: 'Bearer ' + c.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(later!.status).toBe(401);
  });
});

describe('MCP tools as the connected student', () => {
  it('negotiates versions and exposes no publish/delete tools', async () => {
    const c = await connect('a');
    const init = await rpc(c.access_token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    });
    expect(init.json.result.protocolVersion).toBe('2025-06-18');
    const list = await rpc(c.access_token, 'tools/list');
    expect(list.json.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'create_draft',
      'get_article',
      'get_my_draft',
      'get_writing_guide',
      'list_my_drafts',
      'list_recent_articles',
      'update_draft',
    ]);
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
    const stateless = await rpc(
      c.access_token,
      'tools/list',
      { _meta: meta },
      { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' },
    );
    expect(stateless.json.result).toMatchObject({ resultType: 'complete', cacheScope: 'public' });
    const mismatch = await rpc(
      c.access_token,
      'tools/list',
      { _meta: meta },
      { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call' },
    );
    expect([mismatch.status, mismatch.json.error.code]).toEqual([400, -32020]);
    const unknown = await rpc(
      c.access_token,
      'tools/list',
      {},
      { 'MCP-Protocol-Version': '1900-01-01' },
    );
    expect([unknown.status, unknown.json.error.code]).toEqual([400, -32022]);
  });
  it("creates, lists, reads and updates only the student's own private drafts", async () => {
    const c = await connect('a');
    const made = await tool(c.access_token, 'create_draft', {
      title: 'Docker で詰まった話',
      body: '## はじめに\n本文',
    });
    expect(made.isError).toBeUndefined();
    const draft = made.structuredContent!.draft;
    expect(draft.version).toBe(1);
    const listed = await tool(c.access_token, 'list_my_drafts');
    expect(listed.structuredContent!.drafts[0]).toMatchObject({
      id: draft.id,
      createdByAgent: true,
    });
    const read = await tool(c.access_token, 'get_my_draft', { id: draft.id });
    expect(read.structuredContent!.draft.body).toBe('## はじめに\n本文');
    const updated = await tool(c.access_token, 'update_draft', {
      id: draft.id,
      title: '直した',
      body: '本文2',
      expected_version: 1,
    });
    expect(updated.structuredContent!.draft.version).toBe(2);
    const stale = await tool(c.access_token, 'update_draft', {
      id: draft.id,
      title: 'x',
      body: 'y',
      expected_version: 1,
    });
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toContain('先に更新');
    // Another student's connection cannot see or change it.
    const other = await connect('b');
    expect((await tool(other.access_token, 'get_my_draft', { id: draft.id })).isError).toBe(true);
    expect(
      (
        await tool(other.access_token, 'update_draft', {
          id: draft.id,
          title: 'x',
          body: 'y',
          expected_version: 2,
        })
      ).isError,
    ).toBe(true);
    // The student's connection list shows the connection and marks the agent draft.
    const mine = JSON.parse(
      (await http('/api/private/agent-connections', { headers: browser(users.a) }))!.body,
    );
    expect(mine.connections[0]).toMatchObject({ clientName: 'Claude Code' });
    expect(Object.keys(mine.connections[0]).sort()).toEqual([
      'clientName',
      'createdAt',
      'expiresAt',
      'id',
      'lastUsedAt',
    ]);
    expect(mine.agentDraftIds).toContain(draft.id);
  });
  it('stores secret-looking text with a line-numbered notice that never echoes the value', async () => {
    const c = await connect('a');
    const secret = 'ghp_' + 'A'.repeat(36);
    const result = await tool(c.access_token, 'create_draft', {
      title: 'メモ',
      body: `一行目\n連絡先 someone@st.kobedenshi.ac.jp\nトークン ${secret}\n/Users/taro/project`,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('本文 2 行目：メールアドレス');
    expect(result.content[0].text).toContain('本文 3 行目：アクセストークン');
    expect(result.content[0].text).toContain('本文 4 行目：ユーザー名入りのパス');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.structuredContent!.warnings).toEqual([
      { field: 'body', kind: 'email', line: 2 },
      { field: 'body', kind: 'access_token', line: 3 },
      { field: 'body', kind: 'home_path', line: 4 },
    ]);
  });
  it('accepts only typed, bounded draft fields (HTTP 400 otherwise) and keeps summary/tag suggestions', async () => {
    const c = await connect('a');
    const call = (args: Record<string, unknown>) =>
      rpc(c.access_token, 'tools/call', { name: 'create_draft', arguments: args });
    for (const args of [
      { title: 'x', body: 'b', history: 'raw session' },
      { title: 'x'.repeat(201), body: 'b' },
      { title: '二行\nタイトル', body: 'b' },
      { title: 'x', body: 'b'.repeat(262145) },
      { title: 'x', body: 'b', tags: ['1', '2', '3', '4', '5', '6'] },
      { title: 'x', body: 'b', summary: 's'.repeat(301) },
      { title: 'x', body: { file: 'a.md' } },
    ]) {
      const r = await call(args);
      expect([r.status, r.json.error.code]).toEqual([400, -32602]);
    }
    const ok = await call({
      title: '案つき',
      body: '本文',
      summary: '概要の案',
      tags: ['Docker', 'Docker', '学び'],
    });
    const id = ok.json.result.structuredContent.draft.id;
    const mine = JSON.parse(
      (await http('/api/private/agent-connections', { headers: browser(users.a) }))!.body,
    );
    expect(mine.hints).toContainEqual({
      draftId: id,
      summary: '概要の案',
      tags: ['Docker', '学び'],
    });
  });
  it('limits agent-created drafts to 10 per account per day across connections', async () => {
    const first = await connect('d');
    const second = await connect('d');
    for (let n = 0; n < 10; n++)
      expect(
        (
          await tool(n % 2 ? first.access_token : second.access_token, 'create_draft', {
            title: 't' + n,
            body: 'b',
          })
        ).isError,
      ).toBeUndefined();
    const over = await tool(second.access_token, 'create_draft', { title: 'over', body: 'b' });
    expect(over.content[0].text).toContain('1日10件');
  });
  it('blocks writes outside the enrollment period', async () => {
    const c = await connect('e');
    const r = await tool(c.access_token, 'create_draft', { title: 't', body: 'b' });
    expect(r.content[0].text).toContain('在籍期間');
  });
  it('stops at once when the student revokes it, or when the account state changes', async () => {
    const c = await connect('b');
    const list = JSON.parse(
      (await http('/api/private/agent-connections', { headers: browser(users.b) }))!.body,
    );
    // Fixture times are identical, so revoke every listed connection of this student.
    for (const connection of list.connections) {
      const revoked = await http('/api/private/agent-connections/' + connection.id, {
        method: 'DELETE',
        headers: browser(users.b, true),
      });
      expect(revoked!.status).toBe(200);
    }
    const after = JSON.parse(
      (await http('/api/private/agent-connections', { headers: browser(users.b) }))!.body,
    );
    expect(after.connections).toEqual([]);
    expect((await rpc(c.access_token, 'tools/list')).status).toBe(401);
    const d = await connect('c');
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='account-c'").run();
    await db.prepare("UPDATE private_accounts SET status='active' WHERE id='account-c'").run();
    expect((await rpc(d.access_token, 'tools/list')).status).toBe(401);
  });
  it('reads public articles as public DTOs with the source URL', async () => {
    const draft = await call<{ id: string; version: number }>({
      action: 'create',
      url: ORIGIN + '/private/drafts',
      method: 'POST',
      headers: browser(users.b, true),
      input: { title: '公開した記事', body: '## 本文\n公開の中身' },
    });
    const published = await call<{ contentId: string }>({
      action: 'publish',
      url: ORIGIN + '/private/publication',
      method: 'POST',
      headers: browser(users.b, true),
      draft: draft.id,
      input: {
        expectedVersion: draft.version,
        confirmPublic: true,
        summary: '概要',
        tags: ['学び'],
        minutes: 3,
      },
    });
    const c = await connect('a');
    const recent = await tool(c.access_token, 'list_recent_articles');
    expect(recent.structuredContent!.articles[0]).toMatchObject({
      title: '公開した記事',
      author: '公開名B',
    });
    const text = (
      await tool(c.access_token, 'get_article', { id: ORIGIN + '/articles/' + published.contentId })
    ).content[0].text;
    expect(text).toContain(
      `出典: Kobe Student Hub（学生が書いた記事） ${ORIGIN}/articles/${published.contentId}`,
    );
    expect(text).not.toContain('@st.kobedenshi.ac.jp');
    expect(text).not.toContain('account-b');
  });
});

describe('fixed-rule secret scan', () => {
  it('flags common shapes and leaves ordinary prose alone', () => {
    expect(scanForSecrets('-----BEGIN RSA PRIVATE KEY-----')[0].kind).toBe('private_key');
    expect(scanForSecrets('key=-----BEGIN%20PRIVATE%20KEY-----')[0].kind).toBe('private_key');
    expect(scanForSecrets('AKIA' + 'B'.repeat(16))[0].kind).toBe('api_key');
    expect(scanForSecrets('OPENAI_API_KEY=sk-proj-' + 'a'.repeat(30)).length).toBeGreaterThan(0);
    expect(scanForSecrets('C:\\Users\\hanako\\Desktop')[0].kind).toBe('home_path');
    expect(
      scanForSecrets(
        '秘密鍵は公開しないこと。/Users/<you>/ や ~/project を使う。src/features/Editor/hooks/usePreview.ts',
      ),
    ).toEqual([]);
  });
  it('stays fast on long pathological lines', () => {
    const start = Date.now();
    scanForSecrets('-'.repeat(200_000), ' '.repeat(200_000), '- '.repeat(100_000));
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
