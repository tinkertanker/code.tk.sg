import type { Env } from './env';

// One Durable Object per client IP holds that IP's fixed window, so no single
// object serialises every request and a flood only queues on its own IPs.
export class RateLimiter implements DurableObject {
  constructor(private state: DurableObjectState) {}

  // Recreated on demand: alarm() deletes all storage once a window has passed
  private table() {
    this.state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rate_window
      (id INTEGER PRIMARY KEY, start INTEGER NOT NULL, hits INTEGER NOT NULL, window_ms INTEGER NOT NULL)`);
  }

  async fetch(request: Request): Promise<Response> {
    const { windowMs, max } = await request.json<{ windowMs: number; max: number }>();
    this.table();
    const result = this.state.storage.transactionSync(() => {
      const sql = this.state.storage.sql;
      const now = Date.now();
      const row = sql.exec<{ start: number; hits: number }>('SELECT start, hits FROM rate_window WHERE id = 1').toArray()[0];
      const fresh = !row || now - row.start >= windowMs;
      const start = fresh ? now : row.start;
      const hits = fresh ? 1 : row.hits + 1;
      sql.exec('INSERT OR REPLACE INTO rate_window VALUES (1, ?, ?, ?)', start, hits, windowMs);
      return { hits, reset: start + windowMs, now, fresh };
    });
    // Each new window schedules its own cleanup, so idle IPs leave no storage behind
    if (result.fresh) await this.state.storage.setAlarm(result.reset);
    return Response.json({ hits: result.hits, reset: result.reset, now: result.now, max });
  }

  async alarm(): Promise<void> {
    this.table();
    const row = this.state.storage.sql.exec<{ start: number; window_ms: number }>(
      'SELECT start, window_ms FROM rate_window WHERE id = 1').toArray()[0];
    if (!row || Date.now() >= row.start + row.window_ms) await this.state.storage.deleteAll();
  }
}

export function limiterId(env: Env, ip: string) {
  return env.RATE_LIMITER.idFromName('ip:' + ip);
}

export async function rateLimit(request: Request, env: Env) {
  // CF-Connecting-IP is set by Cloudflare and can't be spoofed; never trust X-Forwarded-For
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const response = await env.RATE_LIMITER.get(limiterId(env, ip)).fetch('https://rate.internal/', {
    method: 'POST',
    body: JSON.stringify({ windowMs: Number(env.RATE_WINDOW_MS), max: Number(env.RATE_MAX) }),
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
