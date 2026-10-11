# Agent notes

## Deploying

- **Never build on the production host (`dev.tk.sg`).** It is shared with other
  sites, and the Rust release build exhausted its memory and took the host down
  on 2026-10-10. Do not run `docker build`, `docker compose build`, or `cargo`
  there.
- Build in your own environment and run `./deploy.sh` from there. It builds and
  tests the image locally, streams it to the server with `docker load`, and only
  restarts the container on the host.
  - **Amp:** use your orb. Prefer `a1.medium` or larger (the build needs several
    GB of RAM). Start Docker first if needed: `sudo dockerd >/tmp/dockerd.log 2>&1 &`.
  - **Devin:** use your Devin VM.
- SSH access comes from the `DEPLOY_SSH_PRIVATE_KEY_B64` secret (base64 private
  key for `tinkertanker@dev.tk.sg`). Never print it.
- Deploying requires explicit user approval. See `docs/operations.md` for
  rollback (`code-tk:previous`) and post-deploy checks.
