import { afterEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { PendingRegistrationStore } from '../worker/auth/pending-registration';
import { SessionStore, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../worker/auth/sessions';
import { PrivateDraftStore } from '../worker/drafts';
import { BrowserSessionCoordinator, browserDigest } from '../worker/auth/browser-session';
import { OAuthAttemptStore } from '../worker/auth/oauth-attempts';
import { GoogleLoginBroker } from '../worker/auth/google-login';
import { BrowserOAuthFlow } from '../worker/auth/browser-flow';
const NOW = 1_800_000_000_000,
  ORIGIN = 'https://migration.example.invalid';
const instances: Miniflare[] = [];
const statements = (path: string, marked = false) =>
  readFileSync(path, 'utf8')
    .split(marked ? /^-- @statement\s*$/m : /;\s*(?:\n|$)/)
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
async function database(upgrade = true) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("fixture")}}',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  instances.push(mf);
  const db = await mf.getD1Database('DB');
  for (const file of ['0003_oauth_attempts.sql', '0004_private_sessions.sql'])
    for (const sql of statements('migrations/' + file)) await db.prepare(sql).run();
  await db.batch(
    ['a', 'b', 'c'].map((id) =>
      db
        .prepare(
          'INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,?,?)',
        )
        .bind(id, 'subject-' + id, id + '@st.kobedenshi.ac.jp', 'active', NOW),
    ),
  );
  if (upgrade) await migrate(db);
  return db as unknown as D1Database;
}
async function migrate(db: any) {
  await db.batch(
    statements('migrations/0012_browser_session_order.sql', true).map((sql) => db.prepare(sql)),
  );
}
async function pendingAttempt(
  db: D1Database,
  origin: string,
  now: number,
  intent: 'login' | 'pending-registration' = 'login',
) {
  const coordinator = new BrowserSessionCoordinator(db, origin, () => now);
  const bootstrap = (await coordinator.bootstrap(
    new Request(origin + '/api/auth/bootstrap', { method: 'POST', headers: { Origin: origin } }),
  ))!;
  const contextCookie = bootstrap.setCookie,
    headers = new Headers({ Origin: origin, Cookie: contextCookie.split(';')[0] });
  const command = (await coordinator.command(
    new Request(origin + '/api/auth/command', { method: 'POST', headers }),
    intent,
  ))!;
  headers.set('Authorization', 'Bearer command.' + command.commandToken);
  const flow = new BrowserOAuthFlow(
    db,
    {
      origin,
      clientId: 'fixture.apps.googleusercontent.com',
      cookieKey: new Uint8Array(32).fill(29),
    },
    () => now,
  );
  const start = (await flow.start(
    new Request(origin + '/api/auth/start', { method: 'POST', headers }),
    intent,
  ))!;
  const state = new URL(start.location).searchParams.get('state')!;
  return {
    flow,
    contextCookie,
    callback: new Request(origin + '/api/auth/callback?state=' + state + '&code=fictional', {
      headers: { Cookie: contextCookie.split(';')[0] + '; ' + start.setCookie.split(';')[0] },
    }),
  };
}
async function fixtureClaim(
  db: D1Database,
  origin: string,
  now: number,
  intent: 'login' | 'pending-registration' = 'login',
) {
  const pending = await pendingAttempt(db, origin, now, intent);
  const result = await pending.flow.claim(pending.callback, intent);
  return result?.kind === 'code'
    ? { proof: result.proof, contextCookie: pending.contextCookie }
    : null;
}
async function createFixtureSession(
  db: D1Database,
  origin: string,
  clock: () => number,
  who: ReturnType<typeof identity>,
) {
  const claim = await fixtureClaim(db, origin, clock());
  if (!claim) return null;
  const session = await new SessionStore(db, origin, clock).create(who, claim.proof);
  return session ? { ...session, contextCookie: claim.contextCookie } : null;
}
const identity = (id = 'a') => ({
  provider: 'google' as const,
  subject: 'subject-' + id,
  email: id + '@st.kobedenshi.ac.jp',
});
const request = (session: { setCookie: string; contextCookie: string }) =>
  new Request(ORIGIN + '/private', {
    headers: {
      Cookie: [session.setCookie, session.contextCookie].map((v) => v.split(';')[0]).join('; '),
    },
  });
const fence = async (db: D1Database) =>
  (await db
    .prepare('SELECT generation FROM auth_revocation_fence WHERE id=1')
    .first<{ generation: number }>())!.generation;
afterEach(async () => {
  await Promise.all(instances.splice(0).map((mf) => mf.dispose()));
});
describe('independent populated legacy migration and revocation fence', () => {
  it('revokes populated legacy sessions while preserving account and unrelated application rows', async () => {
    const db = await database(false);
    await db
      .prepare('CREATE TABLE qa_private_drafts(id TEXT PRIMARY KEY,account_id TEXT,body TEXT)')
      .run();
    await db
      .prepare("INSERT INTO qa_private_drafts VALUES('draft','a','fictional private draft')")
      .run();
    await db.prepare('CREATE TABLE qa_public_content(id TEXT PRIMARY KEY,title TEXT)').run();
    await db
      .prepare("INSERT INTO qa_public_content VALUES('public','fictional published sample')")
      .run();
    await db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms) VALUES(?,?,?,?,?,?)',
      )
      .bind(await browserDigest('session-v1', 'a'.repeat(43)), 'a', 0, NOW, NOW, NOW + 10000)
      .run();
    const accounts = await db.prepare('SELECT * FROM private_accounts ORDER BY id').all();
    await migrate(db);
    expect(
      await db.prepare('SELECT revoked_at_ms,context_hash,attempt_hash FROM auth_sessions').first(),
    ).toEqual({ revoked_at_ms: NOW, context_hash: null, attempt_hash: null });
    expect((await db.prepare('SELECT * FROM private_accounts ORDER BY id').all()).results).toEqual(
      accounts.results,
    );
    expect(await db.prepare('SELECT body FROM qa_private_drafts').first()).toEqual({
      body: 'fictional private draft',
    });
    expect(await db.prepare('SELECT title FROM qa_public_content').first()).toEqual({
      title: 'fictional published sample',
    });
    const store = new SessionStore(db, ORIGIN, () => NOW);
    expect(
      await store.authenticate(
        new Request(ORIGIN, {
          headers: {
            Cookie:
              '__Host-kobe-session=' + 'a'.repeat(43) + '; __Host-kobe-browser=' + 'b'.repeat(43),
          },
        }),
      ),
    ).toBeNull();
  });
  it('fails closed with missing migration schema and cannot create a legacy session', async () => {
    const db = await database(false),
      store = new SessionStore(db, ORIGIN, () => NOW);
    expect(
      await store.authenticate(
        new Request(ORIGIN, {
          headers: {
            Cookie:
              '__Host-kobe-session=' + 'a'.repeat(43) + '; __Host-kobe-browser=' + 'b'.repeat(43),
          },
        }),
      ),
    ).toBeNull();
    expect(
      await store.create(identity(), {
        stateHash: 'a'.repeat(64),
        owner: 'b'.repeat(43),
        contextHash: 'c'.repeat(64),
        generation: 1,
        fence: 0,
      }),
    ).toBeNull();
    expect((await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first())?.n).toBe(0);
  });
  it('rolls back the complete D1 migration batch on a late schema collision', async () => {
    const db = await database(false);
    await db.prepare('CREATE TABLE auth_browser_commands(collision TEXT)').run();
    await expect(migrate(db)).rejects.toThrow();
    expect(
      await db.prepare("SELECT name FROM sqlite_master WHERE name='auth_browser_contexts'").first(),
    ).toBeNull();
    expect(
      (await db.prepare('PRAGMA table_info(auth_sessions)').all<{ name: string }>()).results.some(
        (c) => c.name === 'context_hash',
      ),
    ).toBe(false);
  });
  it('binds completion to claim owner and permits only one session per attempt', async () => {
    const db = await database(),
      claim = (await fixtureClaim(db, ORIGIN, NOW))!,
      store = new SessionStore(db, ORIGIN, () => NOW);
    expect(claim).not.toBeNull();
    expect(await store.create(identity(), { ...claim.proof, owner: 'z'.repeat(43) })).toBeNull();
    expect(await store.create(identity(), claim.proof)).not.toBeNull();
    expect(await store.create(identity(), claim.proof)).toBeNull();
    const row = await db.prepare('SELECT * FROM auth_sessions').first<any>();
    await expect(
      db
        .prepare(
          'INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,context_hash,context_generation,attempt_hash) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          'f'.repeat(64),
          row.account_id,
          row.account_epoch,
          NOW,
          NOW,
          NOW + 1000,
          row.context_hash,
          row.context_generation,
          row.attempt_hash,
        )
        .run(),
    ).rejects.toThrow();
    expect(
      (
        await db
          .prepare('SELECT completed_at_ms FROM oauth_attempts WHERE state_hash=?')
          .bind(claim.proof.stateHash)
          .first()
      )?.completed_at_ms,
    ).toBe(NOW);
  });
  for (const change of ['epoch', 'status', 'delete'] as const)
    it(`${change} revokes only target-subject completions while unrelated pending and existing sessions survive`, async () => {
      const db = await database(),
        other = (await createFixtureSession(db, ORIGIN, () => NOW, identity('b')))!;
      const sameAccountOtherDevice = (await createFixtureSession(
        db,
        ORIGIN,
        () => NOW,
        identity('b'),
      ))!;
      const pendingA = (await fixtureClaim(db, ORIGIN, NOW))!,
        pendingB = (await fixtureClaim(db, ORIGIN, NOW))!;
      const unclaimedA = await pendingAttempt(db, ORIGIN, NOW),
        unclaimedB = await pendingAttempt(db, ORIGIN, NOW);
      expect(other).not.toBeNull();
      const before = await fence(db);
      await db
        .prepare(
          change === 'epoch'
            ? "UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id='a'"
            : change === 'status'
              ? "UPDATE private_accounts SET status='suspended' WHERE id='a'"
              : "DELETE FROM private_accounts WHERE id='a'",
        )
        .run();
      expect(await fence(db)).toBe(before + 1);
      if (change === 'status')
        await db.prepare("UPDATE private_accounts SET status='active' WHERE id='a'").run();
      if (change === 'delete')
        await db
          .prepare(
            "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('recreated-a','subject-a','a@st.kobedenshi.ac.jp','active',?)",
          )
          .bind(NOW)
          .run();
      const claimedA = await unclaimedA.flow.claim(unclaimedA.callback, 'login'),
        claimedB = await unclaimedB.flow.claim(unclaimedB.callback, 'login');
      expect(claimedA?.kind).toBe('code');
      expect(claimedB?.kind).toBe('code');
      const store = new SessionStore(db, ORIGIN, () => NOW);
      expect(await store.create(identity(), pendingA.proof)).toBeNull();
      expect(await store.create(identity('b'), pendingB.proof)).not.toBeNull();
      if (claimedA?.kind === 'code')
        expect(await store.create(identity(), claimedA.proof)).toBeNull();
      if (claimedB?.kind === 'code')
        expect(await store.create(identity('b'), claimedB.proof)).not.toBeNull();
      expect(await createFixtureSession(db, ORIGIN, () => NOW, identity())).not.toBeNull();
      expect(await store.authenticate(request(other))).not.toBeNull();
      expect(await store.authenticate(request(sameAccountOtherDevice))).not.toBeNull();
      expect(await createFixtureSession(db, ORIGIN, () => NOW, identity('b'))).not.toBeNull();
    });
  it('prevents deleted-subject registration replay while unrelated registration and fresh recreation work', async () => {
    const db = await database(),
      old = (await fixtureClaim(db, ORIGIN, NOW, 'pending-registration'))!,
      other = (await fixtureClaim(db, ORIGIN, NOW, 'pending-registration'))!;
    await db.prepare("DELETE FROM private_accounts WHERE id='a'").run();
    const registrations = new PendingRegistrationStore(db, () => NOW);
    expect(await registrations.record(identity(), old.proof)).toBeNull();
    expect(await registrations.record(identity('new-student'), other.proof)).toEqual({
      recorded: true,
    });
    const fresh = (await fixtureClaim(db, ORIGIN, NOW, 'pending-registration'))!;
    expect(await registrations.record(identity(), fresh.proof)).toEqual({ recorded: true });
    expect(
      (
        await db
          .prepare("SELECT status FROM private_accounts WHERE google_subject='subject-a'")
          .first()
      )?.status,
    ).toBe('pending');
    expect(await registrations.record(identity('new-student'), other.proof)).toBeNull();
  });
  it('retains floors while an old command is live and preserves its original stamp on delayed execution', async () => {
    const db = await database(),
      coordinator = new BrowserSessionCoordinator(db, ORIGIN, () => NOW);
    const bootstrap = (await coordinator.bootstrap(
      new Request(ORIGIN, { method: 'POST', headers: { Origin: ORIGIN } }),
    ))!;
    const headers = new Headers({ Origin: ORIGIN, Cookie: bootstrap.setCookie.split(';')[0] });
    const command = (await coordinator.command(
      new Request(ORIGIN, { method: 'POST', headers }),
      'login',
    ))!;
    headers.set('Authorization', 'Bearer command.' + command.commandToken);
    await db
      .prepare("UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id='a'")
      .run();
    expect(await coordinator.cleanupRevocations()).toBe(0);
    expect(
      (await db.prepare('SELECT minimum_generation FROM auth_revocation_fence').first())
        ?.minimum_generation,
    ).toBe(0);
    expect(
      await coordinator.execute(new Request(ORIGIN, { method: 'POST', headers }), 'login', {
        stateHash: 'd'.repeat(64),
        browserHash: 'e'.repeat(64),
        nonce: 'n'.repeat(43),
      }),
    ).toEqual({ kind: 'executed' });
    expect(
      (
        await db
          .prepare('SELECT revocation_fence FROM oauth_attempts WHERE state_hash=?')
          .bind('d'.repeat(64))
          .first()
      )?.revocation_fence,
    ).toBe(0);
  });
  it('cleans at most 100 floors, keeps live old snapshots, and cannot revive them after clock rollback', async () => {
    const db = await database(),
      oldClaim = (await fixtureClaim(db, ORIGIN, NOW))!,
      oldUnclaimed = await pendingAttempt(db, ORIGIN, NOW),
      oldRegistration = (await fixtureClaim(db, ORIGIN, NOW, 'pending-registration'))!;
    const rawContext = 'q'.repeat(43),
      rawCommand = 'r'.repeat(43),
      contextHash = await browserDigest('browser-v1', rawContext);
    await db
      .prepare(
        'INSERT INTO auth_browser_contexts(context_hash,created_at_ms,expires_at_ms) VALUES(?,?,?)',
      )
      .bind(contextHash, NOW, NOW + 28800000)
      .run();
    await db
      .prepare(
        "INSERT INTO auth_browser_commands(command_hash,context_hash,action,expected_generation,revocation_fence,created_at_ms,expires_at_ms) VALUES(?,?,'login',0,0,?,?)",
      )
      .bind(await browserDigest('command-v1', rawCommand), contextHash, NOW, NOW + 60000)
      .run();
    await db.batch(
      Array.from({ length: 105 }, (_, i) =>
        db
          .prepare(
            'INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,?,?)',
          )
          .bind(
            'bulk-' + i,
            'bulk-subject-' + i,
            'bulk-' + i + '@st.kobedenshi.ac.jp',
            'active',
            NOW,
          ),
      ),
    );
    await db
      .prepare("UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id LIKE 'bulk-%'")
      .run();
    expect(await new BrowserSessionCoordinator(db, ORIGIN, () => NOW).cleanupRevocations()).toBe(0);
    const later = new BrowserSessionCoordinator(db, ORIGIN, () => NOW + 600001);
    expect(await later.cleanupRevocations()).toBe(100);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM auth_subject_fences').first())?.n).toBe(5);
    expect(await later.cleanupRevocations()).toBe(5);
    expect(
      (await db.prepare('SELECT minimum_generation FROM auth_revocation_fence').first())
        ?.minimum_generation,
    ).toBe(105);
    expect(await oldUnclaimed.flow.claim(oldUnclaimed.callback, 'login')).toBeNull();
    expect(
      await new PendingRegistrationStore(db, () => NOW).record(
        identity('retired-registration'),
        oldRegistration.proof,
      ),
    ).toBeNull();
    expect(
      await new BrowserSessionCoordinator(db, ORIGIN, () => NOW).execute(
        new Request(ORIGIN, {
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            Cookie: '__Host-kobe-browser=' + rawContext,
            Authorization: 'Bearer command.' + rawCommand,
          },
        }),
        'login',
        { stateHash: '1'.repeat(64), browserHash: '2'.repeat(64), nonce: '3'.repeat(43) },
      ),
    ).toEqual({ kind: 'rejected' });
    expect(
      await new SessionStore(db, ORIGIN, () => NOW).create(identity(), oldClaim.proof),
    ).toBeNull();
    expect(await createFixtureSession(db, ORIGIN, () => NOW, identity())).not.toBeNull();
  });
  it('rolls back watermark advancement when subject-floor cleanup fails', async () => {
    const db = await database();
    await db.prepare("DELETE FROM private_accounts WHERE id='a'").run();
    await db
      .prepare(
        "CREATE TRIGGER qa_abort_floor_delete BEFORE DELETE ON auth_subject_fences BEGIN SELECT RAISE(ABORT,'fixture cleanup failure'); END",
      )
      .run();
    await expect(
      new BrowserSessionCoordinator(db, ORIGIN, () => NOW).cleanupRevocations(),
    ).rejects.toThrow();
    expect(
      (await db.prepare('SELECT minimum_generation FROM auth_revocation_fence').first())
        ?.minimum_generation,
    ).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM auth_subject_fences').first())?.n).toBe(1);
  });
  for (const boundary of ['absolute', 'idle', 'backwards'] as const)
    it(`rechecks ${boundary} clock at actual final D1 draft read and write`, async () => {
      const db = await database();
      for (const sql of statements('migrations/0005_private_article_drafts.sql'))
        await db.prepare(sql).run();
      let now = NOW;
      const session = (await createFixtureSession(db, ORIGIN, () => now, identity()))!;
      const draftId = '11111111-1111-4111-8111-111111111111';
      await db
        .prepare(
          'INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms) VALUES(?,?,?,?,?,?)',
        )
        .bind(draftId, 'a', 'original', 'private fixture', 1, NOW)
        .run();
      expect(
        await new PrivateDraftStore(db, ORIGIN, () => now).read(request(session), draftId),
      ).not.toBeNull();
      let finalQueries = 0;
      const advance =
        boundary === 'absolute'
          ? NOW + SESSION_ABSOLUTE_MS
          : boundary === 'idle'
            ? NOW + SESSION_IDLE_MS
            : NOW - 1;
      const guarded = new Proxy(db, {
        get(target, key) {
          if (key === 'prepare')
            return (sql: string) => {
              if (sql.includes('private_article_drafts')) {
                finalQueries++;
                now = advance;
              }
              return target.prepare(sql);
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const drafts = new PrivateDraftStore(guarded, ORIGIN, () => now);
      expect(await drafts.read(request(session), draftId)).toBeNull();
      expect(finalQueries).toBe(1);
      now = NOW;
      const headers = new Headers(request(session).headers);
      headers.set('Origin', ORIGIN);
      headers.set('Authorization', 'Bearer csrf.' + session.csrfToken);
      expect(
        await drafts.update(new Request(ORIGIN + '/private', { method: 'PUT', headers }), draftId, {
          title: 'must not persist',
          body: 'must not persist',
          expectedVersion: 1,
        }),
      ).toBeNull();
      expect(finalQueries).toBe(2);
      expect(
        await db
          .prepare('SELECT title,body,version FROM private_article_drafts WHERE id=?')
          .bind(draftId)
          .first(),
      ).toEqual({ title: 'original', body: 'private fixture', version: 1 });
    });

  it('cleans expired attempt without ending its live session, blocks callback replay, and preserves account cascade', async () => {
    const db = await database(),
      pending = await pendingAttempt(db, ORIGIN, NOW),
      claimed = await pending.flow.claim(pending.callback, 'login');
    expect(claimed?.kind).toBe('code');
    if (claimed?.kind !== 'code') throw Error('fixture claim failed');
    const session = (await new SessionStore(db, ORIGIN, () => NOW).create(
      identity(),
      claimed.proof,
    ))!;
    expect(session).not.toBeNull();
    const live = { ...session, contextCookie: pending.contextCookie };
    expect((await db.prepare('SELECT attempt_hash FROM auth_sessions').first())?.attempt_hash).toBe(
      claimed.proof.stateHash,
    );
    const afterAttemptExpiry = NOW + 600001;
    expect(await new OAuthAttemptStore(db, () => afterAttemptExpiry).cleanupExpired()).toBe(1);
    expect(await db.prepare('SELECT state_hash FROM oauth_attempts').first()).toBeNull();
    expect(
      (await db.prepare('SELECT attempt_hash FROM auth_sessions').first())?.attempt_hash,
    ).toBeNull();
    expect(
      await new SessionStore(db, ORIGIN, () => afterAttemptExpiry).authenticate(request(live)),
    ).not.toBeNull();
    expect(await pending.flow.claim(pending.callback, 'login')).toBeNull();
    expect(
      await new SessionStore(db, ORIGIN, () => NOW).create(identity(), claimed.proof),
    ).toBeNull();
    const exchange = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected provider exchange'));
    try {
      const broker = new GoogleLoginBroker(
        db,
        {
          origin: ORIGIN,
          clientId: 'fixture.apps.googleusercontent.com',
          clientSecret: 'fictional-local-only',
          cookieKey: new Uint8Array(32).fill(29),
        },
        () => NOW,
      );
      expect(await broker.callback(pending.callback)).toBeNull();
      expect(exchange).not.toHaveBeenCalled();
    } finally {
      exchange.mockRestore();
    }
    expect((await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first())?.n).toBe(1);
    await db.prepare("DELETE FROM private_accounts WHERE id='a'").run();
    expect((await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first())?.n).toBe(0);
    expect(
      await new SessionStore(db, ORIGIN, () => afterAttemptExpiry).authenticate(request(live)),
    ).toBeNull();
  });
});
