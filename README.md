# code.tk.sg

This private repository contains Tinkercademy's deployment of [Haste](https://github.com/seejohnrun/haste-server), a simple pastebin for sharing code and text at the public [code.tk.sg](https://code.tk.sg) service. Paste data is stored in Redis and expires after one year of inactivity.

## How it runs

- `haste` is the Node.js application, built and run from the `Dockerfile`.
- `redis` uses Redis 7 (Alpine) in `docker-compose.yml`, with its data in the `redis-data` volume.
- `config.production.js` selects Redis database 2 and a 31536000-second expiry. `deploy.sh` copies it to `config.js`, then builds and restarts the Compose stack.
- The application listens on port 7777 inside the Docker network. The host's reverse proxy provides the public `code.tk.sg` endpoint.

## Deployment

The deployment host is `dev.tk.sg`, at `Docker/code.tk.sg`. From the repository, `./deploy.sh` pulls the latest revision, copies the Compose and production configuration files, and rebuilds the containers. Use `./deploy.sh --no-pull` when the server already has the desired revision; `./deploy.sh --logs` follows the resulting Compose logs.

Keep `config.js` local and private. It is ignored by Git; use `config.production.js` as the tracked production template.

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

Haste was created by John Crepezzi and continued by zneix. This deployment retains the upstream open-source licence and notices. See [`about.md`](about.md) for the service disclaimer and attribution details.
