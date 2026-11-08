import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import {
  dispatchModerationEmails,
  moderationEmailOptions,
  type ModerationEmailOptions,
} from '../worker/moderation-email';
import production from '../worker/index';
type FakeSend = (message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>;
const NOW = 1800000000000;
let mf: Miniflare, db: D1Database;
async function reports(n: number, target = 'learning-notes') {
  for (let i = 0; i < n; i++)
    await db
      .prepare(
        'INSERT INTO article_reports(id,content_id,reporter_account_id,round,reason,detail,created_at_ms) VALUES(?,?,?,1,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        target,
        'reporter-' + i,
        'PRIVATE_REPORT_REASON',
        'PRIVATE_REPORT_DETAIL',
        NOW + i,
      )
      .run();
}
function options(send: FakeSend): ModerationEmailOptions {
  return {
    email: { send },
    from: 'notify@example.invalid',
    to: 'verified-operator@example.invalid',
    origin: 'https://app.example.invalid',
  };
}
const state = async () =>
  (
    await db
      .prepare(
        'SELECT state,attempts,provider_message_id FROM moderation_email_deliveries ORDER BY outbox_id',
      )
      .all()
  ).results;
beforeEach(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("local")}}',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const name of readdirSync('migrations')
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + name, 'utf8');
    const parts = raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/);
    for (const sql of parts.map((x) => x.replace(/^--.*$/gm, '').trim()).filter(Boolean))
      await db.prepare(sql).run();
  }
  for (let i = 0; i < 3; i++)
    await db
      .prepare("INSERT INTO private_accounts VALUES(?,?,?,'active',0,?)")
      .bind('reporter-' + i, 'PRIVATE_SUBJECT_' + i, 'private-' + i + '@example.invalid', NOW)
      .run();
});
afterEach(async () => mf?.dispose());
describe('optional moderation email spool with real D1 and fake SendEmail', () => {
  it('does nothing with absent/invalid binding and keeps the production scheduled source gate closed', async () => {
    const forbidden = new Proxy(db, {
      get() {
        throw Error('Storage must remain untouched');
      },
    });
    expect(await dispatchModerationEmails(forbidden, null)).toEqual({
      enabled: false,
      attempted: 0,
      accepted: 0,
      failed: 0,
      unknown: 0,
    });
    const send = vi.fn<FakeSend>(async () => ({ messageId: 'unused' }));
    expect(moderationEmailOptions({}, 'https://app.example.invalid')).toBeNull();
    expect(
      moderationEmailOptions(
        {
          MODERATION_EMAIL: { send },
          MODERATION_EMAIL_FROM: 'x@example.invalid',
          MODERATION_EMAIL_TO: 'first@example.invalid,second@example.invalid',
        },
        'https://app.example.invalid',
      ),
    ).toBeNull();
    expect(
      moderationEmailOptions(
        {
          MODERATION_EMAIL: { send },
          MODERATION_EMAIL_FROM: 'x@example.invalid',
          MODERATION_EMAIL_TO: 'one@example.invalid',
        },
        'http://app.example.invalid',
      ),
    ).toBeNull();
    const waitUntil = vi.fn();
    await production.scheduled(
      {} as ScheduledController,
      new Proxy({} as Env, {
        get() {
          throw Error('Closed source gate');
        },
      }),
      new Proxy({} as ExecutionContext, {
        get(_target, key) {
          if (key === 'waitUntil') return waitUntil;
          throw Error('Closed context');
        },
      }),
    );
    expect(waitUntil).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('atomically claims each report once under concurrent dispatch and persists provider acceptance without delivery claims', async () => {
    await reports(1);
    const send = vi.fn<FakeSend>(async () => ({ messageId: 'provider-receipt-1' }));
    await Promise.all([
      dispatchModerationEmails(db, options(send), () => NOW + 10),
      dispatchModerationEmails(db, options(send), () => NOW + 10),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await state()).toEqual([
      { state: 'accepted', attempts: 1, provider_message_id: 'provider-receipt-1' },
    ]);
    const payload = send.mock.calls[0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        from: 'notify@example.invalid',
        to: 'verified-operator@example.invalid',
      }),
    );
    expect(JSON.stringify(payload)).not.toMatch(
      /PRIVATE_REPORT|PRIVATE_SUBJECT|private-[0-9]|reporter-/,
    );
    expect(payload).toEqual(
      expect.objectContaining({
        text: expect.stringContaining('/moderation?case=learning-notes'),
        html: expect.stringContaining('運営画面で確認する'),
      }),
    );
    expect((await db.prepare('SELECT state FROM article_report_outbox').first())?.state).toBe(
      'pending',
    );
  });
  it('notifies first/second/third reports and caps one invocation at five attempts', async () => {
    await reports(3);
    await reports(3, 'git-branches');
    const send = vi.fn<FakeSend>(async () => ({ messageId: crypto.randomUUID() }));
    const result = await dispatchModerationEmails(db, options(send), () => NOW + 10);
    expect(result.attempted).toBe(5);
    expect(result.accepted).toBe(5);
    expect(send).toHaveBeenCalledTimes(5);
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM content WHERE id IN ('learning-notes','git-branches') AND status='hidden'",
          )
          .first()
      )?.n,
    ).toBe(2);
  });
  it('records a documented API rejection as known failure and never retries it automatically', async () => {
    await reports(1);
    const send = vi.fn<FakeSend>(async () => {
      throw { code: 'E_SENDER_NOT_VERIFIED', message: 'PRIVATE_PROVIDER_ADDRESS' };
    });
    expect((await dispatchModerationEmails(db, options(send), () => NOW + 10)).failed).toBe(1);
    await dispatchModerationEmails(db, options(send), () => NOW + 11);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await state()).toEqual([{ state: 'failed', attempts: 1, provider_message_id: null }]);
  });
  it('keeps generic provider errors and malformed acknowledgements unknown rather than resending', async () => {
    await reports(1);
    const send = vi.fn<FakeSend>(async () => ({ messageId: ' ' }));
    expect((await dispatchModerationEmails(db, options(send), () => NOW + 10)).unknown).toBe(1);
    await dispatchModerationEmails(db, options(send), () => NOW + 11);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await state())[0].state).toBe('unknown');
  });
  it('keeps a timeout unknown even if a valid provider receipt arrives later', async () => {
    await reports(1);
    let release!: (value: EmailSendResult) => void;
    const send = vi.fn<FakeSend>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    expect((await dispatchModerationEmails(db, options(send), () => NOW + 10, 5)).unknown).toBe(1);
    release({ messageId: 'late-receipt' });
    await Promise.resolve();
    await Promise.resolve();
    await dispatchModerationEmails(db, options(send), () => NOW + 11);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await state())[0].state).toBe('unknown');
  });
  it('does not declare success or resend when receipt persistence fails after provider acceptance', async () => {
    await reports(1);
    const send = vi.fn<FakeSend>(async () => ({
      messageId: 'accepted-before-db-failure',
    }));
    const broken = new Proxy(db, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            if (sql.startsWith('UPDATE moderation_email_deliveries SET state=?'))
              throw Error('Synthetic receipt failure');
            return target.prepare(sql);
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect((await dispatchModerationEmails(broken, options(send), () => NOW + 10)).unknown).toBe(1);
    expect((await state())[0].state).toBe('leased');
    await dispatchModerationEmails(db, options(send), () => NOW + 30011);
    expect((await state())[0].state).toBe('unknown');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('preserves a committed accepted receipt when its database acknowledgement is lost', async () => {
    await reports(1);
    const send = vi.fn<FakeSend>(async () => ({ messageId: 'committed-receipt' }));
    const broken = new Proxy(db, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
              new Proxy(statement, {
                get(stmt, prop) {
                  if (prop === 'bind') return (...v: unknown[]) => wrap(stmt.bind(...v));
                  if (
                    prop === 'first' &&
                    sql.startsWith('UPDATE moderation_email_deliveries SET state=?')
                  )
                    return async () => {
                      await stmt.first();
                      throw Error('Lost DB acknowledgement');
                    };
                  const value = Reflect.get(stmt, prop);
                  return typeof value === 'function' ? value.bind(stmt) : value;
                },
              });
            return wrap(target.prepare(sql));
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect((await dispatchModerationEmails(broken, options(send), () => NOW + 10)).unknown).toBe(1);
    await dispatchModerationEmails(db, options(send), () => NOW + 11);
    expect((await state())[0].state).toBe('accepted');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
