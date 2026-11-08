import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('tests/editor'),
  plugins: [react()],
  build: { outDir: resolve('.editor-preview'), emptyOutDir: true },
  server: { fs: { allow: [resolve('.')] } },
});
