import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    setupFiles: ['./test/setup.ts'], fileParallelism: false,
    // preview.test.ts uses Node's zlib (pngjs); it runs under test/preview.config.ts
    exclude: ['test/preview.test.ts', 'node_modules/**'],
    provide: {
      previewIntegrated: true, // phase 2 renderer is integrated
      css: readFileSync('../static/application.css', 'utf8'),
    },
  },
});
