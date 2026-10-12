export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  RATE_LIMITER: DurableObjectNamespace;
  KEY_LENGTH: number;
  MAX_LENGTH: number;
  EXPIRE: number;
  STATIC_MAX_AGE: number;
  RATE_WINDOW_MS: number;
  RATE_MAX: number;
}
