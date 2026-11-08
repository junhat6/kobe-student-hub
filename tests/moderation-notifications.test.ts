import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { dispatchModerationEmails } from '../worker/moderation-email';
import type { EmailDeliverySummary, OwnModerationNotice } from '../src/notification-types';
const ORIGIN = 'https://app.example.invalid',
  NOW = 1800000000000;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare, db: D1Database, articleId: string;
const users: Session[] = [];
const credentials = (who: number) => ({
  Cookie: [users[who].setCookie, users[who].contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + users[who].csrfToken,
  'Content-Type': 'application/json',
});
async function request(path: string, method = 'GET', who = 0, body?: unknown, extra = {}) {
  const r = await mf.dispatchFetch(ORIGIN + path, {
    method,
    headers: {
      'X-Test-Ordinary': 'enabled',
      'X-Test-Operators': '["account-0"]',
      ...credentials(who),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(r.headers.get('Vary')).toBe('Cookie');
  expect(r.headers.has('Set-Cookie')).toBe(false);
  return r;
}
const queuePath = '/api/private/moderation/notifications';
async function queue() {
  const r = await request(queuePath);
  expect(r.status).toBe(200);
  return (await r.json()) as EmailDeliverySummary[];
}
const options = (send: SendEmail['send']) => ({
  email: { send },
  from: 'notice@example.invalid',
  to: 'verified-ops@example.invalid',
  origin: ORIGIN,
});
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/publication-http-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: () => {
        throw Error('Unexpected outbound request');
      },
    }),
  );
  db = await mf.getD1Database('DB');
  for (const name of readdirSync('migrations')
    .filter((v) => v.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + name, 'utf8');
    const parts = raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/);
    for (const sql of parts.map((v) => v.replace(/^--.*$/gm, '').trim()).filter(Boolean))
      await db.prepare(sql).run();
  }
  for (let i = 0; i < 5; i++) {
    await db
      .prepare("INSERT INTO private_accounts VALUES(?,?,?,'active',0,?)")
      .bind('account-' + i, 'subject-' + i, 'private-' + i + '@st.kobedenshi.ac.jp', NOW)
      .run();
    users.push(
      (await (
        await mf.dispatchFetch(ORIGIN + '/fixture/session', {
          headers: { 'X-Test-Who': String(i) },
        })
      ).json()) as Session,
    );
  }
  expect(
    (
      await request('/api/private/profile', 'POST', 1, {
        displayName: 'Public author',
        confirmPublic: true,
      })
    ).status,
  ).toBe(201);
  const draft = await request('/api/private/drafts', 'POST', 1, {
    title: 'The owner article',
    body: 'Published body',
  });
  expect(draft.status).toBe(201);
  const { id } = (await draft.json()) as { id: string };
  const published = await request('/api/private/publications/' + id, 'POST', 1, {
    expectedVersion: 1,
    confirmPublic: true,
    summary: 'Summary',
    tags: [],
    minutes: 1,
  });
  expect(published.status).toBe(201);
  articleId = ((await published.json()) as { contentId: string }).contentId;
  for (let who = 2; who <= 4; who++)
    expect(
      (
        await request('/api/private/reports/' + articleId, 'POST', who, {
          reason: 'PRIVATE_REPORTER_REASON_' + who,
          detail: 'PRIVATE_REPORTER_DETAIL',
        })
      ).status,
    ).toBe(200);
});
afterAll(async () => mf?.dispose());
describe('notification ownership, operator roles and bounded manual retry', () => {
  it('shows only the owner a temporary-hide explanation, never reporter information', async () => {
    const response = await request('/api/private/notifications', 'GET', 1);
    expect(response.status).toBe(200);
    const notices = (await response.json()) as OwnModerationNotice[];
    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual(
      expect.objectContaining({
        kind: 'temporarily_hidden',
        contentId: articleId,
        title: 'The owner article',
      }),
    );
    expect(JSON.stringify(notices)).not.toMatch(
      /PRIVATE_REPORTER|subject-|account-|st\.kobedenshi/,
    );
    expect(await (await request('/api/private/notifications', 'GET', 2)).json()).toEqual([]);
    expect(
      (await request('/api/private/notifications', 'GET', 1, undefined, { Cookie: 'invalid' }))
        .status,
    ).toBe(401);
  });
  it('protects delivery metadata and queue writes with server operator role, session and CSRF', async () => {
    const records = await queue();
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.state === 'pending' && r.attempts === 0)).toBe(true);
    expect((await request(queuePath, 'GET', 1)).status).toBe(404);
    const send = vi.fn(async () => {
      throw { code: 'E_RECIPIENT_NOT_ALLOWED', message: 'PRIVATE_PROVIDER_ADDRESS' };
    });
    expect((await dispatchModerationEmails(db, options(send), () => NOW)).failed).toBe(3);
    const failed = (await queue())[0];
    const input = { retryCommandId: crypto.randomUUID(), expectedAttempts: 1, confirmRetry: true };
    expect(
      (await request(queuePath + '/' + failed.outboxId + '/retry', 'POST', 1, input)).status,
    ).toBe(404);
    expect(
      (
        await request(queuePath + '/' + failed.outboxId + '/retry', 'POST', 0, input, {
          Authorization: 'Bearer csrf.' + 'x'.repeat(43),
        })
      ).status,
    ).toBe(401);
    expect((await queue()).every((r) => r.state === 'failed' && r.attempts === 1)).toBe(true);
    expect(JSON.stringify(await queue())).not.toMatch(
      /PRIVATE_PROVIDER_ADDRESS|provider_message_id|@|PRIVATE_REPORTER/,
    );
  });
  it('makes an explicit retry idempotent across acknowledgement loss and never requeues an accepted notification', async () => {
    const failed = (await queue())[0],
      input = { retryCommandId: crypto.randomUUID(), expectedAttempts: 1, confirmRetry: true };
    for (let n = 0; n < 2; n++) {
      const r = await request(queuePath + '/' + failed.outboxId + '/retry', 'POST', 0, input);
      expect(r.status).toBe(200);
      expect(((await r.json()) as EmailDeliverySummary).state).toBe('ready');
    }
    const send = vi.fn(async () => ({ messageId: 'provider-accepted' }));
    expect((await dispatchModerationEmails(db, options(send), () => NOW)).accepted).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const receipt = await request(queuePath + '/' + failed.outboxId + '/retry', 'POST', 0, input);
    expect(receipt.status).toBe(200);
    expect(((await receipt.json()) as EmailDeliverySummary).state).toBe('accepted');
    expect(
      (
        await request(queuePath + '/' + failed.outboxId + '/retry', 'POST', 0, {
          ...input,
          retryCommandId: crypto.randomUUID(),
          expectedAttempts: 2,
        })
      ).status,
    ).toBe(404);
  });
  it('caps known-failure retries at three lifetime attempts', async () => {
    const selected = (await queue()).find((r) => r.state === 'failed')!;
    const send = vi.fn(async () => {
      throw { code: 'E_SENDER_NOT_VERIFIED' };
    });
    for (let attempts = 1; attempts < 3; attempts++) {
      expect(
        (
          await request(queuePath + '/' + selected.outboxId + '/retry', 'POST', 0, {
            retryCommandId: crypto.randomUUID(),
            expectedAttempts: attempts,
            confirmRetry: true,
          })
        ).status,
      ).toBe(200);
      expect((await dispatchModerationEmails(db, options(send), () => NOW)).failed).toBe(1);
    }
    expect((await queue()).find((r) => r.outboxId === selected.outboxId)?.attempts).toBe(3);
    expect(
      (
        await request(queuePath + '/' + selected.outboxId + '/retry', 'POST', 0, {
          retryCommandId: crypto.randomUUID(),
          expectedAttempts: 3,
          confirmRetry: true,
        })
      ).status,
    ).toBe(404);
    await dispatchModerationEmails(db, options(send), () => NOW);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('never turns an unknown delivery into a retry through the operator API', async () => {
    const selected = (await queue()).find((r) => r.state === 'failed' && r.attempts === 1)!;
    expect(
      (
        await request(queuePath + '/' + selected.outboxId + '/retry', 'POST', 0, {
          retryCommandId: crypto.randomUUID(),
          expectedAttempts: 1,
          confirmRetry: true,
        })
      ).status,
    ).toBe(200);
    const send = vi.fn(async () => {
      throw Error('Unknown transport acknowledgement');
    });
    await dispatchModerationEmails(db, options(send), () => NOW);
    const current = (await queue()).find((r) => r.outboxId === selected.outboxId)!;
    expect(current.state).toBe('unknown');
    expect(current.attempts).toBe(2);
    expect(
      (
        await request(queuePath + '/' + selected.outboxId + '/retry', 'POST', 0, {
          retryCommandId: crypto.randomUUID(),
          expectedAttempts: 2,
          confirmRetry: true,
        })
      ).status,
    ).toBe(404);
  });
  it('gives the owner restoration/deletion reasons and keeps failed mail from changing publication decisions', async () => {
    expect(
      (await db.prepare('SELECT status FROM content WHERE id=?').bind(articleId).first())?.status,
    ).toBe('hidden');
    async function decide(action: 'restore' | 'delete', reason: string) {
      const url = '/api/private/moderation/cases/' + articleId + '/decision';
      const state = (await (await request(url)).json()) as { round: number; version: number };
      expect(
        (
          await request(url, 'POST', 0, {
            decisionId: crypto.randomUUID(),
            expectedRound: state.round,
            expectedVersion: state.version,
            action,
            reason,
          })
        ).status,
      ).toBe(200);
    }
    await decide('restore', 'PRIVATE_OWNER_RESTORE_REASON');
    expect(
      (
        await request('/api/private/reports/' + articleId, 'POST', 2, {
          reason: 'New round private report',
          detail: '',
        })
      ).status,
    ).toBe(200);
    await decide('delete', 'PRIVATE_OWNER_DELETE_REASON');
    const notices = (await (
      await request('/api/private/notifications', 'GET', 1)
    ).json()) as OwnModerationNotice[];
    expect(notices).toHaveLength(3);
    expect(notices.map((r) => r.reason)).toContain('PRIVATE_OWNER_RESTORE_REASON');
    expect(notices.map((r) => r.reason)).toContain('PRIVATE_OWNER_DELETE_REASON');
    expect(JSON.stringify(notices)).not.toMatch(
      /PRIVATE_REPORTER|subject-|account-|st\.kobedenshi/,
    );
    expect(await (await request('/api/private/notifications', 'GET', 2)).json()).toEqual([]);
  });
});
