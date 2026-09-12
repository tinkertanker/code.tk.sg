# code.tk.sg

Tinkercademy's deployment fork of **Haste**, a simple pastebin for sharing code and text at [code.tk.sg](https://code.tk.sg). It is based on [zneix/haste-server](https://github.com/zneix/haste-server) v0.2.5, a continuation of John Crepezzi's Haste. We did not write the original pastebin application.

## Upstream and our changes

- **Upstream authors:** John Crepezzi created Haste; zneix and other contributors continued haste-server. The server, storage adapters, key generators, tests, and original browser interface come from that lineage. Brian Dawson is credited for the key design.
- **Original project:** [seejohnrun/haste-server](https://github.com/seejohnrun/haste-server) is retained here as a historical link (unavailable when checked). [zneix/haste-server](https://github.com/zneix/haste-server) is our direct upstream.
- **Our fork:** Tinkercademy maintains the code.tk.sg deployment, Docker packaging, deployment and backup scripts, production configuration, branded frontend adaptations, and Amp orb setup. Our production Redis configuration expires pastes after one year of inactivity.
- **Documentation:** this README describes our fork and operations. The guides for [installation](docs/install.md), [storage](docs/storage.md), and [key generators](docs/generators.md) were inherited from zneix/haste-server and are labelled as upstream reference material. The [language guide](docs/languages.md) is maintained for our current browser bundle. [`about.md`](about.md) separates our service policies from adapted Haste usage text.

The inherited guides describe the upstream version, not necessarily the restored frontend or current deployment. For this fork's local setup, use Node 20 (matching the Dockerfile), run `npm ci`, copy `example.config.js` to `config.js` if it does not already exist, run `npm run build`, then `npm start`. The example uses local file storage; the production Compose configuration below is specific to our infrastructure.

## How it runs

- `haste` is the Node.js application, built and run from the `Dockerfile`.
- `redis` uses Redis 7 (Alpine) in `docker-compose.yml`, with its data in the `redis-data` volume.
- `config.production.js` selects Redis database 2 and a 31536000-second expiry. `deploy.sh` copies it to `config.js`, then builds and restarts the Compose stack.
- The application listens on port 7777 inside the Docker network. The host's reverse proxy provides the public `code.tk.sg` endpoint.

## Security maintenance

`maxLength` limits UTF-8 bytes, not JavaScript characters. Raw uploads are rejected
as soon as they exceed it; multipart uploads accept one `data` field and no files.
Malformed forms return 400 and oversized fields return 413 without saving a paste.
Do not use `maxLength: 0` on a public deployment. Configure reverse-proxy body-size
and timeout limits as additional protection against slow or oversized requests.

Express query parsing is disabled because the application does not use query
parameters. The `qs` override keeps Express 4's pinned dependency on a patched
release; remove it only once the resolved dependency is safe without it.
Build tools are development dependencies and are excluded from the runtime image.
Install with `npm ci` before `npm run build`; building no longer installs packages
or changes the lockfile. Run `npm audit` and `npm audit --omit=dev` when updating
dependencies. The vendored highlighter and CDN jQuery need separate advisory checks.

## Deployment

The deployment host is `dev.tk.sg`, at `Docker/code.tk.sg`. From the repository, `./deploy.sh` pulls the latest revision, copies the Compose and production configuration files, and rebuilds the containers. Use `./deploy.sh --no-pull` when the server already has the desired revision; `./deploy.sh --logs` follows the resulting Compose logs.

Keep `config.js` local and private. It is ignored by Git; use `config.production.js` as the tracked production template.

## Amp orbs

`.agents/setup` installs Node 20.20.0 (matching Docker's Node 20 major), Redis,
and the locked npm dependencies, then builds the browser bundle. It preserves an
existing `config.js`; otherwise it copies the file-storage example. No production
credentials or Docker daemon are needed. Amp snapshots the prepared environment.
The resume hook intentionally performs no installs or service startup.

Run `amp orb services ensure` to start the app and an isolated, non-persistent
Redis instance on loopback port 6379 for tests. The command prints the app's
reviewable portal URL. Run `npm test` for the test suite and `npm run testformat`
for lint. Redis and app processes are supervised separately from setup and resume.
Lint still reports inherited formatting issues in the application.

## Backups

[`scripts/backup.sh`](scripts/backup.sh) triggers a Redis `BGSAVE` and copies the resulting RDB snapshot. By default it writes under `backups/` beside the repository (the `BACKUP_BASE` environment variable can override this). `backups/` and RDB files are ignored by Git.

The production cron stores these snapshots on the same host as Redis. This protects against accidental volume deletion, but not loss of the host or deployment directory. Copy important snapshots off-host if that risk must be covered.

The retention policy is:

- daily snapshots for 7 days;
- Sunday snapshots for 28 days;
- first-of-month snapshots for 365 days;
- first-of-January snapshots forever.

For a local Docker checkout, run `./scripts/backup.sh`. If no `docker-compose.yml` is present, the script falls back to a standalone local Redis instance. Add `--remote` to run the Docker backup on `tinkertanker@dev.tk.sg`.

The production cron entry is:

```cron
0 2 * * * cd /home/tinkertanker-server/Docker/code.tk.sg && ./scripts/backup.sh >> /home/tinkertanker-server/Docker/code.tk.sg/backups/backup.log 2>&1
```

Validate an RDB before relying on it:

```bash
redis-check-rdb backups/daily/dump-YYYY-MM-DD.rdb
```

### Restore

Restore requires brief downtime. Stop the application first so it cannot write, take a safety snapshot from the still-running Redis service, then stop Redis. Replace Redis's `dump.rdb` with the validated backup, start Redis, and confirm it contains the expected data. Start the application and check a recovered document and the public service. Keep the safety snapshot until the restore has been verified; do not overwrite the only copy of live data.

## Attribution and licence

The Haste application is MIT-licensed; we retain John Crepezzi's copyright and the full [`LICENSE`](LICENSE). Tinkercademy's code and documentation changes are provided under the same MIT terms. Third-party components retain their own licences; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the bundled highlighting library, theme, and other credits.

Software licensing does not grant permission to use Tinkercademy's name or logo to imply affiliation or endorsement. Review or replace deployment-specific branding when running your own service.
