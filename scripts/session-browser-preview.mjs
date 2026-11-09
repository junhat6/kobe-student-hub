// Local-only, ephemeral HTTPS/browser fixture. No Wrangler config or persisted DB is used.
import { build as viteBuild } from 'vite';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { enrollmentWindow } from '../src/shared/enrollment.ts';
await viteBuild({
  configFile: resolve('vite.config.ts'),
  define: { __ACCOUNT_UI_RELEASE_ENABLED__: true, __AUTHORING_UI_RELEASE_ENABLED__: true },
  build: {
    outDir: resolve('.generation-preview'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve('index.html'),
        generation: resolve('tests/generation-editor/index.html'),
      },
    },
  },
});
await build({
  entryPoints: ['tests/fixtures/session-browser-worker.ts'],
  outfile: '.worker/session-browser.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.sql': 'text', '.wasm': 'copy' },
});
await build({
  entryPoints: ['tests/helpers/google-fixtures.ts'],
  outfile: '.worker/browser-google.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
});
const { googleFixture } = await import('../.worker/browser-google.mjs');
const signer = await googleFixture();
// Mirror Static Assets headers instead of silently testing a less restrictive document.
// This repository currently has one wildcard rule; fail if the fixture parser needs an update.
const headerLines = readFileSync('.generation-preview/_headers', 'utf8').trimEnd().split(/\r?\n/);
if (headerLines.shift() !== '/*' || headerLines.some((line) => !/^  [^:\s]+: .+$/.test(line)))
  throw Error('Unsupported fixture asset header rules');
const assetHeaders = Object.fromEntries(
  headerLines.map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);
const tokens = new Map(),
  gates = new Map();
const gate = (tag) => {
  if (!gates.has(tag)) {
    let release;
    const promise = new Promise((r) => (release = r));
    gates.set(tag, { promise, release, entered: false });
  }
  return gates.get(tag);
};
let mf,
  initialized = false;
const control = async (r) => {
  const u = new URL(r.url),
    tag = u.searchParams.get('tag');
  if (u.pathname === '/__control/health')
    return new Response(initialized ? 'ready' : 'initializing', {
      status: initialized ? 200 : 503,
    });
  if (u.pathname === '/pause') {
    const g = gate(tag);
    g.entered = true;
    await g.promise;
    return new Response('released');
  }
  if (u.pathname === '/__control/ready') return Response.json({ entered: gate(tag).entered });
  if (u.pathname === '/__control/release') {
    gate(tag).release();
    return new Response('released');
  }
  if (u.pathname === '/__control/token') {
    tokens.set(
      u.searchParams.get('state'),
      await signer.sign({
        sub: u.searchParams.get('actor'),
        email: u.searchParams.get('actor') + '@st.kobedenshi.ac.jp',
        nonce: u.searchParams.get('nonce'),
      }),
    );
    return new Response('ready');
  }
  if (u.pathname === '/__control/expire') {
    await (
      await mf.getD1Database('DB')
    )
      .prepare('UPDATE auth_browser_contexts SET expires_at_ms=created_at_ms+1')
      .run();
    return new Response('expired');
  }
  return new Response('unknown', { status: 404 });
};
mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: [
      { type: 'ESModule', path: '.worker/session-browser.js' },
      ...readdirSync('.worker')
        .filter((name) => name.endsWith('.wasm'))
        .map((name) => ({ type: 'CompiledWasm', path: '.worker/' + name })),
    ],
    compatibilityDate: '2026-11-03',
    host: '127.0.0.1',
    port: 8790,
    https: true,
    d1Databases: ['DB'],
    outboundService: async (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'fixture-assets.invalid') {
        const path =
          u.pathname === '/lab/account'
            ? 'tests/generation-editor/index.html'
            : [
                  '/',
                  '/search',
                  '/signup',
                  '/login',
                  '/account',
                  '/drafts',
                  '/works',
                  '/works/new',
                  '/moderation',
                  '/guide',
                  '/about',
                ].includes(u.pathname) ||
                /^\/(?:(?:articles|projects)\/[0-9a-f-]{36}|students\/[A-Za-z0-9_-]{1,128}(?:\/(?:likes|works))?)$/.test(
                  u.pathname,
                )
              ? 'index.html'
              : u.pathname.slice(1);
        if (
          !/^(?:index\.html|tests\/generation-editor\/index\.html|assets\/[A-Za-z0-9_.-]+)$/.test(
            path,
          )
        )
          throw Error('Invalid fixture asset');
        return new Response(readFileSync('.generation-preview/' + path), {
          headers: {
            ...assetHeaders,
            'Content-Type': path.endsWith('.js')
              ? 'text/javascript'
              : path.endsWith('.css')
                ? 'text/css'
                : 'text/html',
          },
        });
      }
      if (u.hostname === 'fixture-control.invalid') return control(r);
      if (r.url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json(signer.jwks);
      if (r.url === 'https://oauth2.googleapis.com/token') {
        const f = new URLSearchParams(await r.text());
        return Response.json({ id_token: tokens.get(f.get('code')) });
      }
      throw Error('Unexpected outbound request blocked: ' + u.origin);
    },
  }),
);
const db = await mf.getD1Database('DB');
for (const f of [
  '0001_discovery.sql',
  '0003_oauth_attempts.sql',
  '0004_private_sessions.sql',
  '0005_private_article_drafts.sql',
  '0006_article_reports.sql',
  '0007_article_publications.sql',
  '0008_article_likes.sql',
  '0009_standalone_projects.sql',
  '0010_project_reports.sql',
  '0011_publication_stops.sql',
  '0012_browser_session_order.sql',
  '0016_self_declared_enrollment.sql',
  '0017_self_registration.sql',
  '0018_article_moderation_decisions.sql',
  '0019_moderation_notifications.sql',
  '0020_private_images.sql',
  '0021_project_moderation.sql',
  '0022_article_revisions.sql',
]) {
  const sql = readFileSync('migrations/' + f, 'utf8');
  const parts = sql.includes('-- @statement')
    ? sql.split('-- @statement')
    : sql.replace(/^--.*$/gm, '').split(/;\s*(?:\n|$)/);
  for (const part of parts) if (part.replace(/^--.*$/gm, '').trim()) await db.prepare(part).run();
}
for (const actor of ['fictional-browser-a', 'fictional-browser-b'])
  await db
    .prepare('INSERT INTO private_accounts VALUES(?,?,?,?,?,?)')
    .bind(actor, actor, actor + '@st.kobedenshi.ac.jp', 'active', 0, Date.now())
    .run();
const fixtureNow = Date.now(),
  fixtureDate = new Date(fixtureNow + 9 * 3600000),
  fixtureYear = fixtureDate.getUTCFullYear() - (fixtureDate.getUTCMonth() < 3 ? 1 : 0),
  fixtureWindow = enrollmentWindow({
    admissionYear: fixtureYear - 1,
    graduationYear: fixtureYear + 1,
  });
for (const actor of ['fictional-browser-a', 'fictional-browser-b'])
  await db
    .prepare('INSERT INTO private_enrollment_periods VALUES(?,?,?,?,?,1,1,?)')
    .bind(
      actor,
      fixtureYear - 1,
      fixtureYear + 1,
      fixtureWindow.startsAtMs,
      fixtureWindow.endsAtMs,
      fixtureNow,
    )
    .run();
initialized = true;
await mf.ready;
console.log('Local HTTPS generation fixture ready');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit(0);
  });
