# code.tk.sg

Tinkercademy's deployment of **Haste**, a simple pastebin for sharing code and
text. Try it at [code.tk.sg](https://code.tk.sg).

This repository is based on [zneix/haste-server](https://github.com/zneix/haste-server)
v0.2.5. It adds the code.tk.sg branding, production configuration, Docker
packaging, deployment scripts, and backups.

## Run locally

Requires Node.js 20.

```sh
npm ci
[ -f config.js ] || cp example.config.js config.js
npm run build
npm start
```

The example configuration stores pastes in local files. Edit `config.js` to use a
different [storage backend](docs/storage.md).

With Redis running on `localhost:6379`, run the test suite with `npm test`.

## Documentation

- [Installation](docs/install.md)
- [Storage backends](docs/storage.md)
- [Key generators](docs/generators.md)
- [Supported languages](docs/languages.md)
- [Service information and policies](about.md)
- [Maintainer operations](docs/operations.md)

## Deployment

The production stack is defined in `docker-compose.yml` and
`config.production.js`. Keep `config.js` private; it is intentionally ignored by
Git. See [maintainer operations](docs/operations.md) for deployment, security,
backup, and restore procedures.

## Licence and credits

Haste was created by John Crepezzi and continued by zneix and other contributors.
The project is MIT-licensed; see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Tinkercademy's name and logo do
not imply affiliation or endorsement of other deployments.
