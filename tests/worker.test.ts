import { workerModules } from './helpers/worker-modules';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { sampleCatalog } from '../src/sample';
let mf: Miniflare;
let bootstrapGitBody: string;
let bootstrapLearningRow: Record<string, string | number>;
let preDecisionsLearningRow: Record<string, string | number>;
let decisionsLearningRow: Record<string, string | number>;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/index.js'),
      compatibilityDate: '2026-11-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync(`migrations/${f}`, 'utf8');
    const sql = raw.replace(/^--.*$/gm, '');
    for (const statement of (raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m).map((s) => s.replace(/^--.*$/gm, ''))
      : sql.split(/;\s*(?:\n|$)/)
    ).filter((s) => s.trim()))
      await db.prepare(statement).run();
  }
  bootstrapGitBody = (await db
    .prepare("SELECT body FROM content WHERE id='git-branches'")
    .first<{ body: string }>())!.body;
  bootstrapLearningRow = (await db
    .prepare("SELECT * FROM content WHERE id='learning-notes'")
    .first<Record<string, string | number>>())!;
  for (const name of ['0001_git_practice.sql', '0002_learning_notes.sql'])
    await db
      .prepare(
        readFileSync('content-revisions/' + name, 'utf8')
          .replace(/^--.*$/gm, '')
          .trim(),
      )
      .run();
  preDecisionsLearningRow = (await db
    .prepare("SELECT * FROM content WHERE id='learning-notes'")
    .first<Record<string, string | number>>())!;
  await db
    .prepare(
      readFileSync('content-revisions/0003_learning_notes_decisions.sql', 'utf8')
        .replace(/^--.*$/gm, '')
        .trim(),
    )
    .run();
  decisionsLearningRow = (await db
    .prepare("SELECT * FROM content WHERE id='learning-notes'")
    .first<Record<string, string | number>>())!;
  await db
    .prepare(
      readFileSync('content-revisions/0004_learning_notes_no_assignment.sql', 'utf8')
        .replace(/^--.*$/gm, '')
        .trim(),
    )
    .run();
  await db
    .prepare(
      "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('private-actor','PRIVATE_GOOGLE_SUBJECT','fixture-private@st.kobedenshi.ac.jp','active',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms) VALUES('11111111-1111-4111-8111-111111111111','private-actor','PRIVATE_ARTICLE_DRAFT','SECRET_DRAFT_MARKDOWN',1,0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES('publication-fixture-profile','Fictional publication author','Fixture','Sample','','F',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES('private-actor','publication-fixture-profile')",
    )
    .run();
  // Trusted fixture publication record exercises the real snapshot trigger; this row is never a production sample.
  await db
    .prepare(
      "INSERT INTO article_publications(content_id,owner_account_id,draft_id,public_profile_id,source_version,summary,tags_json,audience,prerequisite,outcome,minutes,published_at_ms) VALUES('33333333-3333-4333-8333-333333333333','private-actor','11111111-1111-4111-8111-111111111111','publication-fixture-profile',1,'NON_SAMPLE_PUBLICATION_SUMMARY','[]','','','',1,0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO article_reports(id,content_id,reporter_account_id,reason,detail,created_at_ms) VALUES('22222222-2222-4222-8222-222222222222','learning-notes','private-actor','PRIVATE_REPORT_REASON','SECRET_REPORT_DETAIL',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms) VALUES(?,'private-actor',0,0,0,1)",
    )
    .bind('0'.repeat(64))
    .run();
  await db
    .prepare(
      'INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?)',
    )
    .bind('a'.repeat(64), 'b'.repeat(64), 'n'.repeat(43), 0, 600000)
    .run();
  for (const state of ['draft', 'hidden', 'deleted'])
    await db
      .prepare(
        "INSERT INTO content SELECT ?,kind,?,summary,'SECRET_BODY',tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,?,1 FROM content WHERE id='learning-notes'",
      )
      .bind(`private-${state}`, `PRIVATE_${state}`, state)
      .run();
  await db
    .prepare(
      "INSERT INTO content SELECT 'real-content',kind,'REAL_PRIVATE_SAMPLE_BOUNDARY',summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,'published',0 FROM content WHERE id='learning-notes'",
    )
    .run();
});
afterAll(async () => {
  await mf?.dispose();
});
describe('public data boundary on Workers and D1', () => {
  it('never returns draft, hidden, deleted or real non-sample content', async () => {
    const res = await mf.dispatchFetch('http://test/api/catalog');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(
      /PRIVATE_|SECRET_BODY|private-|state_hash|browser_hash|oauth_attempts|nonce|PRIVATE_GOOGLE_SUBJECT|token_hash|session_epoch|fixture-private|PRIVATE_ARTICLE_DRAFT|SECRET_DRAFT_MARKDOWN|owner_account_id|private_article_drafts|PRIVATE_REPORT_REASON|SECRET_REPORT_DETAIL|reporter_account_id|article_report_outbox|report_count|article_publications|account_public_profiles|source_version|draft_id|publication-fixture-profile|NON_SAMPLE_PUBLICATION_SUMMARY|private_enrollment_periods|admission_year|graduation_year|admissionYear|graduationYear|starts_at_ms|ends_at_ms/,
    );
    const json = JSON.parse(body);
    expect(json.entries).toHaveLength(4);
    expect(json.profiles).toHaveLength(2);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects every write and never accepts user data', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await mf.dispatchFetch('http://test/api/content', {
        method,
        body: '{"title":"injected"}',
      });
      expect(res.status).toBe(405);
    }
    for (const prefix of ['/api/drafts', '/api/private/drafts'])
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const r = await mf.dispatchFetch(
          'http://test' + prefix + '/11111111-1111-4111-8111-111111111111',
          { method },
        );
        expect(r.status).toBe(405);
        expect(await r.text()).not.toMatch(/SECRET_DRAFT|PRIVATE_ARTICLE|owner_account_id/);
      }
  });
  it('fails closed without server authentication config and rejects client-supplied identity claims', async () => {
    const auth = await mf.dispatchFetch('http://test/api/auth/callback', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer client-supplied-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'fixture-do-not-use@st.kobedenshi.ac.jp',
        email_verified: true,
        role: 'admin',
        accountId: 'owner',
      }),
    });
    expect(auth.status).toBe(503);
    expect(auth.headers.get('set-cookie')).toBeNull();
    for (const [method, path] of [
      ['GET', '/api/auth/start'],
      ['POST', '/api/auth/start'],
      ['GET', '/api/auth/callback'],
      ['GET', '/api/private/enrollment'],
      ['PUT', '/api/private/enrollment'],
      ['POST', '/api/auth/register'],
      ['GET', '/api/private/profile'],
      ['POST', '/api/private/profile'],
      ['GET', '/api/private/publications/11111111-1111-4111-8111-111111111111'],
      ['POST', '/api/private/publications/11111111-1111-4111-8111-111111111111'],
      ['GET', '/api/private/session'],
      ['POST', '/api/private/logout'],
      ['GET', '/api/private/moderation/session'],
      ['GET', '/api/private/moderation/cases'],
      ['GET', '/api/private/moderation/cases/11111111-1111-4111-8111-111111111111'],
      ['GET', '/api/private/reports/11111111-1111-4111-8111-111111111111'],
      ['POST', '/api/private/reports/11111111-1111-4111-8111-111111111111'],
    ]) {
      const r = await mf.dispatchFetch('http://test' + path, { method, redirect: 'manual' });
      const authPath =
        path.startsWith('/api/auth/') ||
        path === '/api/private/session' ||
        path === '/api/private/logout';
      expect(r.status).toBe(
        path === '/api/auth/callback'
          ? 303
          : authPath || path === '/api/private/enrollment'
            ? 503
            : 405,
      );
      expect(r.headers.get('set-cookie')).toBeNull();
      expect(r.headers.get('location')).toBe(path === '/api/auth/callback' ? '/account#' : null);
    }
    const health = await mf.dispatchFetch('http://test/api/health');
    expect(((await health.json()) as { writesEnabled: boolean }).writesEnabled).toBe(false);
  });
  it('returns a safe error when storage is unavailable', async () => {
    const broken = new Miniflare(
      convertV4MiniflareOptions({
        modules: workerModules('.worker/index.js'),
        compatibilityDate: '2026-11-03',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
      }),
    );
    try {
      const r = await broken.dispatchFetch('http://test/api/catalog');
      expect(r.status).toBe(503);
      expect(await r.text()).not.toMatch(/SELECT|SQL|stack|D1_ERROR/);
    } finally {
      await broken.dispose();
    }
  });
});

describe('fictional content revision', () => {
  it('serves the complete revised learning-notes sample from D1', async () => {
    const response = await mf.dispatchFetch('http://test/api/catalog');
    const catalog = (await response.json()) as { entries: { id: string }[] };
    expect(catalog.entries.find((e) => e.id === 'learning-notes')).toEqual(
      sampleCatalog.entries.find((e) => e.id === 'learning-notes'),
    );
  });
  for (const revision of [
    '0002_learning_notes.sql',
    '0003_learning_notes_decisions.sql',
    '0004_learning_notes_no_assignment.sql',
  ])
    it(`changes only the expected learning-notes row once and preserves edits to every guarded field: ${revision}`, async () => {
      const db = await mf.getD1Database('DB');
      const sql = readFileSync('content-revisions/' + revision, 'utf8')
        .replace(/^--.*$/gm, '')
        .trim();
      const latest = (await db
        .prepare("SELECT * FROM content WHERE id='learning-notes'")
        .first<Record<string, string | number>>())!;
      const baseline =
        revision === '0002_learning_notes.sql'
          ? bootstrapLearningRow
          : revision === '0003_learning_notes_decisions.sql'
            ? preDecisionsLearningRow
            : decisionsLearningRow;
      const expected =
        revision === '0002_learning_notes.sql'
          ? preDecisionsLearningRow
          : revision === '0003_learning_notes_decisions.sql'
            ? decisionsLearningRow
            : latest;
      const columns = Object.keys(latest);
      const write = async (row: Record<string, string | number>) =>
        db
          .prepare(
            'UPDATE content SET ' +
              columns.map((k) => k + '=?').join(',') +
              " WHERE id='learning-notes'",
          )
          .bind(...columns.map((k) => row[k]))
          .run();
      try {
        const before = (
          await db.prepare("SELECT * FROM content WHERE id!='learning-notes' ORDER BY id").all()
        ).results;
        expect((await db.prepare(sql).run()).meta.changes).toBe(0);
        await write(baseline);
        expect((await db.prepare(sql).run()).meta.changes).toBe(1);
        expect(await db.prepare("SELECT * FROM content WHERE id='learning-notes'").first()).toEqual(
          expected,
        );
        expect((await db.prepare(sql).run()).meta.changes).toBe(0);
        // An independently changed field must prevent the entire editorial update.
        for (const [field, value] of Object.entries({
          ...baseline,
          kind: 'project',
          title: 'Other title',
          summary: 'Other summary',
          body: 'Other body',
          tags_json: '[]',
          author_id: 'sample-b',
          audience: 'Other reader',
          prerequisite: 'Other prerequisite',
          outcome: 'Other outcome',
          updated_at: '2026-11-07',
          minutes: 4,
          related_ids_json: '[]',
          status: 'hidden',
          is_sample: 0,
        })) {
          if (field === 'id') continue;
          const edited = { ...baseline, [field]: value };
          await write(edited);
          expect((await db.prepare(sql).run()).meta.changes, field).toBe(0);
          expect(
            await db.prepare("SELECT * FROM content WHERE id='learning-notes'").first(),
            field,
          ).toEqual(edited);
        }
        expect(
          (await db.prepare("SELECT * FROM content WHERE id!='learning-notes' ORDER BY id").all())
            .results,
        ).toEqual(before);
        const rollback = readFileSync('content-revisions/rollback/' + revision, 'utf8')
          .replace(/^--.*$/gm, '')
          .trim();
        await write({ ...expected, summary: 'A later editorial change' });
        expect((await db.prepare(rollback).run()).meta.changes).toBe(0);
        expect(
          (await db
            .prepare("SELECT summary FROM content WHERE id='learning-notes'")
            .first<{ summary: string }>())!.summary,
        ).toBe('A later editorial change');
        await write(expected);
        expect((await db.prepare(rollback).run()).meta.changes).toBe(1);
        expect(await db.prepare("SELECT * FROM content WHERE id='learning-notes'").first()).toEqual(
          baseline,
        );
        expect((await db.prepare(rollback).run()).meta.changes).toBe(0);
        expect((await db.prepare(sql).run()).meta.changes).toBe(1);
      } finally {
        await write(latest);
      }
    });
  it('serves the revised Git practice text matching the source sample', async () => {
    const response = await mf.dispatchFetch('http://test/api/catalog');
    const catalog = (await response.json()) as { entries: { id: string; body: string }[] };
    expect(catalog.entries.find((e) => e.id === 'git-branches')?.body).toBe(
      sampleCatalog.entries.find((e) => e.id === 'git-branches')?.body,
    );
  });
  it('does not overwrite a revised, edited, private or non-sample row', async () => {
    const db = await mf.getD1Database('DB');
    const sql = readFileSync('content-revisions/0001_git_practice.sql', 'utf8')
      .replace(/^--.*$/gm, '')
      .trim();
    expect((await db.prepare(sql).run()).meta.changes).toBe(0);
    const original = sampleCatalog.entries.find((e) => e.id === 'git-branches')!.body;
    try {
      for (const [status, sample, body] of [
        ['published', 1, 'CHANGED_BY_OTHER_EDITOR'],
        ['draft', 1, bootstrapGitBody],
        ['published', 0, bootstrapGitBody],
      ] as const) {
        await db
          .prepare("UPDATE content SET body=?,status=?,is_sample=? WHERE id='git-branches'")
          .bind(body, status, sample)
          .run();
        expect((await db.prepare(sql).run()).meta.changes).toBe(0);
        expect(
          (
            await db
              .prepare("SELECT body FROM content WHERE id='git-branches'")
              .first<{ body: string }>()
          )?.body,
        ).toBe(body);
      }
    } finally {
      await db
        .prepare("UPDATE content SET body=?,status='published',is_sample=1 WHERE id='git-branches'")
        .bind(original)
        .run();
    }
  });
});

describe('report-triggered public projection', () => {
  it('keeps an article visible after one/two distinct reports and excludes it after the third', async () => {
    const db = await mf.getD1Database('DB');
    const target = 'moderation-public-boundary';
    const accounts = ['private-actor', 'moderation-fixture-b', 'moderation-fixture-c'];
    // Trusted isolated fixture inserts exercise the actual schema trigger + production GET.
    // Request/session authorization is separately exercised by moderation.test.ts.
    try {
      for (const who of accounts.slice(1))
        await db
          .prepare(
            "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',0)",
          )
          .bind(who, 'subject-' + who, who + '@st.kobedenshi.ac.jp')
          .run();
      await db
        .prepare(
          "INSERT INTO content SELECT ?,kind,'Report boundary sample',summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,'published',1 FROM content WHERE id='learning-notes'",
        )
        .bind(target)
        .run();
      for (let n = 0; n < 3; n++) {
        await db
          .prepare(
            'INSERT INTO article_reports(id,content_id,reporter_account_id,reason,detail,created_at_ms) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            target,
            accounts[n],
            'PRIVATE_REPORT_REASON',
            'SECRET_REPORT_DETAIL',
            n,
          )
          .run();
        const response = await mf.dispatchFetch('http://test/api/catalog');
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const raw = await response.text();
        const catalog = JSON.parse(raw) as { entries: { id: string }[] };
        expect(catalog.entries.some((entry) => entry.id === target)).toBe(n < 2);
        expect(raw).not.toMatch(
          /PRIVATE_REPORT_REASON|SECRET_REPORT_DETAIL|reporter_account_id|article_report_outbox|report_count|article_publications|account_public_profiles|source_version|draft_id|publication-fixture-profile|NON_SAMPLE_PUBLICATION_SUMMARY/,
        );
      }
      const rows = (
        await db
          .prepare(
            'SELECT report_count,event,state FROM article_report_outbox WHERE content_id=? ORDER BY report_count',
          )
          .bind(target)
          .all()
      ).results;
      expect(rows).toEqual([
        { report_count: 1, event: 'report_received', state: 'pending' },
        { report_count: 2, event: 'report_received', state: 'pending' },
        { report_count: 3, event: 'temporarily_hidden', state: 'pending' },
      ]);
    } finally {
      await db.prepare('DELETE FROM article_report_outbox WHERE content_id=?').bind(target).run();
      await db.prepare('DELETE FROM article_reports WHERE content_id=?').bind(target).run();
      await db
        .prepare('DELETE FROM article_moderation_state WHERE content_id=?')
        .bind(target)
        .run();
      await db.prepare('DELETE FROM content WHERE id=?').bind(target).run();
      for (const who of accounts.slice(1))
        await db.prepare('DELETE FROM private_accounts WHERE id=?').bind(who).run();
    }
  });
});
