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
  for (const who of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
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
  await db
    .prepare(
      "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES('pub-f','公開名F','分野','学年','自己紹介','F',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES('account-f','pub-f')",
    )
    .run();
  users = {};
  for (const who of ['a', 'b', 'c', 'd', 'f', 'g', 'h'])
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
  it('tells an https client to retry later, without a redirect or internals, when storing the request fails', async () => {
    const reg = await http('/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.example/cb'] }),
    });
    const clientId = JSON.parse(reg!.body).client_id as string;
    const db = await mf.getD1Database('DB');
    // Fail only this client's inserts so the other tests keep a working table.
    await db.exec(
      `CREATE TRIGGER fail_agent_request BEFORE INSERT ON agent_oauth_requests WHEN NEW.client_id='${clientId}' BEGIN SELECT RAISE(ABORT,'internal detail'); END`,
    );
    try {
      const challenge = b64(
        createHash('sha256')
          .update(b64(randomBytes(32)))
          .digest(),
      );
      const failed = await http(
        '/api/oauth/authorize?' +
          new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: 'https://claude.example/cb',
            code_challenge: challenge,
            code_challenge_method: 'S256',
          }),
      );
      expect(failed!.status).toBe(503);
      expect(failed!.headers.location).toBeUndefined();
      expect(failed!.body).toContain('接続の準備に失敗しました');
      expect(failed!.body).not.toContain('正しくありません');
      expect(failed!.body).not.toContain('internal detail');
    } finally {
      await db.exec('DROP TRIGGER fail_agent_request');
    }
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
      'get_my_taste',
      'get_my_taste_materials',
      'get_writing_guide',
      'list_my_drafts',
      'list_recent_articles',
      'replace_my_taste',
      'update_draft',
      'update_published_article',
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

describe('the publish boundary: humans publish first, agents may edit what is already public', () => {
  const publishAs = async (who: string, title: string, body: string) => {
    const draft = await call<{ id: string; version: number }>({
      action: 'create',
      url: ORIGIN + '/private/drafts',
      method: 'POST',
      headers: browser(users[who], true),
      input: { title, body },
    });
    const published = await call<{ contentId: string }>({
      action: 'publish',
      url: ORIGIN + '/private/publication',
      method: 'POST',
      headers: browser(users[who], true),
      draft: draft.id,
      input: {
        expectedVersion: draft.version,
        confirmPublic: true,
        summary: '公開時の概要',
        tags: ['学び'],
        minutes: 3,
      },
    });
    return { draftId: draft.id, version: draft.version, contentId: published.contentId };
  };
  const publicArticle = async (contentId: string) => {
    const db = await mf.getD1Database('DB');
    return db
      .prepare(
        'SELECT c.title,c.body,c.summary,c.status,(SELECT MAX(revision) FROM article_publication_revisions WHERE content_id=c.id) AS revision FROM content c WHERE c.id=?',
      )
      .bind(contentId)
      .first<{ title: string; body: string; summary: string; status: string; revision: number }>();
  };
  const publicationCount = async () =>
    (await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT count(*) AS n FROM article_publications')
      .first<{ n: number }>())!.n;

  it('never publishes a draft for the first time through MCP', async () => {
    const c = await connect('a');
    const made = await tool(c.access_token, 'create_draft', { title: '未公開', body: '本文' });
    const draft = made.structuredContent!.draft;
    const before = await publicationCount();
    const r = await tool(c.access_token, 'update_published_article', {
      id: draft.id,
      title: '公開しようとする',
      body: '本文',
      expected_version: draft.version,
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('初めての公開は本人だけ');
    expect(await publicationCount()).toBe(before);
    // The draft itself is untouched by the refused call.
    const read = await tool(c.access_token, 'get_my_draft', { id: draft.id });
    expect(read.structuredContent!.draft).toMatchObject({
      title: '未公開',
      version: draft.version,
      publishedArticleId: null,
    });
    // No tool name or description offers a first publication or deletion.
    const tools = (await rpc(c.access_token, 'tools/list')).json.result.tools as {
      name: string;
    }[];
    expect(tools.some((t) => /^(publish|delete)/.test(t.name))).toBe(false);
  });

  it("edits the student's own published article in place and keeps it public", async () => {
    const p = await publishAs('b', '公開した記事（編集前）', '## 本文\n編集前');
    const c = await connect('b');
    const listed = await tool(c.access_token, 'list_my_drafts');
    expect(
      listed.structuredContent!.drafts.find((d: { id: string }) => d.id === p.draftId),
    ).toMatchObject({ publishedArticleId: p.contentId });
    expect(listed.content[0].text).toContain('公開中 ' + ORIGIN + '/articles/' + p.contentId);
    const before = await publicationCount();
    const r = await tool(c.access_token, 'update_published_article', {
      id: p.draftId,
      title: '公開した記事（直した）',
      body: '## 本文\n直した',
      expected_version: p.version,
    });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent!.articleUrl).toBe(ORIGIN + '/articles/' + p.contentId);
    expect(await publicationCount()).toBe(before);
    expect(await publicArticle(p.contentId)).toMatchObject({
      title: '公開した記事（直した）',
      body: '## 本文\n直した',
      summary: '公開時の概要',
      status: 'published',
      revision: 2,
    });
    // Replaying the same version is a conflict, not a second revision.
    const stale = await tool(c.access_token, 'update_published_article', {
      id: p.draftId,
      title: 'x',
      body: 'y',
      expected_version: p.version,
    });
    expect(stale.content[0].text).toContain('先に更新');
    expect((await publicArticle(p.contentId))!.revision).toBe(2);
    // Another student's connection cannot touch it.
    const other = await connect('a');
    const foreign = await tool(other.access_token, 'update_published_article', {
      id: p.draftId,
      title: 'x',
      body: 'y',
      expected_version: p.version + 1,
    });
    expect(foreign.isError).toBe(true);
    expect((await publicArticle(p.contentId))!.title).toBe('公開した記事（直した）');
  });

  it('refuses when private unpublished edits, a stop, or secret-looking text would go public', async () => {
    const p = await publishAs('b', '公開した記事（境界）', '本文');
    const c = await connect('b');
    // Secret-looking text is never pushed to the public page.
    const secret = 'ghp_' + 'B'.repeat(36);
    const leaked = await tool(c.access_token, 'update_published_article', {
      id: p.draftId,
      title: '直す',
      body: 'トークン ' + secret,
      expected_version: p.version,
    });
    expect(leaked.isError).toBe(true);
    expect(leaked.content[0].text).toContain('反映していません');
    expect(JSON.stringify(leaked)).not.toContain(secret);
    expect((await publicArticle(p.contentId))!.body).toBe('本文');
    // The student's private work-in-progress (or a private agent edit) is not published by an agent.
    const privateEdit = await tool(c.access_token, 'update_draft', {
      id: p.draftId,
      title: '下書きだけ直した',
      body: '未公開の変更',
      expected_version: p.version,
    });
    const v = privateEdit.structuredContent!.draft.version;
    const pending = await tool(c.access_token, 'update_published_article', {
      id: p.draftId,
      title: '公開へ',
      body: '未公開の変更',
      expected_version: v,
    });
    expect(pending.content[0].text).toContain('まだ公開していない変更');
    expect(await publicArticle(p.contentId)).toMatchObject({ body: '本文', revision: 1 });
    // A stopped article stays stopped.
    const q = await publishAs('b', '停止した記事', '本文');
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        'INSERT INTO article_publication_stops(content_id,owner_account_id,source_version,stopped_at_ms) VALUES(?,?,?,?)',
      )
      .bind(q.contentId, 'account-b', q.version, NOW)
      .run();
    const stopped = await tool(c.access_token, 'update_published_article', {
      id: q.draftId,
      title: '再公開しようとする',
      body: '本文2',
      expected_version: q.version,
    });
    expect(stopped.isError).toBe(true);
    expect((await publicArticle(q.contentId))!.revision).toBe(1);
  });
});

describe("the student's own taste ledger (C23, flag TASTE_LEDGER_RELEASE_ENABLED)", () => {
  const DAY = 24 * 60 * 60_000;
  const db = () => mf.getD1Database('DB');
  const rawTool = async (
    token: string,
    name: string,
    args: Record<string, unknown> = {},
    taste = true,
  ) => {
    const r = await call<Http>({
      action: 'http',
      url: ORIGIN + '/api/mcp',
      method: 'POST',
      taste,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    return { status: r!.status, json: r!.body ? JSON.parse(r!.body) : null };
  };
  const line = (text: string, extra: Record<string, unknown> = {}) => ({
    kind: 'writing',
    text,
    basis: 'reviews',
    count: 3,
    date: '2026-11-23',
    ...extra,
  });
  const versions = async (draftId: string) =>
    (await (
      await db()
    )
      .prepare('SELECT count(*) AS n FROM agent_draft_versions WHERE draft_id=?')
      .bind(draftId)
      .first<{ n: number }>())!.n;

  it('stays out of tools/list, the guide and storage while the flag is closed', async () => {
    const c = await connect('g');
    const list = await call<Http>({
      action: 'http',
      url: ORIGIN + '/api/mcp',
      method: 'POST',
      taste: false,
      headers: {
        Authorization: 'Bearer ' + c.access_token,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/list' }),
    });
    const names = JSON.parse(list!.body).result.tools.map((t: { name: string }) => t.name);
    expect(names.filter((n: string) => n.includes('taste'))).toEqual([]);
    const replaced = await rawTool(
      c.access_token,
      'replace_my_taste',
      { lines: [line('閉じている')], expected_version: 0 },
      false,
    );
    expect(replaced.json.result.isError).toBe(true);
    expect(replaced.json.result.content[0].text).toContain('そのツールはありません');
    const made = await rawTool(c.access_token, 'create_draft', { title: 't', body: 'b' }, false);
    expect(await versions(made.json.result.structuredContent.draft.id)).toBe(0);
    const guide = await rawTool(c.access_token, 'get_writing_guide', {}, false);
    expect(guide.json.result.content[0].text).not.toContain('あなたの好み');
  });

  it('reads and replaces only the connected student’s ledger, with a version check', async () => {
    const f = await connect('f');
    const g = await connect('g');
    const empty = await tool(f.access_token, 'get_my_taste');
    expect(empty.structuredContent).toEqual({ version: 0, lines: [] });
    // Expecting a version that does not exist yet is a conflict, not a create.
    const early = await tool(f.access_token, 'replace_my_taste', {
      lines: [line('先に')],
      expected_version: 1,
    });
    expect(early.content[0].text).toContain('先に更新されています');
    const lines = [
      line('見出しごとに結論を先に書く'),
      line('写真は公開の直前に足すことが多い', { kind: 'app', basis: 'diffs', count: 4 }),
      line('固有名詞はそのまま残す', { basis: 'instruction', count: undefined }),
    ].map((l) => JSON.parse(JSON.stringify(l)));
    const first = await tool(f.access_token, 'replace_my_taste', { lines, expected_version: 0 });
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent).toMatchObject({ version: 1, lines: 3, warnings: [] });
    const again = await tool(f.access_token, 'replace_my_taste', { lines, expected_version: 0 });
    expect(again.content[0].text).toContain('先に更新されています');
    const second = await tool(f.access_token, 'replace_my_taste', {
      lines: lines.slice(0, 2),
      expected_version: 1,
    });
    expect(second.structuredContent).toMatchObject({ version: 2, lines: 2 });
    const stale = await tool(f.access_token, 'replace_my_taste', { lines, expected_version: 1 });
    expect(stale.content[0].text).toContain('先に更新されています');
    const read = await tool(f.access_token, 'get_my_taste');
    expect(read.structuredContent).toEqual({ version: 2, lines: lines.slice(0, 2) });
    // The other student sees an empty ledger of their own and cannot touch f's.
    expect((await tool(g.access_token, 'get_my_taste')).structuredContent).toEqual({
      version: 0,
      lines: [],
    });
    const gWrite = await tool(g.access_token, 'replace_my_taste', {
      lines: [line('gの行')],
      expected_version: 2,
    });
    expect(gWrite.content[0].text).toContain('先に更新されています');
    expect((await tool(f.access_token, 'get_my_taste')).structuredContent!.version).toBe(2);
  });

  it('answers 400 for lines outside the shape and limits, and leaves the ledger as it was', async () => {
    const f = await connect('f');
    const before = (await tool(f.access_token, 'get_my_taste')).structuredContent;
    const bad: Record<string, unknown>[] = [
      { lines: Array.from({ length: 41 }, (_, i) => line('行' + i)), expected_version: 2 },
      { lines: [line('あ'.repeat(201))], expected_version: 2 },
      { lines: [line('改行\nあり')], expected_version: 2 },
      { lines: [line('制御\u0007文字')], expected_version: 2 },
      { lines: [line('段落 区切り')], expected_version: 2 },
      { lines: [line('')], expected_version: 2 },
      { lines: [line('種類', { kind: 'other' })], expected_version: 2 },
      { lines: [line('根拠', { basis: 'feeling' })], expected_version: 2 },
      { lines: [line('件数なし', { count: undefined })], expected_version: 2 },
      { lines: [line('件数0', { count: 0 })], expected_version: 2 },
      { lines: [line('指示に件数', { basis: 'instruction' })], expected_version: 2 },
      { lines: [line('日付', { date: '2026-02-30' })], expected_version: 2 },
      { lines: [line('余分', { author: '公開名B' })], expected_version: 2 },
      { lines: 'すべて', expected_version: 2 },
      { lines: [line('版なし')] },
      { lines: [line('余分な引数')], expected_version: 2, account_id: 'account-g' },
    ].map((a) => JSON.parse(JSON.stringify(a)));
    for (const args of bad) {
      const r = await rpc(f.access_token, 'tools/call', {
        name: 'replace_my_taste',
        arguments: args,
      });
      expect([r.status, r.json.error?.code], JSON.stringify(args).slice(0, 80)).toEqual([
        400, -32602,
      ]);
    }
    const forty = Array.from({ length: 40 }, (_, i) => line('四十行の' + i));
    const ok40 = await tool(f.access_token, 'replace_my_taste', {
      lines: forty,
      expected_version: 2,
    });
    expect(ok40.structuredContent).toMatchObject({ version: 3, lines: 40 });
    const back = await tool(f.access_token, 'replace_my_taste', {
      lines: before!.lines,
      expected_version: 3,
    });
    expect(back.structuredContent).toMatchObject({ version: 4 });
  });

  it('returns secret-looking lines as a notice with the line number, without blocking or echoing', async () => {
    const g = await connect('g');
    const r = await tool(g.access_token, 'replace_my_taste', {
      lines: [line('普通の行'), line('連絡は hanako@example.com に送る')],
      expected_version: 0,
    });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent!.warnings).toEqual([{ kind: 'email', line: 2 }]);
    expect(r.content[0].text).toContain('2 行目：メールアドレス');
    expect(r.content[0].text).not.toContain('hanako@example.com');
    expect((await tool(g.access_token, 'get_my_taste')).structuredContent!.version).toBe(1);
  });

  it('adds only the student’s own writing lines to get_writing_guide, after the editorial ledger', async () => {
    const f = await connect('f');
    const g = await connect('g');
    const mine = (await tool(f.access_token, 'get_writing_guide')).content[0].text;
    const editorial = mine.indexOf('## 良いと感じられる記事');
    const personal = mine.indexOf('## あなたの好み');
    expect(editorial).toBeGreaterThan(0);
    expect(personal).toBeGreaterThan(editorial);
    expect(mine).toContain('- 見出しごとに結論を先に書く（レビュー 3件 2026-11-23）');
    // App lines are product feedback, never writing guidance.
    expect(mine).not.toContain('写真は公開の直前に足すことが多い');
    const theirs = (await tool(g.access_token, 'get_writing_guide')).content[0].text;
    expect(theirs).not.toContain('見出しごとに結論を先に書く');
    expect(theirs).toContain('## あなたの好み');
    const nobody = (await tool((await connect('a')).access_token, 'get_writing_guide')).content[0]
      .text;
    expect(nobody).not.toContain('## あなたの好み');
  });

  it("returns only the student's own materials: reviews they wrote, agent-version diffs, stale count", async () => {
    const f = await connect('f');
    const made = await tool(f.access_token, 'create_draft', {
      title: 'AIの題',
      body: '## はじめに\nAIが書いた1行目\n共通の行\nAIが書いた最後',
    });
    const draft = made.structuredContent!.draft as { id: string; version: number };
    expect(await versions(draft.id)).toBe(1);
    // The student edits the draft in the app (simulated directly on the private row).
    await (
      await db()
    )
      .prepare(
        'UPDATE private_article_drafts SET title=?,body=?,version=version+1 WHERE id=? AND owner_account_id=?',
      )
      .bind('本人の題', '## はじめに\n本人が直した1行目\n共通の行', draft.id, 'account-f')
      .run();
    // A second agent draft that the student never published, created 15 days ago.
    const old = await tool(f.access_token, 'create_draft', { title: '古い', body: 'x' });
    await (
      await db()
    )
      .prepare('UPDATE agent_draft_origins SET created_at_ms=? WHERE draft_id=?')
      .bind(NOW - 15 * DAY, old.structuredContent!.draft.id)
      .run();
    // Reviews: f's own, and g's of the same article. Only f's comes back to f.
    const article = await (
      await db()
    )
      .prepare(
        "SELECT id,title FROM content WHERE kind='article' AND status='published' AND is_sample=0 ORDER BY id LIMIT 1",
      )
      .first<{ id: string; title: string }>();
    expect(article).toBeTruthy();
    for (const [id, who, note] of [
      ['11111111-1111-4111-8111-111111111111', 'account-f', 'fのひとこと'],
      ['22222222-2222-4222-8222-222222222222', 'account-g', 'gのひとこと'],
    ])
      await (
        await db()
      )
        .prepare(
          "INSERT INTO editorial_reviews(id,reviewer_account_id,content_id,revision,verdict,points_json,note,reviewed_at_ms) VALUES(?,?,?,NULL,'good','[\"concrete\"]',?,?)",
        )
        .bind(id, who, article!.id, note, NOW)
        .run();

    const m = await tool(f.access_token, 'get_my_taste_materials');
    expect(m.isError).toBeUndefined();
    const s = m.structuredContent as any;
    expect(s.reviews).toEqual([
      {
        articleId: article!.id,
        articleTitle: article!.title,
        verdict: 'good',
        points: ['concrete'],
        note: 'fのひとこと',
        reviewedAt: NOW,
      },
    ]);
    expect(JSON.stringify(s)).not.toContain('gのひとこと');
    expect(JSON.stringify(s)).not.toMatch(/account-|@st\.kobedenshi|公開名/);
    const d = s.drafts.find((x: { draftId: string }) => x.draftId === draft.id);
    expect(d).toMatchObject({
      agentVersion: 1,
      currentVersion: 2,
      titleChanged: true,
      toPublished: null,
    });
    expect(d.toDraft).toMatchObject({ added: 1, removed: 2, truncated: false });
    expect(d.toDraft.changes).toEqual([
      { op: '+', line: '本人が直した1行目' },
      { op: '-', line: 'AIが書いた1行目' },
      { op: '-', line: 'AIが書いた最後' },
    ]);
    expect(s.staleAgentDrafts).toBe(1);
    expect(m.content[0].text).toContain('14日たっても公開していない下書き：1本');

    // Another student: none of f's reviews or drafts. The article's author gets no review either.
    const g = await connect('g');
    const gm = (await tool(g.access_token, 'get_my_taste_materials')).structuredContent as any;
    expect(gm.reviews.map((r: { note: string }) => r.note)).toEqual(['gのひとこと']);
    expect(gm.drafts.some((x: { draftId: string }) => x.draftId === draft.id)).toBe(false);
    const b = await connect('b');
    const bm = (await tool(b.access_token, 'get_my_taste_materials')).structuredContent as any;
    expect(bm.reviews).toEqual([]);

    // Deleting the draft deletes the agent's version with it.
    await (
      await db()
    )
      .prepare('DELETE FROM private_article_drafts WHERE id=?')
      .bind(draft.id)
      .run();
    expect(await versions(draft.id)).toBe(0);
  });

  it('diffs the agent version against the public article once the student publishes it', async () => {
    const f = await connect('f');
    const made = await tool(f.access_token, 'create_draft', {
      title: '公開する題',
      body: '## 本文\nAIの行',
    });
    const draft = made.structuredContent!.draft as { id: string; version: number };
    const published = await call<{ contentId?: string }>({
      action: 'publish',
      url: ORIGIN + '/private/publication',
      method: 'POST',
      headers: browser(users.f, true),
      draft: draft.id,
      input: {
        expectedVersion: draft.version,
        confirmPublic: true,
        summary: '概要',
        tags: ['学び'],
        minutes: 3,
      },
    });
    expect(published.contentId).toBeTruthy();
    const m = (await tool(f.access_token, 'get_my_taste_materials')).structuredContent as any;
    const d = m.drafts.find((x: { draftId: string }) => x.draftId === draft.id);
    expect(d.toPublished).toMatchObject({ added: 0, removed: 0 });
    expect(m.staleAgentDrafts).toBe(1);
  });

  it('answers 401 without a live connection and refuses to replace outside the enrollment period', async () => {
    expect(
      (await rpc('ksh_at_' + 'y'.repeat(43), 'tools/call', { name: 'get_my_taste' })).status,
    ).toBe(401);
    const h = await connect('h');
    expect((await rpc(h.access_token, 'tools/call', { name: 'get_my_taste' })).status).toBe(200);
    const list = JSON.parse(
      (await http('/api/private/agent-connections', { headers: browser(users.h) }))!.body,
    );
    for (const conn of list.connections)
      await http('/api/private/agent-connections/' + conn.id, {
        method: 'DELETE',
        headers: browser(users.h, true),
      });
    for (const name of ['get_my_taste', 'get_my_taste_materials', 'replace_my_taste'])
      expect(
        (
          await rpc(h.access_token, 'tools/call', {
            name,
            arguments: name === 'replace_my_taste' ? { lines: [], expected_version: 0 } : {},
          })
        ).status,
      ).toBe(401);
    const h2 = await connect('h');
    await (
      await db()
    )
      .prepare("UPDATE private_accounts SET status='suspended' WHERE id='account-h'")
      .run();
    expect(
      (await rpc(h2.access_token, 'tools/call', { name: 'get_my_taste_materials' })).status,
    ).toBe(401);
    const e = await connect('e');
    const r = await tool(e.access_token, 'replace_my_taste', {
      lines: [line('卒業後')],
      expected_version: 0,
    });
    expect(r.content[0].text).toContain('在籍期間');
    expect((await tool(e.access_token, 'get_my_taste')).structuredContent!.version).toBe(0);
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
