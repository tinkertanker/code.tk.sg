# Preview renderer: local verification and core merge points

The production module exports the two pinned functions in `src/preview.ts`.
It imports the existing logo and DejaVu Sans Mono font, the full highlight.js
11.12.0 language registry, and resvg's compiled WASM module. It has no storage,
network, cache, or expiry side effects. `host` is intentionally not used in the
image: Rust hardcodes `code.tk.sg/` there. Metadata uses the URLs supplied by
the caller, with Rust-compatible escaping.

## Core merge points

- Merge the dependencies and `test:preview` script from `worker/package.json`
  into the core package, then regenerate its lockfile. This is not a replacement
  for the core package or its scripts.
- Add the `Data` rules for `**/*.ttf` and `**/*.png` from
  `test/preview.wrangler.jsonc` to the production Wrangler config. Wrangler
  already recognizes the WASM import. Keep the test entry separate from the
  production router; this PR does not add a production `wrangler.jsonc`.
- Preview tests use a separate Node Vitest config that loads the same binary
  inputs as the Worker. This scaffold uses Vitest 5.0.3. If the core Workers
  pool requires another Vitest version, reconcile that dependency and rerun
  both suites; do not fold this config into the Workers pool unchanged.
- The router owns HTTP status/cache headers, `HEAD`, URL construction, and
  non-renewing preview reads. Preview responses must use `image/png` and
  `public, max-age=86400`; paste pages use `public, max-age=300`. Only document
  and raw reads renew expiry. The tests here cover the metadata and PNG portions
  of `test_preview_metadata_and_png`, not these router/storage contracts.

## Commands

Run from `worker/` (no Cloudflare credentials or deployment):

```sh
npm ci
npm run test:preview
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler \
  --lib ES2022,DOM src/preview.ts src/preview-assets.d.ts test/preview.worker.ts
npx wrangler deploy --dry-run --config test/preview.wrangler.jsonc \
  --outdir /tmp/code-tk-preview-bundle
npx wrangler dev --local --config test/preview.wrangler.jsonc
```

The local-only test entry accepts POSTed JSON `{key, ext?, data}` and returns
the PNG. POST `/meta` with `{key, data, url, imageUrl}` returns injected HTML.

## Evidence (2026-10-12, Linux x64 orb)

- `cargo build --locked` built the unchanged Rust server, which ran locally
  alongside Wrangler/workerd. Four pastes were uploaded to Rust and rendered
  through both implementations with identical keys/extensions/content.
- All four decoded RGBA images had **zero differing pixels** (1200×900).
  All 13 OpenGraph/Twitter tags matched Rust byte-for-byte for each paste.
  Comparison images were inspected for logo, layout, colours, tab/CRLF handling,
  Unicode, clipping, nested scopes, and fade. Missing emoji/CJK font glyphs and
  the surprising `arcade` auto-detection are intentional parity with Rust.
- Vitest: **13 tests pass**; TypeScript checking passes; `npm audit` reports
  no vulnerabilities in this scaffold.
- Wrangler dry-run, including WASM/font/logo/all languages:
  **4551.28 KiB uncompressed / 1564.99 KiB gzip** (~4.44 / 1.53 MiB).
  This is below the current [64 MiB uncompressed Worker limit](https://developers.cloudflare.com/workers/platform/limits/#worker-size),
  and also below the older Workers Paid 10 MiB compressed limit.
  The integrated core bundle must be measured again after merging.

Every benchmark paste was 320,000 bytes. Warm values are the average of
10 serial requests after one warm-up, measured using Linux `/proc` user+system
CPU ticks for both local workerd processes. They include local HTTP handling,
exclude the client/Wrangler CPU, and are **not deployed Cloudflare CPU metrics**.
Wall time is measured independently at the client.

| Paste | Warm mean CPU | Median wall | Max wall |
| --- | ---: | ---: | ---: |
| Python, many short lines (`py`) | 127 ms | 101.1 ms | 149.1 ms |
| JavaScript, many short lines (auto) | 148 ms | 130.0 ms | 176.0 ms |
| Single long line (auto) | 109 ms | 92.3 ms | 114.1 ms |
| Single long line (`txt`) | 85 ms | 83.9 ms | 91.6 ms |
| 13 maximal 2000-unit visible lines (auto) | 912 ms | 908.4 ms | 1120.5 ms |

A first Python request after restarting Wrangler used **520 ms CPU / 286.7 ms
wall**, including lazy initialization/JIT work. These measurements fit comfortably
within Paid's default 30-second CPU budget, not Free's 10 ms. Highlighting is
bounded to 13 lines × 2000 UTF-16 units before any grammar runs, matching Rust;
auto-detection still costs more than an explicit language. These are representative
and stress fixtures, not a guarantee against every adversarial highlight.js input.

### Before / after (Rust left, Worker right)

![Python](https://ampcode.com/user-content/artifacts/4a3b7ca12f2cbcb5ee9eb6714cccf8126b97e93ebc4a5eab819d5415ef0a40e5-file.png)
![Plain text and Unicode](https://ampcode.com/user-content/artifacts/0ae8e0b5e789179b8c2d1751a3f8cf0be70ea5e6ad27a68dcf7d3baad6753fb6-file.png)
![Auto-detection](https://ampcode.com/user-content/artifacts/a4b0707dc3999beaa6f6ee837f81ef9ecd0a83909e3d3de5c4363ff34ae9971e-file.png)
![Ruby astral tokens](https://ampcode.com/user-content/artifacts/1c289296d6e2086e8a3b40e3aefa5438c3b3c862bac4373c15437b01e9aef68d-file.png)
