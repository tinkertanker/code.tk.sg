import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { Store } from '../src/store';

async function request(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('https://paste.example' + path, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('hardening', () => {
  it('serves a rendered preview from the edge cache', async () => {
    await env.DB.prepare('INSERT INTO documents VALUES (?, ?, NULL)').bind('cachekey', 'print("cached")\n').run();
    const first = await request('/preview/cachekey.py.png');
    expect(first.status).toBe(200);
    const png = new Uint8Array(await first.arrayBuffer());
    // With the paste gone, only the cache can answer
    await env.DB.prepare('DELETE FROM documents WHERE key = ?').bind('cachekey').run();
    const second = await request('/preview/cachekey.py.png');
    expect(second.status).toBe(200);
    expect(second.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(png);
    // A different extension is a different cache entry
    expect((await request('/preview/cachekey.txt.png')).status).toBe(404);
  });

  it('deletes an expired backlog larger than one batch, keeping live pastes', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const insert = env.DB.prepare('INSERT INTO documents VALUES (?, ?, ?)');
    await env.DB.batch(Array.from({ length: 250 }, (_, i) => insert.bind('old' + i, 'x', past)));
    await env.DB.batch([insert.bind('alive', 'y', past + 3600), insert.bind('forever', 'z', null)]);
    const deleted = await new Store(env.DB, 60).cleanup(100);
    expect(deleted).toBe(250);
    const left = await env.DB.prepare('SELECT key FROM documents ORDER BY key').all<{ key: string }>();
    expect(left.results.map(r => r.key)).toEqual(['alive', 'forever', 'legacykey']);
  });

  it('limits each client IP independently', async () => {
    const vars = { ...env, RATE_MAX: 1, RATE_WINDOW_MS: 60000 };
    const hit = (ip: string) => worker.fetch(new Request('https://paste.example/', { headers: { 'CF-Connecting-IP': ip } }), vars);
    expect((await hit('198.51.100.1')).status).toBe(200);
    expect((await hit('198.51.100.1')).status).toBe(429);
    expect((await hit('198.51.100.2')).status).toBe(200);
    expect((await hit('198.51.100.2')).status).toBe(429);
  });
});
