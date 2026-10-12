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

**Merging to `main` deploys automatically.** After both test jobs pass, the CI
`deploy` job applies D1 migrations and deploys to staging, smoke-tests it
(`scripts/smoke-test.sh`, which saves one small paste), then does the same for
production. Deploys run one at a time in the GitHub `production` environment.

The job needs a `CLOUDFLARE_API_TOKEN` secret on that environment (repository
Settings → Environments → production). Use a token scoped to the Tinkertanker
account with **Workers Scripts: Edit**, **D1: Edit** and **Workers Routes: Edit**
(zone `tk.sg`) only. Without it the job fails with a clear error and nothing is
deployed.

To deploy by hand (for example to redeploy after a rollback), use a token with
the same access (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). Deploy only
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

Add `--env staging` to either command for staging. Rolling back code does not
touch D1 data. Rolling back to a version from before 2026-10-12's per-IP rate
limiter leaves pending limiter alarms without a handler: they fail and retry
harmlessly in the logs, and rolling forward again cleans up. If a migration changed the schema,
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
- Rate limiting allows 250 requests per 30-minute window per client IP
  (`CF-Connecting-IP`; forwarded headers are never trusted), shared by all
  routes. Each IP has its own Durable Object: its window starts at its first
  request, and an alarm deletes its storage once the window has passed. If the
  limiter errors, requests are allowed through and the error is logged ("Rate
  limiter failed"). For floods from many IPs, add a Cloudflare WAF
  rate-limiting rule in front of the Worker.
- Preview images are rendered once per Cloudflare data center and then reused from its edge cache
  (for up to a day); browsers keep one for 5 minutes. The paste is always checked
  first, so an expired paste's preview stops being served when the paste does.
- Expired pastes are deleted nightly in batches of 1,000 (up to 100,000 per run).
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
