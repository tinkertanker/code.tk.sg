# code.tk.sg

Tinkercademy's pastebin for sharing code and text, with a **Rust backend** and
the existing Haste browser UI. Try it at [code.tk.sg](https://code.tk.sg).

The frontend originated from [zneix/haste-server](https://github.com/zneix/haste-server)
v0.2.5. The replacement preserves paste URLs, raw/document APIs, multipart uploads,
link-preview metadata/PNGs, and existing Redis and MD5-named file storage. The
runtime needs no Node.js: syntax highlighting uses the same highlight.js engine
embedded in QuickJS, and Rust renders previews with resvg.

## Run locally

Requires Rust 1.94, a C compiler, and Node.js 20 for asset builds.

```sh
npm ci
npm run build
[ -f config.json ] || cp example.config.json config.json
cargo run --locked
```

The example stores pastes in local files. For an existing installation, convert
the trusted configuration with `node scripts/convert-config.js config.js config.json`
instead of copying the example. The converter never overwrites its output.
See [installation](docs/install.md) and [storage](docs/storage.md).

```sh
npm test                               # existing frontend language tests
cargo fmt -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo build --locked
python3 tests/compatibility.py           # real HTTP, isolated Redis + file storage
docker build --target test .            # same checks inside the build image
```

The Python tests require `redis-server` and `redis-cli`; they start an isolated
temporary instance and do not access production data.

## Documentation

- [Installation](docs/install.md)
- [Storage backends](docs/storage.md)
- [Key generators](docs/generators.md)
- [Supported languages](docs/languages.md)
- [Service information and policies](about.md)
- [Maintainer operations](docs/operations.md)

## Deployment

The production stack is defined in `docker-compose.yml` and
`config.production.json`, matching dev.tk.sg's external `devtksg` network and
nginx-proxy. The Redis service/volume and Compose project must stay unchanged.
`Jenkinsfile` builds and tests but deliberately does not deploy. Keep `config.json`
private; it is ignored by Git. See [maintainer operations](docs/operations.md) for
configuration migration, authorized deployment, backup, and rollback procedures.

## Licence and credits

Haste was created by John Crepezzi and continued by zneix and other contributors.
The project is MIT-licensed; see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Tinkercademy's name and logo do
not imply affiliation or endorsement of other deployments.
