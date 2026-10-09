# Storage

The Rust server supports the deployment's **Redis** backend and the local **file**
backend. It reads and writes the same formats as Haste; existing keys and URLs
need no migration. The old upstream MongoDB, Postgres, S3, Memcached, and RethinkDB
adapters are not supported by this replacement. Configuring them fails at startup
instead of falling back to an empty store.

Configure the `storage` object in `config.json`.

## File

```json
{ "type": "file", "path": "./data" }
```

Each filename is the lowercase MD5 digest of the UTF-8 paste key. The file contains
the UTF-8 text, with no JSON envelope. Reuse the existing directory and ensure the
server user can read/write it. New writes are published atomically and cannot
overwrite an existing key. File storage does not expire documents, even when
`expire` is configured.

## Redis

```json
{
  "type": "redis",
  "expire": 31536000,
  "redisOptions": { "host": "redis", "port": 6379, "db": 2 }
}
```

Paste keys are unprefixed Redis string keys. Reuse the original database and
Docker volume. New pastes receive the configured TTL (seconds); `/documents/:id`
and `/raw/:id` reads renew it. Paste HTML, preview images, and collision checks
do not extend TTLs. Static documents in `documents` are loaded without expiration
and their reads never renew TTLs. Set `expire` to `0` or `false` to disable expiry.

`redisOptions` accepts `host`, `port`, `db`, and optional `username`/`password`.
Other ioredis-specific options are deliberately rejected; review them before
converting a custom configuration. Redis TLS/cluster/sentinel are not implemented.

Production uses database **2**, with a one-year sliding expiry. Do not run the
replacement under another Compose project name: that would create a different
`redis-data` volume. See [operations](operations.md) for backups and rollback.
