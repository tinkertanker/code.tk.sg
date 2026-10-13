# CI dependency downloads

`ci.yml` uses this action in both parallel test jobs and, after the credential
check succeeds, in deployment. Every run executes fresh root and worker
`npm ci`, even on an exact cache hit. Tests use normal lifecycle scripts;
deployment uses `install-mode: ignore-scripts` for **both** installs, with no
Cloudflare token passed to the action.

Only npm's content-addressed download directory (`_cacache`) is restored and
saved, not `node_modules`, npm configuration/credentials, or logs. Both installs
share the cache directory reported by `npm config get cache`. The exact key
includes install mode, runner OS/architecture/image family (`ImageOS`), actual
Node/npm versions, both manifests/lockfiles/npmrc files, and the action/workflow.
There are no `restore-keys`. A changed input starts a new cache; test and deploy
policies have distinct namespaces.

The standalone SHA-pinned restore/save actions save immediately after both
installs succeed, before builds/tests. Failed installs cannot save; a later
test failure does not discard a successful download cache. Exact hits are
immutable and are not saved again. Concurrent misses may race to save the same
key; the cache action's warning-only upload failures do not block tests. Use
native restore/install/save step logs and durations to assess hits and overhead.

GitHub's native cache ref scope applies: PR merge-ref caches are not promoted to
main or deployment. No artifacts transfer installed trees across trust levels.
Keep `pull_request`, read-only contents permission, credential-free checkout,
and step-scoped deploy tokens when editing the workflow.

Installed-tree caching with install skipping was deliberately rejected: the
paired archive measured about 115 MB compressed (108 MB worker, 7 MB root),
while recent CI installs took only 2–3 s root and 4–5 s worker. Download caching
keeps lifecycle execution and fresh-install correctness, not a proven hosted
speedup. In a Debian 12 x64 orb (2 vCPU, 3.8 GiB; Node 22.20.0/npm 10.9.3), paired
installs measured 7.82 s cold and 5.62/5.25 s warm. The download archive was
117.47 MiB, larger than the installed archive; local extraction took 0.32 s,
excluding network transfer. Upload/download overhead may erase the 2.2–2.6 s
local savings. No preparation job is justified for the current 20/34 s test jobs.

Because no installed outputs are cached, local lifecycle scripts/patches still
run normally; caching installed trees later would require auditing all lifecycle
inputs and outputs, especially anything written outside `node_modules`.
