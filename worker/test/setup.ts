import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';
import { reset } from 'cloudflare:test';
import schema from '../migrations/0001_init.sql?raw';

beforeEach(async () => {
  await reset();
  await env.DB.exec(schema.replace(/--[^\n]*/g, '').replace(/\n/g, ' '));
  await env.DB.prepare('INSERT INTO documents VALUES (?, ?, ?)')
    .bind('legacykey', 'old paste\né <&>\n', Math.floor(Date.now() / 1000) + 20).run();
});
