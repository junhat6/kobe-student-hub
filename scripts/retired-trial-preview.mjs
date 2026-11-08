// Local negative regression: real production entry + actual ASSETS SPA routing, never deployed.
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workerModules } from '../tests/helpers/worker-modules.ts';
await build({
  entryPoints: ['tests/fixtures/retired-trial-worker.ts'],
  outfile: '.worker/retired-trial-browser.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.wasm': 'copy' },
});
const scratch = mkdtempSync(join(tmpdir(), 'kobe-retired-assets-')),
  directory = join(scratch, 'assets');
cpSync('dist', directory, { recursive: true });
mkdirSync(join(directory, 'trial-assets/assets'), { recursive: true });
writeFileSync(
  join(directory, 'trial-assets/assets/retired-fixture.js'),
  'window.RETIRED_TRIAL_SHOULD_NOT_LOAD=true;',
);
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
let ready = false;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: 'local-retired-trial',
    modules: workerModules('.worker/retired-trial-browser.js'),
    compatibilityDate: config.compatibility_date,
    host: '127.0.0.1',
    port: 8792,
    https: true,
    d1Databases: ['DB'],
    outboundService: async (r) => {
      if (r.url === 'https://retired-readiness.invalid/')
        return new Response('', { status: ready ? 200 : 503 });
      throw Error('Unexpected external request');
    },
    assets: {
      directory,
      binding: 'ASSETS',
      routerConfig: { has_user_worker: true },
      run_worker_first: config.assets.run_worker_first,
      assetConfig: { not_found_handling: config.assets.not_found_handling },
    },
  }),
);
const db = await mf.getD1Database('DB');
for (const f of ['migrations/0001_discovery.sql', 'migrations/0002_sample_content.sql']) {
  // Public migrations use ordinary semicolon-delimited statements, without triggers.
  for (const sql of readFileSync(f, 'utf8')
    .replace(/^--.*$/gm, '')
    .split(/;\s*(?:\n|$)/))
    if (sql.trim()) await db.prepare(sql).run();
}
ready = true;
await mf.ready;
console.log('Local retired-trial fixture ready');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await mf.dispose();
    rmSync(scratch, { recursive: true, force: true });
    process.exit();
  });
