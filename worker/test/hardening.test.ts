import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { Store } from '../src/store';
import { limiterId, RateLimiter } from '../src/ratelimit';

async function request(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('https://paste.example' + path, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('hardening', () => {
  it('reuses a cached preview render but never outlives its paste', async () => {
    await env.DB.prepare('INSERT INTO documents VALUES (?, ?, NULL)').bind('cachekey', 'print("cached")\n').run();
    const first = await request('/preview/cachekey.py.png');
    expect(first.status).toBe(200);
    const png = new Uint8Array(await first.arrayBuffer());
    // Pastes are immutable in production; changing the row here proves the cached render is reused
    await env.DB.prepare('UPDATE documents SET data = ? WHERE key = ?').bind('print("changed")\n', 'cachekey').run();
    const second = await request('/preview/cachekey.py.png');
    expect(second.headers.get('content-type')).toBe('image/png');
    // Browsers only keep a preview briefly; the long-lived copy is the edge cache
    expect(first.headers.get('cache-control')).toBe('public, max-age=300');
    expect(second.headers.get('cache-control')).toBe('public, max-age=300');
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(png);
    // Once the paste is gone, its cached preview is not served
    await env.DB.prepare('DELETE FROM documents WHERE key = ?').bind('cachekey').run();
    expect((await request('/preview/cachekey.py.png')).status).toBe(404);
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

  it('gives each client IP its own limiter object', async () => {
    const vars = { ...env, RATE_MAX: 1, RATE_WINDOW_MS: 60000 };
    const hit = (ip: string) => worker.fetch(new Request('https://paste.example/', { headers: { 'CF-Connecting-IP': ip } }), vars);
    expect((await hit('198.51.100.1')).status).toBe(200);
    expect((await hit('198.51.100.1')).status).toBe(429);
    expect((await hit('198.51.100.2')).status).toBe(200);
    const [a, b] = [limiterId(env, '198.51.100.1'), limiterId(env, '198.51.100.2')];
    expect(a.equals(b)).toBe(false);
    for (const [id, hits] of [[a, 2], [b, 1]] as const) {
      await runInDurableObject(env.RATE_LIMITER.get(id), (_: RateLimiter, state: DurableObjectState) => {
        expect(state.storage.sql.exec('SELECT hits FROM rate_window').toArray()).toEqual([{ hits }]);
      });
    }
  });

  it('clears an IP\'s storage once its window has passed', async () => {
    const vars = { ...env, RATE_MAX: 5, RATE_WINDOW_MS: 200 };
    const hit = () => worker.fetch(new Request('https://paste.example/', { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), vars);
    expect((await hit()).status).toBe(200);
    const stub = env.RATE_LIMITER.get(limiterId(env, '203.0.113.9'));
    await runInDurableObject(stub, async (_: RateLimiter, state: DurableObjectState) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    // The alarm may already have fired by itself; run it if it is still pending
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, (_: RateLimiter, state: DurableObjectState) => {
      expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'rate_window'").toArray()).toEqual([]);
    });
    // The limiter keeps working after its storage was cleared
    expect((await hit()).headers.get('x-ratelimit-remaining')).toBe('4');
  });
});
