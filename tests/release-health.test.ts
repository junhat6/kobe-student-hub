import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

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

describe('actual Worker health source release state', () => {
  it.each([
    { name: 'closed', oauth: false, authoring: false, writesEnabled: false },
    { name: 'ordinary login only', oauth: true, authoring: false, writesEnabled: false },
    { name: 'ordinary login and authoring', oauth: true, authoring: true, writesEnabled: true },
    {
      name: 'authoring without its outer OAuth gate',
      oauth: false,
      authoring: true,
      writesEnabled: false,
    },
  ])('$name', async ({ oauth, authoring, writesEnabled }) => {
    // Test-only builds vary the two existing source gates, never runtime flags or production files.
    let variant = source;
    for (const [name, enabled] of [
      ['OAUTH_HTTP_RELEASE_ENABLED', oauth],
      ['ORDINARY_DRAFT_HTTP_RELEASE_ENABLED', authoring],
    ] as const) {
      const stageGate = new RegExp(`^const ${name} = true;$`, 'gm');
      expect(source.match(stageGate)).toHaveLength(1);
      variant = variant.replace(stageGate, `const ${name} = ${enabled};`);
    }
    output = mkdtempSync(join(tmpdir(), 'ksh-release-health-'));
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
        // A health read needs no credentials or database, even for an enabled source build.
        bindings: { DB: {} },
        outboundService: () => {
          throw new Error('Health must not access a provider');
        },
      }),
    );
    const response = await mf.dispatchFetch('https://fixture.invalid/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      stage: 'development-preview',
      writesEnabled,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(response.headers.has('Location')).toBe(false);
  });
});
