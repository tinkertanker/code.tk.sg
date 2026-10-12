# code.tk.sg

Tinkercademy's pastebin for sharing code and text. Try it at
[code.tk.sg](https://code.tk.sg).

It runs as a **Cloudflare Worker** (`worker/`, TypeScript) with pastes in
Cloudflare D1. The browser UI in `static/` originated from
[zneix/haste-server](https://github.com/zneix/haste-server) v0.2.5 and keeps
Haste's paste URLs, raw/document APIs and multipart uploads. Link previews are
rendered in the Worker with highlight.js and resvg (WebAssembly).

## Run locally

Requires Node.js 22+. No Cloudflare account is needed for local development.

```sh
npm ci && npm run build          # frontend assets (static/application.min.js)
cd worker && npm ci
npm run db:init                  # local D1 schema
npm run dev                      # http://localhost:8787
```

## Tests

```sh
npm test                         # frontend: language detection, indentation fixer
npm --prefix worker run typecheck
npm --prefix worker test         # Worker: HTTP contracts, storage, previews
```

`tests/compatibility.py` checks the HTTP contract over real HTTP against
`wrangler dev`; see [worker/README.md](worker/README.md). CI runs all of these.

## Documentation

- [Maintainer operations](docs/operations.md): deploy, rollback, backups
- [Supported languages](docs/languages.md)
- [Service information and policies](about.md)
- [Cloudflare migration](docs/cloudflare-migration.md) (2026-10-12)
- [Worker internals](worker/README.md)

## Licence and credits

Haste was created by John Crepezzi and continued by zneix and other contributors.
The project is MIT-licensed; see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Tinkercademy's name and logo do
not imply affiliation or endorsement of other deployments.
