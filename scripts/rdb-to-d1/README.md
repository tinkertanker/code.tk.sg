# Redis db 2 → D1

Requires Python 3.9+ and Docker on Linux (Unix socket bind mounts). No Python
packages or Cloudflare credentials are needed for conversion. Run from the
repository root. The tool never connects to the source Redis or a remote D1.

```sh
docker pull redis:8.4-alpine
umask 077
PRIVATE=$(mktemp -d /tmp/code-tk-cutover.XXXXXX)
# Put the fresh RDB at "$PRIVATE/dump.rdb" using your approved backup transfer.
# Use the snapshot's Redis LASTSAVE / RDB ctime, NOT the transfer/import time.
DUMP_TIME=2026-10-12T04:05:23Z  # example only; replace for the fresh cutover dump
python3 scripts/rdb-to-d1/migrate.py "$PRIVATE/dump.rdb" \
  --dump-time "$DUMP_TIME" --output "$PRIVATE/sql"
```

The example timestamp is the supplied 2026-10-12 dump's embedded `ctime`.
`--dump-time` also accepts Unix seconds. `--output` must not exist; its parent
must exist. SQL is published only after successful conversion, with private
directory/file permissions. The JSON summary contains counts and sizes only,
never paste identifiers or contents. Keep the RDB, SQL, local databases and
Wrangler logs **outside the checkout**, and delete them after verification.

## Encoding, expiry and limits

- Only db **2** is scanned; db 0 is not queried or exported. Non-string Redis
  values and invalid UTF-8 fail the conversion rather than silently lose data.
- The supplied RDB uses format 12: Redis 7 cannot load it. Redis **8.4+** also
  supplies the debug flag needed to read expired snapshot keys. The throwaway
  container has no network, no TCP listener, and no persistence. It is removed
  along with its copied dump on success or failure.
- Load in replica mode with expired-key access enabled. Derive the TTL at the
  supplied snapshot time from `PEXPIRETIME`: `(expiry_ms - dump_time_ms + 500)
  // 1000`, matching Redis `TTL` rounding. Store `dump_time + ttl`, or `NULL`
  for no expiry. Keys already expired **at the snapshot time** are counted and
  skipped; keys that expired **after** it are retained with their original
  expiry. Importing later does not extend their lives.
- Keys and values are hex literals cast to TEXT: quotes, backslashes, newlines,
  Unicode and NULs cannot alter the SQL. Large values use ordered 40,000-byte
  BLOB chunks in `_rdb_to_d1_chunks`, then one TEXT cast. The helper table is
  dropped at the end of each file. Every statement is at most 100,000 bytes,
  the [D1 limit](https://developers.cloudflare.com/d1/platform/limits/).
- Files default to at most 4,000,000 bytes (`--max-file-bytes` changes this).
  A whole document stays in one file; too small a limit fails without publishing
  partial output. Import files **sequentially**, in filename order, and do not
  run simultaneous migrations against the same D1 database.
- All document writes are `INSERT OR IGNORE`. Replaying files never overwrites
  an existing document or its renewed TTL. Consequently, a fresh cutover dump
  needs a **clean target**, not a database still containing stale staging rows.

## Local rehearsal (no credentials/resources)

Once the Worker branch is integrated, use its schema and binding:

```sh
export WRANGLER_SEND_METRICS=false
cd worker
npx wrangler d1 execute DB --local --persist-to "$PRIVATE/d1" \
  --file migrations/0001_init.sql
for file in "$PRIVATE"/sql/*.sql; do
  npx wrangler d1 execute DB --local --persist-to "$PRIVATE/d1" --file "$file" || exit 1
done
npx wrangler d1 execute DB --local --persist-to "$PRIVATE/d1" --command \
  'SELECT COUNT(*) AS rows, SUM(expires_at IS NULL) AS without_ttl, MAX(LENGTH(CAST(data AS BLOB))) AS largest_bytes FROM documents'
cd ..
```

For the supplied dump, expect **1,845 rows**, **2 NULL expiries**, and
**319,793 bytes** as the largest value. Compare source/destination bytes and
expiries, including the largest and non-ASCII pastes; counts alone are not proof.

## Cutover commands (owner only, after deployment/import approval)

Stop source writes **and document reads that renew TTLs**, take a fresh completed
RDB snapshot, record its `LASTSAVE`, transfer it privately, and run the converter
above with that timestamp. Check the target is clean and the Worker config points
to the approved target/environment before running these commands. These commands
are documentation only; phase 3 does not execute them.

```sh
cd worker
npx wrangler d1 execute DB --remote --file migrations/0001_init.sql
for file in "$PRIVATE"/sql/*.sql; do
  npx wrangler d1 execute DB --remote --file "$file" || exit 1
done
npx wrangler d1 execute DB --remote --command \
  'SELECT COUNT(*) AS rows, SUM(expires_at IS NULL) AS without_ttl, MAX(LENGTH(CAST(data AS BLOB))) AS largest_bytes FROM documents'
cd ..
# After byte/expiry verification and route cutover, remove every private copy:
rm -rf -- "$PRIVATE"
```

If imports stop midway, rerun the ordered files; don't edit paste SQL by hand.
Use the fresh dump's summary, not the rehearsal counts, at cutover.

## Regression verification

```sh
python3 -m unittest discover -s scripts/rdb-to-d1 -v
# Add actual local D1 imports/replay using an installed Wrangler executable:
WRANGLER_BIN="$PWD/worker/node_modules/.bin/wrangler" \
  python3 -m unittest discover -s scripts/rdb-to-d1 -v
```

The generated synthetic RDB covers db 0 isolation, historical expiry, both TTL
rounding directions, 400KB content, non-ASCII keys/values, NULs, SQL-looking text,
empty values, file/statement limits, atomic failure and insert-only replay. No
real paste fixture is committed.
