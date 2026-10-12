import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
export default defineConfig({
  resolve: {alias: {'@resvg/resvg-wasm/index_bg.wasm': '\0preview-wasm.js'}},
  plugins: [{
    name: 'preview-worker-assets',
    enforce: 'pre',
    resolveId(id) {
      if (id === '\0preview-wasm.js') return id;
    },
    load(id) {
      const wasm = id === '\0preview-wasm.js';
      if (!wasm && !/\.(ttf|png)$/.test(id)) return;
      const bytes = JSON.stringify([...readFileSync(wasm ? require.resolve('@resvg/resvg-wasm/index_bg.wasm') : id)]);
      return `export default ${wasm ? `new WebAssembly.Module(new Uint8Array(${bytes}))` : `new Uint8Array(${bytes}).buffer`};`;
    },
  }],
  test: {include: ['test/preview.test.ts'], testTimeout: 60000},
});
