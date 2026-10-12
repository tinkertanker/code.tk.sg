import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    setupFiles: ['./test/setup.ts'], fileParallelism: false,
    provide: {
      previewIntegrated: process.env.PREVIEW_INTEGRATION === '1',
      css: readFileSync('../static/application.css', 'utf8'),
    },
  },
});
