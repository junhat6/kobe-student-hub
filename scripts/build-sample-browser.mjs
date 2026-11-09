// Local regression build for the retained sample reader, separate from the release assets.
// The normal `npm run build` and production source gates are never changed by this fixture.
import { build } from 'vite';
import { resolve } from 'node:path';
await build({
  configFile: resolve('vite.config.ts'),
  define: { __ACCOUNT_UI_RELEASE_ENABLED__: true, __AUTHORING_UI_RELEASE_ENABLED__: false },
  build: { outDir: resolve('.wrangler/sample-browser-assets'), emptyOutDir: true },
});
