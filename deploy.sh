#!/bin/bash
set -euo pipefail

# Deploy script for code.tk.sg (Rust server)
# Usage: ./deploy.sh [--no-pull] [--logs]

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

echo "==> Deploying code.tk.sg to $REMOTE_HOST..."

# Pull latest changes
if [ "$PULL" = true ]; then
  echo "==> Pulling latest changes on server..."
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && git pull --ff-only"
fi

# Copy docker-compose.yml if it exists locally
if [ -f docker-compose.yml ]; then
  echo "==> Copying docker-compose.yml to server..."
  scp docker-compose.yml "$REMOTE_HOST:$REMOTE_DIR/"
fi

# Preserve the operator's Redis database, credentials, and expiration policy.
echo "==> Copying production configuration template..."
scp config.production.json "$REMOTE_HOST:$REMOTE_DIR/"
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && if [ ! -f config.json ]; then
  if [ -f config.js ]; then
    echo 'Convert existing config.js to config.json first; see docs/operations.md.' >&2
    exit 1
  fi
  cp config.production.json config.json
fi"

# Build/test before replacing the running application; never stop Redis or delete volumes.
echo "==> Building and testing..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose config --quiet && docker build --target test . && docker compose build"
echo "==> Updating containers and waiting for health checks..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose up -d --wait --wait-timeout 120"
echo "==> Containers healthy. Verify an existing paste and the public endpoint before declaring the rollout complete."

# Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
  echo "==> Showing logs (Ctrl+C to exit)..."
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose logs -f"
fi
