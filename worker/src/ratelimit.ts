import type { Env } from './env';

// One durable singleton owns the global fixed window, including across isolates.
export class RateLimiter implements DurableObject {
  constructor(private state: DurableObjectState) {
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS rate_window (id INTEGER PRIMARY KEY, start INTEGER NOT NULL)');
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS rates (ip TEXT PRIMARY KEY, hits INTEGER NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    const { ip, windowMs, max } = await request.json<{
      ip: string; windowMs: number; max: number;
    }>();
    const result = this.state.storage.transactionSync(() => {
      const sql = this.state.storage.sql;
      const now = Date.now();
      let start = sql.exec<{ start: number }>('SELECT start FROM rate_window WHERE id = 1').toArray()[0]?.start;
      if (start === undefined || now - start >= windowMs) {
        start = now;
        sql.exec('DELETE FROM rates');
        sql.exec('INSERT OR REPLACE INTO rate_window VALUES (1, ?)', start);
      }
      const { hits } = sql.exec<{ hits: number }>(`INSERT INTO rates VALUES (?, 1)
        ON CONFLICT(ip) DO UPDATE SET hits = hits + 1 RETURNING hits`, ip).one();
      return { hits, reset: start + windowMs, now };
    });
    return Response.json({ ...result, max });
  }
}

export async function rateLimit(request: Request, env: Env) {
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName('global'));
  const response = await stub.fetch('https://rate.internal/', {
    method: 'POST',
    body: JSON.stringify({
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      windowMs: Number(env.RATE_WINDOW_MS), max: Number(env.RATE_MAX),
    }),
  });
  const { hits, reset, now, max } = await response.json<{
    hits: number; reset: number; now: number; max: number;
  }>();
  const headers = new Headers({
    'x-ratelimit-limit': String(max),
    'x-ratelimit-remaining': String(Math.max(0, max - hits)),
    'x-ratelimit-reset': String(Math.ceil(reset / 1000)),
  });
  if (hits > max) headers.set('retry-after', String(Math.max(1, Math.ceil((reset - now) / 1000))));
  return { limited: hits > max, headers };
}
