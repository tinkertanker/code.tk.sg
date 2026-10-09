FROM node:20-alpine AS assets
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY static ./static
COPY lib/fonts ./lib/fonts
COPY scripts/build-preview-highlight.js ./scripts/build-preview-highlight.js
COPY test ./test
RUN npm run build && npm test

FROM rust:1.94.0-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY src ./src
COPY --from=assets /app/static ./static
COPY --from=assets /app/lib ./lib
RUN cargo build --release --locked
# Retain licence files for dependencies statically linked into the executable.
RUN mkdir /licenses && find /usr/local/cargo/registry/src -type f \
    \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' \) \
    -exec cp --parents '{}' /licenses/ \;

FROM builder AS test
RUN apt-get update && apt-get install -y --no-install-recommends python3 redis-server \
    && rm -rf /var/lib/apt/lists/*
COPY tests ./tests
COPY about.md ./about.md
RUN cargo fmt -- --check && cargo clippy --locked --all-targets -- -D warnings \
    && cargo test --locked \
    && SERVER_COMMAND=/app/target/release/code-tk python3 tests/compatibility.py

FROM debian:bookworm-slim AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 haste && \
    useradd --system --uid 1001 --gid haste haste
COPY --from=builder /app/target/release/code-tk /usr/local/bin/code-tk
COPY --from=builder /app/static ./static
COPY --from=builder /licenses /usr/share/doc/code-tk/dependencies
COPY about.md test.py LICENSE THIRD_PARTY_NOTICES.md example.config.json ./
RUN chown -R haste:haste /app
USER haste
ENV HOST=0.0.0.0 PORT=7777
EXPOSE 7777
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["code-tk", "--healthcheck"]
CMD ["code-tk"]
