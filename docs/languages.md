# Supported languages

This guide is maintained by Tinkercademy for this fork. It replaces the inherited
zneix/haste-server language table after the browser-library security update.

The browser bundle contains highlight.js 11.12.0's 36 common languages, 14
languages retained for compatibility with this Haste deployment, and 15 more
modern languages and tools (Dart, Dockerfile, Elixir and others). Rebuild it
with `scripts/build-highlight.sh`.

To force a language instead of automatic detection, append either its name or
the short extension below to a paste URL (for example, `/paste-key.rs`). Use
`.txt` to disable highlighting.

## Automatic detection

`static/language-detect.js` chooses a language when a paste is saved (the
extension in the table is then added to the URL) and when a URL without an
extension is opened. It:

- only considers languages people commonly paste, so niche grammars cannot
  claim short snippets; some (Dart, Dockerfile, Arduino and others) are only
  considered when syntax distinctive to them appears;
- adds points for syntax distinctive to one language, such as Swift's
  `\(name)` interpolation and `if let`, Python's `def ...:` blocks and
  TypeScript type annotations;
- looks at the first 10,000 characters only, so large pastes stay fast;
- leaves text that scores too low, such as prose, as plain text.

Languages marked "Explicit only" below are highlighted only when chosen by URL
extension.

The samples in `test/fixtures/language_samples.js` must all be detected
correctly; add a sample there when you fix a misdetection. If you change
`language-detect.js`, bump its `?v=` value in `static/index.html`.

## Languages

| Language | Extension | Detection |
|----------|-----------|-----------|
| Apache config | `apache` | Explicit only |
| Arduino | `ino` | Automatic |
| Bash | `bash` or `sh` | Automatic |
| C | `c` | Automatic |
| C# | `cs` | Automatic |
| C++ | `cpp` | Automatic |
| Clojure | `clj` | Explicit only |
| CMake | `cmake` | Explicit only |
| CoffeeScript | `coffee` | Explicit only |
| CSS | `css` | Automatic |
| Dart | `dart` | Automatic |
| Delphi | `dpr` | Explicit only |
| Diff | `diff` | Automatic |
| Dockerfile | `dockerfile` | Automatic |
| Elixir | `ex` | Automatic |
| Erlang | `erl` | Explicit only |
| F# | `fs` | Explicit only |
| GLSL | `glsl` | Explicit only |
| Go | `go` | Automatic |
| Gradle | `gradle` | Explicit only |
| GraphQL | `graphql` | Explicit only |
| Groovy | `groovy` | Explicit only |
| Haskell | `hs` | Explicit only |
| HTTP | `http` | Explicit only |
| INI/TOML | `ini` | Automatic |
| Java | `java` | Automatic |
| Java properties | `properties` | Explicit only |
| JavaScript | `js` | Automatic |
| JSON | `json` | Automatic |
| Julia | `jl` | Explicit only |
| Kotlin | `kt` | Automatic |
| LaTeX | `tex` | Automatic |
| Less | `less` | Explicit only |
| Lisp | `lsp` | Explicit only |
| Lua | `lua` | Automatic |
| Makefile | `mk` | Automatic |
| Markdown | `md` | Automatic |
| Nginx config | `nginx` | Explicit only |
| Nix | `nix` | Explicit only |
| Objective-C | `m` | Automatic |
| OCaml | `ml` | Explicit only |
| Perl | `pl` | Automatic |
| PHP | `php` | Automatic |
| PHP template | `phptemp` | Explicit only |
| Plain text | `txt` | Fallback |
| PowerShell | `ps1` | Automatic |
| Protocol Buffers | `proto` | Explicit only |
| Python | `py` | Automatic |
| Python REPL | `pyrepl` | Explicit only |
| R | `r` | Automatic |
| Ruby | `rb` | Automatic |
| Rust | `rs` | Automatic |
| Scala | `sc` | Explicit only |
| SCSS | `scss` | Explicit only |
| Shell session | `shell` | Automatic |
| Smalltalk | `sm` | Explicit only |
| SQL | `sql` | Automatic |
| Swift | `swift` | Automatic |
| TypeScript | `ts` | Automatic |
| Vala | `vala` | Explicit only |
| VB.NET | `vbnet` | Explicit only |
| VBScript | `vbs` | Explicit only |
| WebAssembly | `wasm` | Explicit only |
| XML/HTML | `xml` | Automatic |
| YAML | `yaml` | Automatic |

The full language name also works. Some highlight.js aliases, such as `html`,
`toml`, `shellsession`, `tsx`, `jsx` and `yml`, are accepted in addition to this
table.
