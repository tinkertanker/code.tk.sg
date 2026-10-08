#!/usr/bin/env bash
set -euo pipefail

# Rebuild static/highlight.min.js from the official highlight.js CDN assets:
# the common build followed by extra language modules from the same release.
# To add a language, append its highlight.js name to EXTRA_LANGUAGES, rerun,
# update docs/languages.md and haste.extensionMap in static/application.js,
# and bump the ?v= cache-busting values in static/index.html.
VERSION=11.12.0
EXTRA_LANGUAGES=(
	# Retained from the original Haste deployment
	apache coffeescript delphi erlang haskell http latex lisp nginx properties
	scala smalltalk vala vbscript
	# Modern languages and tooling
	arduino clojure cmake dart dockerfile elixir fsharp glsl gradle groovy julia
	nix ocaml powershell protobuf
)

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

(cd "$work" && npm pack --silent "@highlightjs/cdn-assets@$VERSION" >/dev/null && tar xzf ./*.tgz)
assets="$work/package"

{
	cat "$assets/highlight.min.js"
	for language in "${EXTRA_LANGUAGES[@]}"; do
		cat "$assets/languages/$language.min.js"
	done
} > "$work/highlight.min.js"
mv "$work/highlight.min.js" "$root/static/highlight.min.js"

echo "Wrote static/highlight.min.js (highlight.js $VERSION, ${#EXTRA_LANGUAGES[@]} extra languages)"
