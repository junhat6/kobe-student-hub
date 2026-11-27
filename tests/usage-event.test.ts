import { describe, expect, it } from 'vitest';
import {
  automatedAgent,
  referrerHost,
  usageRoute,
  usageRow,
  utmValue,
} from '../src/shared/usage-event';
import { handleUsage } from '../worker/usage-http';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const A = 'abcdefghijklmnopqrstuv';
const S = 'ABCDEFGHIJKLMNOPQRSTUV';
const view = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  e: 'view',
  p: '/',
  a: A,
  s: S,
  d: 'd',
  ...extra,
});

describe('usageRoute', () => {
  it('keeps the public id only for articles and projects', () => {
    expect(usageRoute(`/articles/${ID}`)).toEqual({ route: 'article', contentId: ID });
    expect(usageRoute(`/projects/${ID}`)).toEqual({ route: 'project', contentId: ID });
    expect(usageRoute('/students/someone/likes')).toEqual({ route: 'student', contentId: '' });
  });
  it('reduces private and unknown screens to their kind', () => {
    expect(usageRoute('/drafts')).toEqual({ route: 'write', contentId: '' });
    expect(usageRoute('/works/new')).toEqual({ route: 'write', contentId: '' });
    expect(usageRoute('/works')).toEqual({ route: 'works', contentId: '' });
    expect(usageRoute('/account')).toEqual({ route: 'account', contentId: '' });
    expect(usageRoute('/articles/not-a-uuid')).toEqual({ route: 'other', contentId: '' });
    expect(usageRoute('/anything/else')).toEqual({ route: 'other', contentId: '' });
  });
});

describe('referrerHost and utmValue', () => {
  it('keeps only the host of another site', () => {
    expect(referrerHost('https://www.google.com/search?q=kobe+secret', 'hub.junhat6.com')).toBe(
      'www.google.com',
    );
    expect(referrerHost('https://t.co/abc', 'hub.junhat6.com')).toBe('t.co');
    expect(referrerHost('https://hub.junhat6.com/articles/x', 'hub.junhat6.com')).toBe('');
    expect(referrerHost('android-app://com.x/', 'hub.junhat6.com')).toBe('');
    expect(referrerHost(42, 'hub.junhat6.com')).toBe('');
  });
  it('accepts only short slug-like utm values', () => {
    expect(utmValue('X')).toBe('x');
    expect(utmValue('owner_2026-11')).toBe('owner_2026-11');
    expect(utmValue('my name@example.com')).toBe('');
    expect(utmValue('a'.repeat(41))).toBe('');
  });
});

describe('usageRow', () => {
  it('builds the fixed row for a landing view', () => {
    const row = usageRow(
      view({
        p: `/articles/${ID}`,
        n: 1,
        r: 'https://t.co/xyz',
        us: 'x',
        um: 'social',
        uc: 'owner',
      }),
      'hub.junhat6.com',
    );
    expect(row).toEqual({
      index: A,
      blobs: ['view', 'article', ID, 't.co', 'x', 'social', 'owner', A, S, 'd', '1'],
      doubles: [0, 0],
    });
  });
  it('accepts read only on articles and projects, within bounds', () => {
    expect(
      usageRow(view({ e: 'read', p: `/articles/${ID}`, sp: 80, es: 95 }), 'h')?.doubles,
    ).toEqual([80, 95]);
    expect(usageRow(view({ e: 'read', p: '/', sp: 80, es: 95 }), 'h')).toBeNull();
    expect(usageRow(view({ e: 'read', p: `/articles/${ID}`, sp: 101, es: 1 }), 'h')).toBeNull();
    expect(usageRow(view({ e: 'read', p: `/articles/${ID}`, sp: 1.5, es: 1 }), 'h')).toBeNull();
    expect(usageRow(view({ sp: 10 }), 'h')).toBeNull();
  });
  it('drops the whole event when any key is outside the list', () => {
    expect(usageRow(view({ email: 'x@example.com' }), 'h')).toBeNull();
    expect(usageRow(view({ a: 'short' }), 'h')).toBeNull();
    expect(usageRow(view({ v: 2 }), 'h')).toBeNull();
    expect(usageRow(view({ e: 'click' }), 'h')).toBeNull();
    expect(usageRow(view({ p: 'https://evil.example/' }), 'h')).toBeNull();
    expect(usageRow([], 'h')).toBeNull();
  });
});

describe('handleUsage', () => {
  const origin = 'https://hub.junhat6.com';
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request(origin + '/api/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'User-Agent': 'Mozilla/5.0 (iPhone)',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const sink = () => {
    const rows: unknown[] = [];
    return {
      rows,
      dataset: { writeDataPoint: (r: unknown) => rows.push(r) } as AnalyticsEngineDataset,
    };
  };

  it('writes one row for a valid view and answers 204', async () => {
    const { rows, dataset } = sink();
    const res = await handleUsage(post(view()), dataset);
    expect(res?.status).toBe(204);
    expect(rows).toHaveLength(1);
  });
  it('ignores other paths', async () => {
    expect(await handleUsage(new Request(origin + '/api/other'), undefined)).toBeNull();
  });
  it('rejects other origins, cookies, bad bodies and other methods without writing', async () => {
    const { rows, dataset } = sink();
    expect(
      (await handleUsage(post(view(), { Origin: 'https://evil.example' }), dataset))?.status,
    ).toBe(403);
    expect((await handleUsage(post(view(), { Cookie: 'a=b' }), dataset))?.status).toBe(400);
    expect((await handleUsage(post(view({ extra: 1 })), dataset))?.status).toBe(400);
    expect((await handleUsage(post('x'.repeat(2000)), dataset))?.status).toBe(413);
    expect((await handleUsage(new Request(origin + '/api/usage'), dataset))?.status).toBe(405);
    expect(rows).toHaveLength(0);
  });
  it('does not count automated agents and works without a binding', async () => {
    const { rows, dataset } = sink();
    expect(
      (await handleUsage(post(view(), { 'User-Agent': 'Googlebot/2.1' }), dataset))?.status,
    ).toBe(204);
    expect(rows).toHaveLength(0);
    expect((await handleUsage(post(view()), undefined))?.status).toBe(204);
    expect(automatedAgent(null)).toBe(true);
  });
});
