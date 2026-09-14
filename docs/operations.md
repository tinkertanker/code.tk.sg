# Maintainer operations

This runbook covers the code.tk.sg deployment. It is not required to run Haste
locally.

## Architecture

- `haste` is the Node.js application built from the `Dockerfile`.
- `redis` runs Redis 7 Alpine with data in the `redis-data` Docker volume.
- `config.production.js` selects Redis database 2 and expires pastes after one
  year of inactivity.
- The application listens on port 7777 inside the Docker network. The host's
  reverse proxy provides the public endpoint.

## Deployment

Production runs on `dev.tk.sg` in `Docker/code.tk.sg`. From a local checkout, run:

```sh
./deploy.sh
```

The script pulls the latest revision on the server, copies the Compose and
production configuration files, then rebuilds and restarts the containers. Pass
`--no-pull` when the server already has the intended revision or `--logs` to
follow the resulting Compose logs.

Keep `config.js` local and private. It is ignored by Git; use
`config.production.js` as the tracked production template.

## Security maintenance

`maxLength` limits UTF-8 bytes rather than JavaScript characters. Raw uploads are
rejected as soon as they exceed it. Multipart uploads accept one `data` field and
no files. Malformed forms return 400, and oversized fields return 413 without
saving a paste. Do not use `maxLength: 0` on a public deployment. Configure
reverse-proxy body-size and timeout limits as additional protection.

Express query parsing is disabled because the application does not use query
parameters. The `qs` override keeps Express 4's pinned dependency on a patched
release; remove it only when the resolved dependency is safe without it.

Build tools are development dependencies and are excluded from the runtime image.
Install with `npm ci` before `npm run build`. Run `npm audit` and
`npm audit --omit=dev` when updating dependencies. The vendored highlighter and
CDN jQuery require separate advisory checks.

## Backups

`scripts/backup.sh` triggers a Redis `BGSAVE` and copies the RDB snapshot. It
writes to `backups/` by default; set `BACKUP_BASE` to override that location.
Backup directories and RDB files are ignored by Git.

The retention policy is:

- daily snapshots for 7 days;
- Sunday snapshots for 28 days;
- first-of-month snapshots for 365 days;
- first-of-January snapshots forever.

Run `./scripts/backup.sh` from a Docker checkout. If no `docker-compose.yml` is
present, the script uses a standalone local Redis instance. Pass `--remote` to
run the Docker backup on `tinkertanker@dev.tk.sg`.

Production runs this cron entry:

```cron
0 2 * * * cd /home/tinkertanker-server/Docker/code.tk.sg && ./scripts/backup.sh >> /home/tinkertanker-server/Docker/code.tk.sg/backups/backup.log 2>&1
```

These snapshots are stored on the Redis host. They protect against accidental
volume deletion, but not loss of the host or deployment directory. Copy important
snapshots off-host when that risk must be covered.

Validate a snapshot before relying on it:

```sh
redis-check-rdb backups/daily/dump-YYYY-MM-DD.rdb
```

### Restore

Restoring requires brief downtime:

1. Stop the application so it cannot write.
2. Take a safety snapshot while Redis is still running, then stop Redis.
3. Replace Redis's `dump.rdb` with the validated backup.
4. Start Redis and confirm it contains the expected data.
5. Start the application and check a recovered document and the public service.

Keep the safety snapshot until the restore is verified. Never overwrite the only
copy of live data.

## Amp orbs

`.agents/setup` installs Node 20.20.0, Redis, and the locked npm dependencies,
then builds the browser bundle. It preserves an existing `config.js`; otherwise,
it copies the file-storage example. No production credentials or Docker daemon
are required.

Run `amp orb services ensure` to start the application and an isolated,
non-persistent Redis instance. The command prints a reviewable portal URL. Run
`npm test` for the test suite and `npm run testformat` for lint. Lint still
reports inherited formatting issues in the application.
