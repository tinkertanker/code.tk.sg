# Installation

Requires Rust 1.94 (pinned in `rust-toolchain.toml`), a C compiler for embedded
QuickJS, and Node.js 20 for building browser assets and the syntax engine.
Node is not required by the resulting server or runtime Docker image.

```sh
npm ci
npm run build
cp example.config.json config.json # only for a new installation
cargo run --locked
```

If upgrading a trusted existing JavaScript configuration, convert it instead of
copying the example:

```sh
node scripts/convert-config.js config.js config.json
```

The converter refuses to overwrite an existing JSON file. Keep configurations
private. Rust refuses unknown settings and unsupported storage adapters rather
than silently changing where pastes are stored. Relative paths are resolved from
the working directory; launch the binary from the repository or packaged `/app`.

`HOST`, `PORT`, and `CONFIG` override the bind address, port, and configuration
filename. `RUST_LOG` overrides logging verbosity. `baseUrl` sets the public origin
for link previews (production uses `https://code.tk.sg`).

For a standalone release, run `cargo build --release --locked`, then package
`target/release/code-tk`, the built `static/` directory, the configured static
documents, and your JSON configuration. The font, logo, and complete highlight.js
syntax registry are embedded in the executable.

Docker and dev.tk.sg instructions are in [maintainer operations](operations.md).
