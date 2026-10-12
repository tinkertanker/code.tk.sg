# Moving code.tk.sg to Cloudflare Workers

Status: in progress (started 2026-10-12). Owner thread:
https://ampcode.com/threads/T-7ef64b2c-8570-41ac-8e77-4f860998aa75

## Why

The shared host `dev.tk.sg` has a failing SATA link on its only disk and has
hung twice (2026-10-10, 2026-10-12). code.tk.sg moves off it to Cloudflare as a
TypeScript Worker. The Rust server stays in the repo, untouched, until cutover
is verified; it is removed in a later PR.

## Target architecture

```
worker/                      new TypeScript Worker (wrangler)
  wrangler.jsonc             name: code-tk; assets: ../static (built); D1 binding DB
  src/index.ts               router: assets first, then API and paste routes
  src/store.ts               D1 storage (schema below)
  src/keys.ts                phonetic key generator (port of src/main.rs key())
  src/upload.ts              raw + multipart uploads, byte limits, early rejection
  src/ratelimit.ts           fixed-window limit shared by all routes
  src/preview.ts             /preview/{file}.png and <meta> injection
  migrations/0001_init.sql   D1 schema
  test/                      vitest + @cloudflare/vitest-pool-workers
scripts/rdb-to-d1/           one-off Redis dump -> D1 SQL converter
```

- **Static files**: Workers Static Assets serving the built `static/` directory
  (including `application.min.js` from `npm run build`). Existing files win over
  paste routes, as with ServeDir today.
- **Highlighting** stays client-side (unchanged `static/`). The preview image
  uses highlight.js natively in the Worker (no QuickJS) and
  `@resvg/resvg-wasm` with the bundled `lib/fonts/DejaVuSansMono.ttf` and logo.
- **Storage: D1** (KV can't create-if-absent atomically or renew TTL on read):

  ```sql
  CREATE TABLE documents (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER          -- unix seconds; NULL = never expires
  );
  CREATE INDEX documents_expires_at ON documents(expires_at);
  ```

  - Saves are insert-only (`INSERT ... ON CONFLICT DO NOTHING`, retry with a
    new key; fail when keys are exhausted), never overwriting.
  - `GET /documents/{id}` and `GET /raw/{id}` renew `expires_at = now + expire`
    (sliding expiry); page loads (`/{key}`) and `/preview/...` do not, matching
    `test_sliding_expiry_only_on_document_reads`.
  - Expired rows are invisible on read and deleted by a daily Cron Trigger.
  - Static documents (`about` from `about.md`) are bundled into the Worker and
    never stored or expired.
- **Config** moves from `config.json` to `wrangler.jsonc` vars: `KEY_LENGTH`
  (10), `MAX_LENGTH` (400000), `EXPIRE` (31536000), `STATIC_MAX_AGE` (86400),
  `RATE_WINDOW_MS` (1800000), `RATE_MAX` (250).
- **Rate limiting**: keep today's semantics (one fixed window shared by all
  routes, per client IP from `CF-Connecting-IP`, never `X-Forwarded-For`).
  Implement with a Durable Object or D1 counter; the Rate Limiting binding's
  10s/60s periods can't express a 30-minute window.

## Behaviour contract

`tests/compatibility.py` is the acceptance contract. Every behaviour it covers
must hold for the Worker: URL forms (`/{key}`, `/{key}.{ext}`, legacy routes),
upload round-trips and UTF-8/byte limits with early rejection, the multipart
contract, 404s and static routes, preview metadata and PNG, `HEAD`, sliding
expiry, shared rate limit and window reset, insert-only saves under
concurrency, request-host use with escaping, and legacy implicit types.
Tests that exercise Redis or file-storage internals are rewritten against D1
with the same intent; none are dropped silently.

## Data migration

- Source: Redis db 2 (about 1,845 keys; largest about 320 KB). Db 0 belongs to
  another app and is not migrated.
- `scripts/rdb-to-d1` loads a dump into a throwaway Redis, reads every db 2 key
  with its TTL, and emits idempotent upserts that never change content and only
  extend expiry, with
  `expires_at = dump_time + ttl` (NULL when there is no TTL).
- Run once for staging. At cutover: full dump → import into a fresh, empty
  `code-tk-prod` → attach the `code.tk.sg` custom domain → drain (wait 30+
  minutes, watch the old server's request log, then stop the old `haste`
  container) → final dump → catch-up import, which adds new pastes and extends
  expiries renewed on the old server. See `scripts/rdb-to-d1/README.md`.
- Before cutover, prove live routing on staging: attach a staging custom
  domain under the same `*.tk.sg` wildcard and confirm it reaches the Worker.
## Phases and owners

1. **Core Worker** (sub-orb A): skeleton, D1 store, routes, uploads, keys,
   rate limit, static assets, tests porting the compatibility contract.
2. **Preview images** (sub-orb B): `src/preview.ts` with
   `renderPreviewPng(key, ext: string | undefined, data, host)` and
   `injectMeta(indexHtml, {key, data, url, imageUrl})` (all strings),
   matching `src/preview.rs` output closely; its own tests.
3. **Data migration tool** (sub-orb C): `scripts/rdb-to-d1`, verified against
   the real dump's key count and spot-checked contents.
4. **Integration, staging and cutover** (owner thread): merge A/B/C, create D1
   databases, deploy to `code-tk.tinkertanker.workers.dev`, load data, verify,
   then attach the `code.tk.sg` custom domain (overrides the `*.tk.sg`
   wildcard for that name only), and keep the old server read-only for a few
   days.

Sub-orbs work locally only (`wrangler dev`, local D1, Miniflare). Creating
Cloudflare resources, deploying, DNS changes and cutover happen in the owner
thread with the user's approval.
