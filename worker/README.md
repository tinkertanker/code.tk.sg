# Core Cloudflare Worker (phase 1)

All commands here are local. No Cloudflare login, token, database creation or
deployment is needed. The all-zero database ID is a local placeholder; the
integration owner supplies the real ID before staging.

From the repository root:

```sh
npm ci && npm run build                 # unchanged frontend build
npm --prefix worker ci
npm --prefix worker test
npm --prefix worker run typecheck
npm --prefix worker run build           # Wrangler --dry-run only
npm --prefix worker run db:init         # applies migrations locally
npm --prefix worker run dev
```

Run Worker commands in `worker/` when invoking Wrangler directly. Static Assets
use the built `../static/` tree. `run_worker_first` is intentional: every request,
including static assets, consumes the same rate limit. Existing files take
priority over page routes. API names are case-insensitive; paste keys are not.

D1 saves use atomic insert-if-absent with 1,000 retries. Expired rows are
invisible, and the daily cron deletes them. Both `/documents/{id}` and
`/raw/{id}` GET/HEAD renew expiry, matching Rust's GET-to-HEAD dispatch; page and
preview reads do not. NULL expiry stays permanent. Bundled `about.md` bypasses
D1 entirely, even if storage fails.

A singleton SQLite Durable Object persists the shared window start and atomic
per-IP counters. This preserves a global rolling fixed-window start (not
per-IP first-hit windows or wall-clock buckets). Counters live in separate SQL
rows rather than a size-limited KV object. Only `CF-Connecting-IP` is used;
requests without it share `unknown` for local development. Do not expose a
non-Cloudflare proxy that lets clients spoof that header.

## Preview integration

`src/preview.ts` is the agreed placeholder. `injectMeta(indexHtml, {key, data,
url, imageUrl})` provides escaped metadata; `renderPreviewPng(key, ext, data,
host)` deliberately throws until phase 2 replaces it. Existing preview routes
therefore return 500 for found documents, and 404 for missing documents or
non-PNG URLs. No fake PNG is returned. After integration:

```sh
PREVIEW_INTEGRATION=1 npm --prefix worker test
```

The requested `@cloudflare/vitest-pool-workers` package is now deprecated.
It is retained as requested; its pinned Wrangler/Miniflare dependencies are
overridden to patched versions (verified with the suite). `.npmrc` avoids an
npm peer-resolution crash in its optional Vitest peer graph. Compatibility
date is shared between tests and runtime, not silently downgraded in tests.

## Original Python HTTP contract against Wrangler

Use a disposable local D1 database and these test-specific variables. In
`worker/`, initialize and seed the legacy document, then run the dev server:

```sh
npm run db:init
npx wrangler d1 execute code-tk --local --command "INSERT OR REPLACE INTO documents VALUES ('legacykey', 'old paste' || char(10) || 'é <&>' || char(10), NULL)"
npm run dev -- --port 8787 --var MAX_LENGTH:32 --var EXPIRE:60 --var RATE_MAX:10000
```

In an orb, run the server as an `amp orb service`, not a detached shell process.
In another terminal from the repository root:

```sh
WORKER_URL=http://127.0.0.1:8787 WORKER_SKIP_PREVIEW=1 python3 tests/compatibility.py
```

Omit `WORKER_SKIP_PREVIEW` after phase-2 integration. Worker mode accepts only
loopback HTTP URLs; it never starts Rust/Redis or mutates file storage. The
Python mode exercises real HTTP, including unterminated chunked uploads.
Storage/TTL, collisions and rate-variable variants are covered by Vitest, not
by changing configuration of an already running server.

## Compatibility test accounting

The file and Redis suites inherited the same HTTP tests; each is ported once
against D1, not duplicated by backend. `test/compatibility.test.ts` covers:

| Python contract | Worker coverage / adaptation |
| --- | --- |
| existing storage and extension URLs | seeded D1 row; JSON/raw payloads |
| legacy route matching | case, trailing slash, query, wrong methods |
| upload roundtrip and byte limits | D1 row/expiry replaces MD5-file and Redis GET/TTL assertions |
| chunked UTF-8 and early limit rejection | split UTF-8 stream and oversized stream with no EOF; also real HTTP Python |
| multipart contract | every payload, error and charset from Python |
| multipart preamble limit | permitted preamble and early whole-stream rejection; extra field-limit check |
| missing and static routes | unchanged asset bytes; D1 table removal replaces file-path failure injection; bundled about intentionally remains available |
| preview metadata and PNG | metadata active; PNG signature, 1200×900, all suffixes and Ruby astral text ported but gated until phase 2 |
| HEAD | raw contract plus APIs, pages, assets and errors |
| sliding expiry | D1 timestamps replace Redis TTL; both raw/documents renew, pages/preview don't; bundled about has no row |
| shared rate limit | all routes, CF IP separation, spoofed X-Forwarded-For, headers and blocked upload |
| window resets | 500 ms fixed window, real reset after 600 ms |
| simultaneous saves / exhaustion (file + Redis) | prefill phonetic space leaving only a/b; concurrent saves, retries, exhaustion and no overwrite |
| request host and escaping | request host/protocol, escaped content/key and URL encoding |
| implicit file/random types | **not ported**: Worker has D1 and phonetic generation only; no JSON config loader, file backend, random-keyspace setting or implicit type tags |

Additional D1 contracts cover expiry invisibility at the boundary, cron cleanup,
zero/permanent expiry, UTF-8 replacement expansion, and concurrent rate counts
surviving Durable Object eviction. No other compatibility cases were dropped.
