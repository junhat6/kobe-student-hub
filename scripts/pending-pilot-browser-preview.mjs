// Ephemeral fictional provider and D1 only; no real Google or persistent credential.
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { workerModules } from '../tests/helpers/worker-modules.ts';
await build({
  entryPoints: ['tests/fixtures/pending-pilot-browser-worker.ts'],
  outfile: '.worker/pilot-browser.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.wasm': 'copy' },
});
await build({
  entryPoints: ['tests/helpers/google-fixtures.ts'],
  outfile: '.worker/pilot-google.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
});
const { googleFixture, TEST_EMAIL } = await import('../.worker/pilot-google.mjs'),
  signer = await googleFixture();
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const origin = 'https://127.0.0.1:8791';
let initialized = false;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: 'pilot-fixture',
    modules: workerModules('.worker/pilot-browser.js'),
    compatibilityDate: '2026-11-03',
    host: '127.0.0.1',
    port: 8791,
    https: true,
    assets: {
      routerConfig: { has_user_worker: true },
      directory: config.assets.directory,
      binding: config.assets.binding,
      run_worker_first: config.assets.run_worker_first,
      assetConfig: { not_found_handling: config.assets.not_found_handling },
    },
    d1Databases: ['DB'],
    bindings: {
      AUTH_ORIGIN: origin,
      GOOGLE_CLIENT_ID: 'fixture-web-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'synthetic-browser-only',
      OAUTH_COOKIE_KEY: 'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc',
      OAUTH_PENDING_PILOT: JSON.stringify({
        allowedEmail: TEST_EMAIL,
        expiresAtMs: Date.now() + 600000,
      }),
    },
    outboundService: async (r) => {
      if (r.url === 'https://pilot-readiness.invalid/')
        return new Response('', { status: initialized ? 200 : 503 });
      if (r.url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json(signer.jwks);
      if (r.url === 'https://oauth2.googleapis.com/token') {
        const f = new URLSearchParams(await r.text());
        return Response.json({
          id_token: await signer.sign({ nonce: f.get('code'), email: TEST_EMAIL }),
        });
      }
      throw Error('Unexpected provider target');
    },
  }),
);
const db = await mf.getD1Database('DB');
for (const f of [
  '0003_oauth_attempts.sql',
  '0004_private_sessions.sql',
  '0012_browser_session_order.sql',
]) {
  const sql = readFileSync('migrations/' + f, 'utf8');
  const parts = sql.includes('-- @statement')
    ? sql.split('-- @statement')
    : sql.replace(/^--.*$/gm, '').split(/;\s*(?:\n|$)/);
  for (const part of parts) if (part.replace(/^--.*$/gm, '').trim()) await db.prepare(part).run();
}
initialized = true;
await mf.ready;
console.log('Local fictional pilot ready');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit();
  });
