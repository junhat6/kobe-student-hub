import { build } from 'esbuild';
await build({
  entryPoints: { 'auth-test': 'tests/fixtures/auth-worker.ts', 'attempt-test': 'tests/fixtures/oauth-attempt-worker.ts', 'browser-flow-test': 'tests/fixtures/browser-flow-worker.ts', 'session-test': 'tests/fixtures/session-worker.ts', 'google-login-test': 'tests/fixtures/google-login-worker.ts', 'draft-test': 'tests/fixtures/draft-worker.ts', 'draft-http-test': 'tests/fixtures/draft-http-worker.ts' },
  outdir: '.worker', bundle: true, format: 'esm', platform: 'browser',
});
