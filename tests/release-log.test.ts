import { describe, expect, it } from 'vitest';
import {
  formatRecord,
  formatReport,
  lastDeparted,
  nextTrain,
  openTrain,
  parseRecord,
  summarize,
  trainAt,
  // @ts-expect-error plain ESM script without type declarations
} from '../scripts/loop/release-log.mjs';
import {
  MEDIA_AUDIT_SQL,
  formatMediaAudit,
  parseMediaAudit,
  // @ts-expect-error plain ESM script without type declarations
} from '../scripts/loop/media-audit.mjs';

import {
  releaseWake,
  // @ts-expect-error plain ESM script without type declarations
} from '../scripts/loop/precheck.mjs';

const jst = (s: string) => new Date(`${s}+09:00`);

describe('release trains (08:00 / 20:00 JST, 2h window)', () => {
  it.each([
    ['2026-11-22T08:00:00', 'morning'],
    ['2026-11-22T09:59:00', 'morning'],
    ['2026-11-22T20:00:00', 'evening'],
    ['2026-11-22T21:30:00', 'evening'],
  ])('%s is inside the %s window', (at, id) => {
    expect(trainAt(jst(at))?.id).toBe(id);
    expect(trainAt(jst(at))?.slot).toBe(`2026-11-22 ${id}`);
  });

  it.each([
    '2026-11-22T07:59:00',
    '2026-11-22T10:00:00',
    '2026-11-22T15:00:00',
    '2026-11-22T22:00:00',
    '2026-11-22T03:00:00',
  ])('%s is outside every window', (at) => expect(trainAt(jst(at))).toBeUndefined());

  it('uses JST regardless of the host clock', () => {
    // 2026-11-21T23:30Z = 2026-11-22 08:30 JST
    expect(trainAt(new Date('2026-11-21T23:30:00Z'))?.slot).toBe('2026-11-22 morning');
  });

  it('names the next train', () => {
    expect(nextTrain(jst('2026-11-22T12:00:00'))).toBe('夜便 20:00');
    expect(nextTrain(jst('2026-11-22T22:00:00'))).toBe('朝便 08:00');
  });
});

const record = {
  v: 1,
  startedAt: '2026-11-22T11:00:00.000Z',
  finishedAt: '2026-11-22T11:25:00.000Z',
  train: { id: 'evening', label: '夜便', hour: 20, day: '2026-11-22', slot: '2026-11-22 evening' },
  sha: 'a'.repeat(40),
  short: 'aaaaaaa',
  from: 'b'.repeat(40),
  tag: 'r2026.11.22.3',
  commits: { total: 2, list: ['aaaaaaa feat: x | y', 'ccccccc fix: --> z'] },
  migrations: ['0012_add.sql'],
  ci: {
    status: 'completed',
    conclusion: 'success',
    url: 'https://example.test/run/1',
    reused: false,
  },
  deploy: { via: 'actions', result: 'success', url: 'https://example.test/run/2' },
  smoke: { ok: true, failures: [] },
  outcome: 'released',
};

describe('release record', () => {
  it('round-trips through the Issue comment body', () => {
    const body = formatRecord(record);
    expect(body).toContain('夜便');
    expect(body).toContain('r2026.11.22.3');
    expect(body).toContain('0012_add.sql');
    expect(body).toContain('- aaaaaaa feat: x | y');
    expect(parseRecord(body)).toEqual(record);
  });

  it('ignores comments that are not records', () => {
    expect(parseRecord('hello')).toBeUndefined();
    expect(parseRecord(undefined)).toBeUndefined();
  });

  it('summarizes outcomes and finds trains without a record', () => {
    const failed = {
      ...record,
      startedAt: '2026-11-21T23:05:00.000Z',
      train: { ...record.train, id: 'morning', label: '朝便', slot: '2026-11-22 morning' },
      outcome: 'ci_failed',
      reason: 'CI が通りませんでした（失敗: verify: E2E）',
      ci: { ...record.ci, conclusion: 'failure' },
    };
    const hotfix = {
      ...record,
      startedAt: '2026-11-22T06:00:00.000Z',
      train: undefined,
      hotfix: '#210 ログイン不可',
    };
    const s = summarize([record, failed, hotfix], {
      from: jst('2026-11-21T00:00:00'),
      to: jst('2026-11-22T23:00:00'),
    });
    expect(s.total).toBe(3);
    expect(s.released).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.hotfix).toBe(1);
    expect(s.missedSlots).toEqual(['2026-11-21 朝便', '2026-11-21 夜便']);
    const report = formatReport(s);
    expect(report).toContain('記録なし 2 便');
    expect(report).toContain('臨時便');
    expect(report).toContain('CI が通りませんでした');
  });

  it('does not count a train whose window is still open as missed', () => {
    const s = summarize([], { from: jst('2026-11-22T00:00:00'), to: jst('2026-11-22T20:30:00') });
    expect(s.missedSlots).toEqual(['2026-11-22 朝便']);
  });
});

// #249: the media D1↔R2 audit counts a release train reads after deploy.
describe('media audit in the release record', () => {
  const row = {
    measured_at_ms: Date.parse('2026-11-23T11:00:00Z'),
    total: 5,
    pending: 1,
    checked: 4,
    missing: 1,
    mismatched: 0,
    complete: 1,
    retained: 2,
  };
  const canary = {
    id: '11111111-2222-4333-8444-555555555555',
    key: 'media/11111111-2222-4333-8444-555555555555/' + 'c'.repeat(64),
    owner_account_id: 'account-canary',
    payload: 'canary-body',
  };

  it('reads the latest counts with a single SELECT', () => {
    expect(MEDIA_AUDIT_SQL).toMatch(/^SELECT /);
    expect(MEDIA_AUDIT_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER)\b/i);
    expect(MEDIA_AUDIT_SQL).not.toContain(';');
  });

  it('keeps only the counts, even when the row carries other columns', () => {
    const audit = parseMediaAudit([{ results: [{ ...row, ...canary }] }]);
    expect(audit).toEqual({
      measuredAt: '2026-11-23T11:00:00.000Z',
      total: 5,
      pending: 1,
      checked: 4,
      missing: 1,
      mismatched: 0,
      complete: true,
      retained: 2,
    });
    const body = formatRecord({ ...record, mediaAudit: audit });
    expect(body).toContain(
      '不一致あり：行 5・未写し 1・R2 欠落 1・size/sha256 不一致 0・D1 に本体が残る行 2',
    );
    expect(body).toContain('20:00:00 JST 測定');
    for (const value of Object.values(canary)) expect(body).not.toContain(value);
    expect(parseRecord(body).mediaAudit).toEqual(audit);
  });

  it('says it matched only when every copied row was checked and nothing is off', () => {
    const all = parseMediaAudit([{ results: [{ ...row, pending: 0, missing: 0, checked: 5 }] }]);
    expect(formatMediaAudit(all)).toMatch(/^一致：/);
    const partial = parseMediaAudit([
      { results: [{ ...row, pending: 0, missing: 0, checked: 3, complete: 0 }] },
    ]);
    expect(formatMediaAudit(partial)).toMatch(/^不一致あり：.*一部のみ/);
  });

  it('shows how many rows still keep their bytes in D1 (#12), and omits it for older records', () => {
    expect(MEDIA_AUDIT_SQL).toContain(
      "(SELECT COUNT(*) FROM media_assets WHERE typeof(payload)<>'null') retained",
    );
    const erased = parseMediaAudit([
      { results: [{ ...row, pending: 0, missing: 0, checked: 5, retained: 0 }] },
    ]);
    expect(formatMediaAudit(erased)).toMatch(/^一致：.*・D1 に本体が残る行 0（/);
    const { retained: _, ...older } = erased;
    expect(formatMediaAudit(older)).not.toContain('D1 に本体');
    expect(formatMediaAudit(older)).toMatch(
      /^一致：行 5・未写し 0・R2 欠落 0・size\/sha256 不一致 0（/,
    );
  });

  it('records that it could not audit instead of failing the train', () => {
    expect(parseMediaAudit([{ results: [] }])).toEqual({ error: 'まだ照合の記録がありません' });
    expect(parseMediaAudit([{ results: [{ ...row, total: -1 }] }])).toHaveProperty('error');
    expect(parseMediaAudit(undefined)).toHaveProperty('error');
    expect(parseMediaAudit([{ results: [{ ...row, pending: 9 }] }])).toHaveProperty('error');
    expect(parseMediaAudit([{ results: [{ ...row, missing: 5 }] }])).toHaveProperty('error');
    expect(parseMediaAudit([{ results: [{ ...row, retained: -1 }] }])).toHaveProperty('error');
    expect(parseMediaAudit([{ results: [{ ...row, retained: null }] }])).toHaveProperty('error');
    expect(parseMediaAudit([{ results: [{ ...row, measured_at_ms: 2 ** 52 }] }])).toHaveProperty(
      'error',
    );
    expect(formatRecord({ ...record, mediaAudit: { error: '本番 D1 に届きません' } })).toContain(
      '照合できず（本番 D1 に届きません）',
    );
    expect(formatRecord(record)).not.toContain('media 照合');
  });
});

describe('unfinished trains (2026-11-24: a train runs until it ships)', () => {
  const ev = {
    id: 'evening',
    label: '夜便',
    hour: 20,
    day: '2026-11-24',
    slot: '2026-11-24 evening',
  };
  const rec = (outcome: string, extra: object = {}) => ({
    v: 1,
    startedAt: '2026-11-24T11:00:00.000Z',
    finishedAt: '2026-11-24T11:30:00.000Z',
    train: ev,
    outcome,
    ...extra,
  });

  it.each([
    ['2026-11-24T20:00:00', '2026-11-24 evening'],
    ['2026-11-24T23:59:00', '2026-11-24 evening'],
    ['2026-11-25T07:59:00', '2026-11-24 evening'],
    ['2026-11-25T08:00:00', '2026-11-25 morning'],
    ['2026-11-25T19:00:00', '2026-11-25 morning'],
  ])('at %s the last departed train is %s', (at, slot) =>
    expect(lastDeparted(jst(at)).slot).toBe(slot),
  );

  it.each([
    ['ci_failed', {}, true],
    ['deploy_failed', {}, true],
    ['skipped', { blocker: 'main_health' }, true],
    ['skipped', { blocker: 'rc_running' }, true],
    ['skipped', { blocker: 'p0' }, false],
    ['skipped', { blocker: 'agent' }, false],
    ['released', {}, false],
  ])('%s %o is open: %s', (outcome, extra, open) => {
    const at = jst('2026-11-24T23:00:00');
    expect(Boolean(openTrain([rec(outcome, extra)], at))).toBe(open);
    // precheck.mjs は同じ判定を自前で持つ。食い違わないこと
    const wake = releaseWake(at, { records: [rec(outcome, extra)], busy: '', followupMin: 90 });
    expect(wake.wake).toBe(open);
  });

  it('a later success closes the train', () => {
    const late = rec('released', {
      startedAt: '2026-11-24T13:00:00.000Z',
      finishedAt: '2026-11-24T13:30:00.000Z',
    });
    expect(openTrain([late, rec('ci_failed')], jst('2026-11-24T23:00:00'))).toBeUndefined();
  });

  it('orders by finish: a short rc_running skip inside a long released run does not reopen the train', () => {
    // 2026-11-25 夜便: 22:02 開始の便が 22:30 に released。その CI 中の 22:11 に別の agent が rc_running で見送った
    const released = rec('released', {
      startedAt: '2026-11-25T13:02:00.000Z',
      finishedAt: '2026-11-25T13:30:00.000Z',
    });
    const skip = rec('skipped', {
      blocker: 'rc_running',
      startedAt: '2026-11-25T13:11:00.000Z',
      finishedAt: '2026-11-25T13:11:00.000Z',
    });
    const at = jst('2026-11-25T00:00:00');
    expect(openTrain([released, skip], at)).toBeUndefined();
    expect(releaseWake(at, { records: [released, skip], busy: '', followupMin: 90 }).wake).toBe(
      false,
    );
  });

  it('the next departure hands over: the old train is no longer continued', () => {
    expect(openTrain([rec('ci_failed')], jst('2026-11-25T08:10:00'))).toBeUndefined();
  });

  it('precheck wakes on departure, leaves a fresh failure to its agent, and never while CI runs', () => {
    const w = (at: string, records: object[], busy = '') =>
      releaseWake(jst(at), { records, busy, followupMin: 90 }).wake;
    expect(w('2026-11-24T20:00:00', [])).toBe(true); // 発車
    expect(w('2026-11-24T21:40:00', [])).toBe(true); // Mac が眠っていて遅れた発車
    expect(w('2026-11-24T22:10:00', [])).toBe(false); // 窓を過ぎ、記録も無い
    expect(w('2026-11-24T20:50:00', [rec('ci_failed')])).toBe(false); // 失敗から 20 分：前の agent が直している
    expect(w('2026-11-24T21:00:00', [rec('ci_failed')], 'rc の full CI が実行中')).toBe(false);
    expect(w('2026-11-24T22:00:00', [])).toBe(false);
  });
});
