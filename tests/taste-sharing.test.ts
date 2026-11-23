import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { decodeTasteAction } from '../src/shared/taste-ledger';

// C23 condition 4 (#243): the student's own ledger on the account screen and 「運営に見せる」.
const ORIGIN = 'https://app.example.invalid';
const NOW = 1_800_000_000_000;
const OWN = '/api/private/my-taste';
const SHARED = '/api/private/editorial-taste/shared';
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
type Http = { status: number; headers: Record<string, string>; body: string } | null;
type Line = { kind: string; text: string; basis: string; count?: number; date: string };
type View = { version: number; lines: (Line & { shared: boolean })[] };
let users: Record<string, Session>;

async function call<T>(input: Record<string, unknown>): Promise<T> {
  return (await (
    await mf.dispatchFetch('https://fixture.test', {
      method: 'POST',
      body: JSON.stringify({ now: NOW, ...input }),
    })
  ).json()) as T;
}
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
const http = (
  p: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; action?: string } = {},
) => call<Http>({ action: init.action ?? 'http', url: ORIGIN + p, ...init });
const own = async (who: string) => {
  const r = await http(OWN, { headers: browser(users[who]) });
  expect(r!.status).toBe(200);
  return JSON.parse(r!.body) as View;
};
const act = (who: string, view: View, op: string, index: number, extra = {}) =>
  http(OWN, {
    method: 'POST',
    headers: browser(users[who], true),
    body: JSON.stringify({
      op,
      version: view.version,
      index,
      kind: view.lines[index].kind,
      text: view.lines[index].text,
      ...extra,
    }),
  });
const shared = async (who = 'a') => {
  const r = await http(SHARED, { headers: browser(users[who]) });
  expect(r!.status).toBe(200);
  return r!.body;
};
const line = (text: string, kind = 'writing'): Line => ({
  kind,
  text,
  basis: 'reviews',
  count: 3,
  date: '2026-11-23',
});
const db = () => mf.getD1Database('DB');
async function seedLedger(account: string, lines: Line[], version = 1) {
  await (
    await db()
  )
    .prepare(
      'INSERT INTO agent_taste_ledgers(account_id,version,lines_json,updated_at_ms) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET version=excluded.version,lines_json=excluded.lines_json',
    )
    .bind(account, version, JSON.stringify(lines), NOW - 1000)
    .run();
}
const count = async (sql: string, ...args: unknown[]) =>
  (await (
    await db()
  )
    .prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        { type: 'ESModule', path: '.worker/taste-sharing-test.js' },
        ...readdirSync('.worker')
          .filter((n) => n.endsWith('.wasm'))
          .map((n) => ({ type: 'CompiledWasm' as const, path: '.worker/' + n })),
      ],
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const d = await db();
  for (const file of readdirSync('migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + file, 'utf8');
    const statements = (
      raw.includes('-- @statement') ? raw.split(/^-- @statement\s*$/m) : raw.split(/;\s*(?:\n|$)/)
    )
      .map((sql) => sql.replace(/^--.*$/gm, '').trim())
      .filter(Boolean);
    await d.batch(statements.map((sql) => d.prepare(sql)));
  }
  for (const who of ['a', 'b', 'c', 'e', 'z'])
    await d
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + who, 'subject-' + who, who + '@st.kobedenshi.ac.jp', NOW)
      .run();
  await d
    .prepare(
      "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES('pub-b','公開名B','分野','学年','自己紹介','B',0)",
    )
    .run();
  await d
    .prepare(
      "INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES('account-b','pub-b')",
    )
    .run();
  users = {};
  for (const who of ['a', 'b', 'c']) users[who] = await call<Session>({ action: 'session', who });
  // "e" has a live session but no enrollment period (graduated / not yet declared).
  users.e = await call<Session>({ action: 'session', who: 'e', enrollment: false });
  await seedLedger('account-b', [
    line('結論を先に書く'),
    line('手順は番号つきの箇条書きにする'),
    line('設定画面はアイコンで足りる', 'app'),
  ]);
  await seedLedger('account-c', [line('Cさんだけの行')]);
  await seedLedger('account-e', [line('卒業後の行')]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe('taste sharing (C23 condition 4, flag TASTE_SHARING_RELEASE_ENABLED)', () => {
  it('stays out of the composed handler while the flag is closed', async () => {
    expect(await http(OWN, { headers: browser(users.b), action: 'closed' })).toBeNull();
    expect(await http(SHARED, { headers: browser(users.a), action: 'closed' })).toBeNull();
  });

  it('lists only the signed-in student own ledger, none shown by default', async () => {
    expect((await http(OWN))!.status).toBe(401);
    const b = await own('b');
    expect(b.version).toBe(1);
    expect(b.lines.map((l) => [l.text, l.shared])).toEqual([
      ['結論を先に書く', false],
      ['手順は番号つきの箇条書きにする', false],
      ['設定画面はアイコンで足りる', false],
    ]);
    expect(JSON.stringify(b)).not.toContain('Cさん');
    const a = await own('a');
    expect(a).toEqual({ version: 0, lines: [] });
    expect(await shared()).toBe('{"lines":[]}');
  });

  it('shows a line to operators only after the student presses it, without who wrote it', async () => {
    const b = await own('b');
    const r = await act('b', b, 'share', 2);
    expect(r!.status).toBe(200);
    const after = JSON.parse(r!.body) as View;
    expect(after.version).toBe(1);
    expect(after.lines.map((l) => l.shared)).toEqual([false, false, true]);
    const body = await shared();
    expect(JSON.parse(body)).toEqual({
      lines: [
        {
          kind: 'app',
          text: '設定画面はアイコンで足りる',
          basis: 'reviews',
          count: 3,
          date: '2026-11-23',
        },
      ],
    });
    for (const secret of ['account-', 'pub-b', '公開名B', 'subject-', '@st.kobedenshi'])
      expect(body).not.toContain(secret);
    // Anyone but the operator gets 404, the same as an unknown path.
    for (const who of ['b', 'c', 'e'])
      expect((await http(SHARED, { headers: browser(users[who]) }))!.status).toBe(404);
    expect((await http(SHARED))!.status).toBe(404);
    expect((await http(SHARED, { method: 'POST', headers: browser(users.a, true) }))!.status).toBe(
      405,
    );
  });

  it('needs the CSRF proof, the current version and the same line text', async () => {
    const b = await own('b');
    const noCsrf = await http(OWN, {
      method: 'POST',
      headers: { ...browser(users.b, true), Authorization: '' },
      body: JSON.stringify({
        op: 'share',
        version: 1,
        index: 0,
        kind: 'writing',
        text: '結論を先に書く',
      }),
    });
    expect(noCsrf!.status).toBe(401);
    expect((await act('b', b, 'share', 0, { version: 2 }))!.status).toBe(409);
    expect(
      (await act('b', b, 'share', 0, { text: '手順は番号つきの箇条書きにする' }))!.status,
    ).toBe(409);
    // Another student's line cannot be named from someone else's session.
    const c = await own('c');
    expect((await act('b', c, 'share', 0))!.status).toBe(409);
    expect((await own('b')).lines[0].shared).toBe(false);
    expect(await shared()).not.toContain('Cさん');
    for (const bad of [
      { op: 'publish', version: 1, index: 0, kind: 'writing', text: 'x' },
      { op: 'share', version: 0, index: 0, kind: 'writing', text: 'x' },
      { op: 'share', version: 1, index: 40, kind: 'writing', text: 'x' },
      { op: 'share', version: 1, index: 0, kind: 'other', text: 'x' },
      { op: 'share', version: 1, index: 0, kind: 'writing', text: 'a\nb' },
      { op: 'share', version: 1, index: 0, kind: 'writing', text: 'x', accountId: 'account-c' },
    ]) {
      expect(decodeTasteAction(bad)).toBeNull();
      const r = await http(OWN, {
        method: 'POST',
        headers: browser(users.b, true),
        body: JSON.stringify(bad),
      });
      expect(r!.status).toBe(400);
    }
  });

  it('hides a shown line again when the student turns it off', async () => {
    const b = await own('b');
    expect(b.lines[2].shared).toBe(true);
    const r = await act('b', b, 'unshare', 2);
    expect(r!.status).toBe(200);
    expect((JSON.parse(r!.body) as View).lines[2].shared).toBe(false);
    expect(await shared()).toBe('{"lines":[]}');
  });

  it('deletes one line under the version check, and its share with it', async () => {
    let b = await own('b');
    expect((await act('b', b, 'share', 1))!.status).toBe(200);
    b = await own('b');
    const r = await act('b', b, 'delete', 1);
    expect(r!.status).toBe(200);
    const after = JSON.parse(r!.body) as View;
    expect(after.version).toBe(2);
    expect(after.lines.map((l) => l.text)).toEqual([
      '結論を先に書く',
      '設定画面はアイコンで足りる',
    ]);
    expect(
      await count("SELECT count(*) AS n FROM agent_taste_shares WHERE account_id='account-b'"),
    ).toBe(0);
    expect(await shared()).toBe('{"lines":[]}');
    // The old version no longer matches.
    expect((await act('b', b, 'delete', 0))!.status).toBe(409);
  });

  it('lets a student outside the enrollment period delete but not show lines', async () => {
    const e = await own('e');
    expect((await act('e', e, 'share', 0))!.status).toBe(403);
    expect(
      await count("SELECT count(*) AS n FROM agent_taste_shares WHERE account_id='account-e'"),
    ).toBe(0);
    const r = await act('e', e, 'delete', 0);
    expect(r!.status).toBe(200);
    expect(JSON.parse(r!.body)).toEqual({ version: 2, lines: [] });
  });

  it('never shows a line that is no longer in the author ledger, or from a suspended account', async () => {
    const c = await own('c');
    expect((await act('c', c, 'share', 0))!.status).toBe(200);
    expect(await shared()).toContain('Cさんだけの行');
    await (
      await db()
    )
      .prepare("UPDATE private_accounts SET status='suspended' WHERE id='account-c'")
      .run();
    expect(await shared()).toBe('{"lines":[]}');
    await (
      await db()
    )
      .prepare("UPDATE private_accounts SET status='active' WHERE id='account-c'")
      .run();
    // A ledger changed without the cleanup (defence in depth): the join still hides the line.
    await seedLedger('account-c', [line('Cさんの書き換えた行')], 2);
    expect(await shared()).toBe('{"lines":[]}');
  });

  it('removes the ledger, its shares and the agent versions when the account is deleted', async () => {
    const d = await db();
    await seedLedger('account-z', [line('消える行')]);
    await d
      .prepare(
        "INSERT INTO agent_taste_shares(account_id,kind,text,shared_at_ms) VALUES('account-z','writing','消える行',?)",
      )
      .bind(NOW)
      .run();
    await d
      .prepare(
        "INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms) VALUES('00000000-0000-4000-8000-000000000001','account-z','t','b',1,?)",
      )
      .bind(NOW)
      .run();
    const draft = (await d
      .prepare("SELECT id FROM private_article_drafts WHERE owner_account_id='account-z'")
      .first<{ id: string }>())!.id;
    await d
      .prepare(
        "INSERT INTO agent_draft_versions(draft_id,account_id,title,body,draft_version,recorded_at_ms) VALUES(?,'account-z','t','b',1,?)",
      )
      .bind(draft, NOW)
      .run();
    await d.prepare("DELETE FROM private_accounts WHERE id='account-z'").run();
    for (const table of ['agent_taste_ledgers', 'agent_taste_shares', 'agent_draft_versions'])
      expect(await count(`SELECT count(*) AS n FROM ${table} WHERE account_id='account-z'`)).toBe(
        0,
      );
  });
});
