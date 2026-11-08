import { readdirSync } from 'node:fs';
/** Miniflare 5's V4 converter requires explicit compiled-module entries (modulesRules is unsupported). */
export function workerModules(path: string) {
  return [
    { type: 'ESModule' as const, path },
    ...readdirSync('.worker')
      .filter((name) => name.endsWith('.wasm'))
      .map((name) => ({ type: 'CompiledWasm' as const, path: '.worker/' + name })),
  ];
}
