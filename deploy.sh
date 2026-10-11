#!/bin/bash
set -euo pipefail

# Deploy script for code.tk.sg (Rust server)
# Usage: ./deploy.sh [--no-pull] [--logs]
#
# The image is built and tested HERE (the agent's own environment: an Amp orb,
# a Devin VM, or a workstation), then streamed to the server with `docker load`.
# Never build on dev.tk.sg: the Rust release build can exhaust the shared host's
# memory and take every site on it down (2026-10-10 outage).

REMOTE_HOST="tinkertanker@dev.tk.sg"
REMOTE_DIR="Docker/code.tk.sg"

PULL=true
SHOW_LOGS=false

for arg in "$@"; do
  case $arg in
    --no-pull)
      PULL=false
      ;;
    --logs)
      SHOW_LOGS=true
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: ./deploy.sh [--no-pull] [--logs]"
      exit 1
      ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo 'A local Docker daemon is required; the image is built here, not on the server.' >&2
  echo 'In an Amp orb: sudo dockerd >/tmp/dockerd.log 2>&1 &  (then retry)' >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo 'Refusing to deploy a dirty checkout; commit or stash tracked changes first.' >&2
  exit 1
fi

REVISION="$(git rev-parse --short=12 HEAD)"
IMAGE="code-tk:$REVISION"

echo "==> Deploying code.tk.sg $REVISION to $REMOTE_HOST..."

# Build from a pristine export of HEAD so the image matches $REVISION exactly.
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
git archive HEAD | tar -x -C "$BUILD_DIR"

echo "==> Building and testing locally (not on the server)..."
docker build --platform linux/amd64 --target test "$BUILD_DIR"
docker build --platform linux/amd64 --target runner -t "$IMAGE" "$BUILD_DIR"

echo "==> Streaming $IMAGE to the server..."
docker save "$IMAGE" | gzip -1 | ssh "$REMOTE_HOST" 'gunzip | docker load'

# Pull latest changes (Compose file, docs); the server never builds from them.
if [ "$PULL" = true ]; then
  echo "==> Pulling latest changes on server..."
  # scp below overwrites the tracked Compose file; reset it so the pull fast-forwards.
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && git checkout -- docker-compose.yml && git pull --ff-only"
fi

echo "==> Copying docker-compose.yml to server..."
scp docker-compose.yml "$REMOTE_HOST:$REMOTE_DIR/"

# Preserve the operator's Redis database, credentials, and expiration policy.
echo "==> Copying production configuration template..."
scp config.production.json "$REMOTE_HOST:$REMOTE_DIR/"
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && if [ ! -f config.json ]; then
  if [ -f config.js ]; then
    echo 'Convert existing config.js to config.json first; see docs/operations.md.' >&2
    exit 1
  fi
  umask 077
  cp config.production.json config.json
fi"

# Keep the running image as code-tk:previous for rollback, then point
# code-tk:current (used by docker-compose.yml) at the new revision. Re-deploying
# the same image leaves code-tk:previous untouched.
echo "==> Tagging $IMAGE as code-tk:current..."
ssh "$REMOTE_HOST" "if docker image inspect code-tk:current >/dev/null 2>&1 &&
  [ \"\$(docker image inspect -f '{{.Id}}' code-tk:current)\" != \"\$(docker image inspect -f '{{.Id}}' $IMAGE)\" ]; then
  docker tag code-tk:current code-tk:previous
elif ! docker image inspect code-tk:current >/dev/null 2>&1 && docker image inspect codetksg-haste:latest >/dev/null 2>&1; then
  docker tag codetksg-haste:latest code-tk:previous  # first deploy: Compose-built image
fi
docker tag $IMAGE code-tk:current"

# Point code-tk:current back at code-tk:previous, or drop it on a first deploy.
revert_tag() {
  ssh "$REMOTE_HOST" "if docker image inspect code-tk:previous >/dev/null 2>&1; then
    docker tag code-tk:previous code-tk:current
  else
    docker rmi code-tk:current >/dev/null
  fi" || true
}

# Disable proxy discovery for this disposable preflight container.
echo "==> Checking runtime access to private configuration..."
if ! ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose config --quiet && docker compose run --rm --no-deps -e VIRTUAL_HOST= --entrypoint sh haste -c 'test -r /app/config.json'"; then
  echo 'Runtime configuration preflight failed. Ensure UID 1001 can read config.json; see docs/operations.md. The running service has not been replaced.' >&2
  revert_tag
  exit 1
fi
echo "==> Updating containers and waiting for health checks..."
if ! ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose up -d --no-build --wait --wait-timeout 120"; then
  echo "New container failed its health check; rolling back to code-tk:previous..." >&2
  if ssh "$REMOTE_HOST" "docker image inspect code-tk:previous >/dev/null 2>&1"; then
    revert_tag
    ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose up -d --no-build --wait --wait-timeout 120 haste" || true
  else
    echo 'No code-tk:previous to roll back to; see docs/operations.md.' >&2
  fi
  exit 1
fi

# Drop older per-revision tags; code-tk:current and code-tk:previous remain.
ssh "$REMOTE_HOST" "docker images code-tk --format '{{.Repository}}:{{.Tag}}' | grep -vE ':(current|previous|pre-rust)\$' | xargs -r docker rmi >/dev/null" || true
echo "==> Containers healthy. Verify an existing paste and the public endpoint before declaring the rollout complete."

# Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
  echo "==> Showing logs (Ctrl+C to exit)..."
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose logs -f"
fi
