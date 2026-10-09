# Maintainer operations

This runbook covers the code.tk.sg deployment. It is not required to run the server
locally.

## Architecture

- `haste` is the Rust application built from the `Dockerfile`, running as UID 1001.
- `redis` runs Redis 7 Alpine with data in the `redis-data` Docker volume.
- `config.production.json` selects Redis database 2 and expires pastes after one
  year of inactivity.
- The application listens on port 7777 inside the Docker network. The host's
  reverse proxy provides the public endpoint (`VIRTUAL_HOST=code.tk.sg`,
  `VIRTUAL_PORT=7777`, `CERT_NAME=tk.sg`). No host port is published.
- The external `devtksg` network and proxy/certificates are managed separately by
  [sysops-devtksg-dockerinfra](https://github.com/tinkertanker/sysops-devtksg-dockerinfra).

## First Rust cutover (operator approval required)

There is **no paste-data migration**. Do not rename the Compose project, Redis
service, volume, or database. Do not use `docker compose down -v`.

Before updating the checkout/Compose file on the host:

1. Take and validate a Redis backup using the procedures below.
2. Record `docker compose ls`, `docker compose ps`, and the Redis volume name.
   Tag the current application image `code-tk:pre-rust` and save the old Compose
   file and `config.js` privately for rollback.
3. Convert the live JS config while the old Node container is still running.
   From `Docker/code.tk.sg`, use a private temporary output and only publish it
   after the command succeeds:

   ```sh
   umask 077
   docker compose exec -T haste node -e \
     'process.stdout.write(JSON.stringify(require("./config"), null, 2) + "\n")' > config.json.tmp && \
     test ! -e config.json && mv config.json.tmp config.json
   ```

4. Review the JSON, especially database **2**, expiry, static documents, and any
   custom credentials/options. Rust supports file/Redis storage and common Redis
   connection settings; unsupported settings fail startup. Ensure UID 1001 can
   read the file. On the deployment host, set restrictive ownership/permissions:

   ```sh
   sudo chown 1001:1001 config.json
   sudo chmod 0600 config.json
   ```

   The converter creates a private 0600 file owned by its invoking user, which
   may not be UID 1001. Do not make configuration world-readable to work around
   this. The deploy script checks access as the actual container user before
   replacing the running service; it does not change existing file permissions.
5. Build the test target and runtime **before** replacing the running container.
   Keep Redis running; use `docker compose up -d --wait` in the same deployment
   directory with the original project identity.
6. Verify a known old paste via `/documents/key`, `/raw/key`, `/key.py`, and
   `/preview/key.py.png`, then save/reload a new Unicode paste. Verify TLS through
   the public proxy and compare Redis counts/TTLs. A TCP health check confirms
   the process is listening, not that the public proxy/storage works.

Rollback: restore the privately saved old Compose/config files and pin `haste`
to the tagged `code-tk:pre-rust` image (remove `build` in that rollback file).
Recreate only `haste`, without building or stopping Redis. Pastes created by Rust
remain readable by Node because the formats are unchanged. Do not restore an old
RDB merely to roll back code; doing so would lose pastes created since the backup.

## Deployment

Production runs on `dev.tk.sg` in `Docker/code.tk.sg`. From a local checkout, run:

```sh
./deploy.sh
```

The script pulls with `--ff-only`, copies Compose and the production template,
tests/builds and checks configuration readability before recreation, and waits
for health checks. The disposable preflight container disables proxy discovery
and does not start Redis. The script preserves an
existing `config.json` and refuses an unconverted legacy config. Pass
`--no-pull` when the server already has the intended revision or `--logs` to
follow the resulting Compose logs.

Keep `config.json` local and private. It is ignored by Git; use
`config.production.json` as the tracked template for a **new** production install.

### Jenkins

Create a Pipeline-from-SCM job pointing at this repository's `Jenkinsfile`.
The existing Jenkins host mounts the Docker socket; its agent needs Docker CLI
access. The pipeline builds the Docker `test` target (Rust lint/HTTP compatibility
and frontend tests), then a runtime image tagged with the Git revision. It never
pushes or deploys. Do not run Compose from a Jenkins workspace: doing so can
create a new empty Redis volume. An authorized rollout runs from the existing
`Docker/code.tk.sg` directory instead.

## Security maintenance

`maxLength` limits UTF-8 bytes rather than JavaScript characters. Raw uploads are
rejected as soon as they exceed it. Multipart uploads accept one `data` field and
no files. The whole multipart body is capped at `maxLength` plus 16 KiB for the
envelope, including any preamble; fields and decoded text still obey `maxLength`.
Malformed forms return 400, and oversized bodies/fields return 413 without saving
a paste. UTF-8, Latin-1/ASCII, UTF-16LE, and base64 field encodings retain
the legacy parser's decoding. Other charsets return 400 instead of crashing the
server as they did in Haste. Do not use `maxLength: 0` on a public deployment. Configure
reverse-proxy body-size and timeout limits as additional protection.

The Rust server does not parse query parameters. Request rate limits retain the
old socket-IP policy: forwarded IP headers are not trusted. Behind nginx-proxy,
clients therefore share the proxy's bucket, just as with the previous Express
configuration. Changing that policy requires a separate trusted-proxy decision.
Preview rendering uses two dedicated threads, each retaining at most one QuickJS
context, rather than Tokio's shared file-I/O pool. It has bounded concurrency and a
200-entry PNG cache; excess simultaneous renders return 503. Paste writes are
atomic insert-only; exhausted keyspaces return 503 instead of hanging/overwriting.

Build tools are excluded from the runtime image. On a fresh checkout, run
`npm ci && npm run build` before direct Rust builds or checks: the build generates
the ignored `lib/preview-highlight.js` embedded by Rust. Rust builds use the
committed Cargo lockfile. Run `npm audit` and
Rust dependency advisory checks when updating dependencies. The vendored highlighter and
CDN jQuery require separate advisory checks. Rebuild the highlighter with
`scripts/build-highlight.sh`, which downloads the official highlight.js CDN
assets with npm; edit its language list to add or remove languages.

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

`.agents/setup` installs Node 20.20.0, Rust 1.94, a C compiler, Redis, and the locked
dependencies, then builds the browser assets and Rust binary. It converts a
trusted existing `config.js` only if `config.json` is absent; otherwise it preserves
the JSON or copies the file-storage example. No production credentials or Docker daemon
are required.

Run `amp orb services ensure` to start the application and an isolated,
non-persistent Redis instance. The command prints a reviewable portal URL. Run
`npm test` for frontend tests and `python3 tests/compatibility.py` for isolated
HTTP/storage checks. Outside the setup script, first run `npm ci && npm run build`
to generate the embedded highlighter before any direct Rust checks. Run
`cargo fmt -- --check` and
`cargo clippy --locked --all-targets -- -D warnings` for Rust checks.
