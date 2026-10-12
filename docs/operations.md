# Maintainer operations

## Architecture

code.tk.sg is a Cloudflare Worker in the Tinkertanker Cloudflare account.

| | Production | Staging |
|---|---|---|
| Worker | `code-tk` | `code-tk-staging` |
| Hostname | `code.tk.sg` (Worker custom domain) | `code-staging.tk.sg`, `code-tk-staging.tinkertanker.workers.dev` |
| D1 database | `code-tk-prod` | `code-tk-staging` |
| Rate limiter | Durable Object `RateLimiter` | its own `RateLimiter` |

Both are defined in `worker/wrangler.jsonc` (production at top level, staging
under `env.staging`). The Worker serves `static/` as Workers Static Assets, stores
pastes in D1 (`worker/migrations/`), and deletes expired pastes in a daily cron
(00:00 UTC). Other `*.tk.sg` names still resolve through the `*.tk.sg` wildcard;
the custom domain overrides it for `code.tk.sg` only.

## Deploying

Deploys need a Cloudflare API token with Workers and D1 access for the
Tinkertanker account (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). Deploy only
what is merged to `main`, staging first:

```sh
git checkout main && git pull
npm ci && npm run build
cd worker && npm ci
npx wrangler deploy --env staging   # check https://code-staging.tk.sg
npx wrangler deploy                 # production
```

After a production deploy, check the home page, an existing paste
(`/raw/<key>`), saving a new paste, and a preview image
(`/preview/<key>.png`). Bump the `?v=` keys in `static/index.html` when changing
static CSS or JS so browsers fetch the new files.

Schema changes go in a new `worker/migrations/NNNN_*.sql` file. Apply them to
staging and production before deploying code that needs them:

```sh
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler d1 migrations apply DB --remote
```

## Rollback

Each deploy creates a Worker version. List and roll back with:

```sh
npx wrangler deployments list
npx wrangler rollback <version-id>
```

Rolling back code does not touch D1 data. If a migration changed the schema,
check the older code still works with it before rolling back.

## Backups

- **D1 Time Travel:** Cloudflare keeps 30 days of point-in-time history for D1.
  Restore with `npx wrangler d1 time-travel restore code-tk-prod --timestamp <ISO>`
  (this replaces the live database; export it first).
- **Exports:** `npx wrangler d1 export code-tk-prod --remote --output code-tk-prod.sql`
  writes a full SQL dump. Store exports privately: they contain every paste.
- **Pre-migration backup:** the last Redis snapshot from the old server
  (2026-10-12) is in the private R2 bucket `code-tk-backups` under
  `redis-db/20261012T0405Z/`. `scripts/rdb-to-d1/` converts it to D1 SQL.

## Security notes

- `MAX_LENGTH` (400000) limits UTF-8 bytes. Raw uploads are rejected as soon as
  they exceed it; multipart bodies may add 16 KiB of envelope and accept one
  `data` field and no files. Unknown charsets return 400.
- Rate limiting is one fixed window shared by all routes (250 requests per 30
  minutes per client IP from `CF-Connecting-IP`; forwarded headers are never
  trusted). If the limiter errors, requests are allowed through and the error is
  logged ("Rate limiter failed").
- Saves are insert-only; an exhausted keyspace returns 503 instead of
  overwriting. Pastes are unlisted, not private: anyone with the URL can read one.
- Run `npm audit` in the repository root and in `worker/` when updating
  dependencies. Rebuild the browser highlighter with `scripts/build-highlight.sh`
  (edit its language list to add or remove languages); jQuery is loaded from its
  CDN with subresource integrity.

## Amp orbs

`.agents/setup` installs Node 22 and the locked dependencies, builds the browser
assets, and creates the local D1 schema. No Cloudflare credentials are needed for
local work. `amp orb services ensure` starts the Worker with `wrangler dev`
(local D1) and prints a portal URL. Never build or deploy from an orb without
explicit approval; use the commands above.
