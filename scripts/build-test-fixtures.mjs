import { build } from 'esbuild';
await build({
  entryPoints: { 'auth-test': 'tests/fixtures/auth-worker.ts', 'attempt-test': 'tests/fixtures/oauth-attempt-worker.ts' },
  outdir: '.worker', bundle: true, format: 'esm', platform: 'browser',
});
