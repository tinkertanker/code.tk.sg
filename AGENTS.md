# Agent notes

## Architecture

code.tk.sg is a Cloudflare Worker (`worker/`) serving the browser UI in
`static/`, with pastes in Cloudflare D1. There is no server to SSH into; the old
Rust/Docker deployment on `dev.tk.sg` was retired on 2026-10-12. See
`docs/operations.md`.

## Working locally

- Run `npm ci && npm run build` (repo root) before Worker tests or `wrangler dev`.
- Tests: `npm test` (frontend), `npm --prefix worker run typecheck`,
  `npm --prefix worker test`. The HTTP contract suite `tests/compatibility.py`
  runs against `npm --prefix worker run dev:compat` (see `worker/README.md`).
- Local development needs no Cloudflare credentials.

## Deploying

- Merging to `main` deploys to staging and production via CI (see
  `docs/operations.md`), so merging needs the same approval as deploying.
- Manual deploys require explicit user approval, per deploy. Deploy only `main`,
  staging (`--env staging`) before production; see `docs/operations.md` for
  commands, post-deploy checks and rollback.
- Credentials: the `CLOUDFLARE_API_KEY_TT` secret is an API token for the
  Tinkertanker account (export it as `CLOUDFLARE_API_TOKEN`). Never print it.
- Never touch D1 production data (imports, deletes, time-travel restores) without
  explicit approval; pastes are user data.
