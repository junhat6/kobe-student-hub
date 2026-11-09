import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { AUTH_MAINTENANCE_CRON } from '../worker/auth/production-maintenance';

const source = readFileSync('worker/index.ts', 'utf8');
let mf: Miniflare | undefined;
let output: string | undefined;
afterEach(async () => {
  try {
    await mf?.dispose();
  } finally {
    mf = undefined;
    if (output) rmSync(output, { recursive: true, force: true });
    output = undefined;
  }
});

describe('actual Worker scheduled auth maintenance', () => {
  it.each([
    { oauth: false, authoring: false },
    { oauth: true, authoring: false },
    { oauth: true, authoring: true },
  ])('OAuth $oauth, authoring $authoring', async ({ oauth, authoring }) => {
    const gate = /^const OAUTH_HTTP_RELEASE_ENABLED = true;$/gm;
    expect(source.match(gate)).toHaveLength(1);
    const authoringGate = /^const ORDINARY_DRAFT_HTTP_RELEASE_ENABLED = true;$/gm;
    expect(source.match(authoringGate)).toHaveLength(1);
    const variant = source
      .replace(gate, `const OAUTH_HTTP_RELEASE_ENABLED = ${oauth};`)
      .replace(authoringGate, `const ORDINARY_DRAFT_HTTP_RELEASE_ENABLED = ${authoring};`);
    output = mkdtempSync(join(tmpdir(), 'ksh-auth-scheduled-'));
    const path = join(output, 'index.mjs');
    await build({
      stdin: {
        contents: variant,
        resolveDir: resolve('worker'),
        sourcefile: 'index.ts',
        loader: 'ts',
      },
      outfile: path,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      loader: { '.wasm': 'copy' },
    });
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modulesRoot: output,
        modules: [
          { type: 'ESModule', path },
          ...readdirSync(output)
            .filter((name) => name.endsWith('.wasm'))
            .map((name) => ({
              type: 'CompiledWasm' as const,
              path: join(output!, name),
            })),
        ],
        compatibilityDate: '2026-11-03',
        compatibilityFlags: ['nodejs_compat'],
        // Miniflare's local-only scheduled-event driver, never a production endpoint.
        unsafeTriggerHandlers: true,
        d1Databases: ['DB'],
        bindings: { AUTH_ORIGIN: 'https://scheduled.example.invalid' },
        outboundService: () => {
          throw Error('No provider or email transport is allowed');
        },
      }),
    );
    const db = await mf.getD1Database('DB');
    for (const file of [
      '0003_oauth_attempts.sql',
      '0004_private_sessions.sql',
      '0012_browser_session_order.sql',
      '0014_auth_maintenance.sql',
    ]) {
      const text = readFileSync('migrations/' + file, 'utf8');
      for (const sql of text
        .split(text.includes('-- @statement') ? /^-- @statement\s*$/m : /;\s*(?:\n|$)/)
        .map((s) => s.replace(/^--.*$/gm, '').trim())
        .filter(Boolean))
        await db.prepare(sql).run();
    }
    const now = Date.now();
    for (const [hash, expiry] of [
      ['a', now - 86_400_001],
      ['b', now - 1000],
    ] as const)
      await db
        .prepare(
          'INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?)',
        )
        .bind(hash.repeat(64), hash.repeat(64), 'n'.repeat(43), expiry - 1000, expiry)
        .run();
    const attempts = async () =>
      (await db.prepare('SELECT count(*) n FROM oauth_attempts').first<{ n: number }>())!.n;
    const reservation = async () =>
      (await db
        .prepare('SELECT last_started_at_ms t FROM auth_maintenance_state WHERE id=1')
        .first<{ t: number | null }>())!.t;
    const scheduled = async (cron: string) => {
      const url = new URL('http://scheduled.example.invalid/cdn-cgi/local/scheduled');
      url.searchParams.set('cron', cron);
      url.searchParams.set('format', 'json');
      const response = await mf!.dispatchFetch(url);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ outcome: 'ok' });
    };
    await scheduled('* * * * *');
    expect(await attempts()).toBe(2);
    expect(await reservation()).toBeNull();
    await scheduled(AUTH_MAINTENANCE_CRON);
    expect(await attempts()).toBe(oauth ? 1 : 2);
    const first = await reservation();
    if (oauth) expect(first).toBeGreaterThanOrEqual(now);
    else expect(first).toBeNull();
    await scheduled(AUTH_MAINTENANCE_CRON);
    expect(await attempts()).toBe(oauth ? 1 : 2);
    expect(await reservation()).toBe(first);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});
