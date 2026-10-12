#!/usr/bin/env bash
set -euo pipefail

# Post-deploy check: home page, save, raw, document API and a preview image.
# Creates one small paste on the target (pastes can't be deleted; it expires).
base="${1:?Usage: scripts/smoke-test.sh https://code.tk.sg}"
fail() { echo "Smoke test failed: $*" >&2; exit 1; }

for attempt in 1 2 3 4 5; do
  curl -sf -o /dev/null "$base/" && break
  [ "$attempt" = 5 ] && fail "home page"
  sleep 5
done
text="deploy smoke test $(date -u +%Y-%m-%dT%H:%M:%SZ)"
key=$(curl -sf -X POST --data-binary "$text" "$base/documents" | sed -n 's/.*"key":"\([a-z]*\)".*/\1/p')
[ -n "$key" ] || fail "save"
[ "$(curl -sf "$base/raw/$key")" = "$text" ] || fail "raw"
curl -sf "$base/documents/$key" | grep -q '"key":"'"$key"'"' || fail "document API"
[ "$(curl -sf -o /dev/null -w '%{content_type}' "$base/preview/$key.png")" = image/png ] || fail "preview"
echo "Smoke test passed for $base ($key)"
