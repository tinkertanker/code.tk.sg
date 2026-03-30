#!/bin/bash
set -e

# Deploy script for code.tk.sg (Haste Server)
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
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && git pull"
fi

# Copy docker-compose.yml if it exists locally
if [ -f docker-compose.yml ]; then
  echo "==> Copying docker-compose.yml to server..."
  scp docker-compose.yml "$REMOTE_HOST:$REMOTE_DIR/"
fi

# Copy production config
echo "==> Copying production config..."
scp config.production.js "$REMOTE_HOST:$REMOTE_DIR/"
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && cp config.production.js config.js"

# Build and restart on server
echo "==> Building and restarting containers..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose down"
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose build --no-cache"
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose up -d"

echo "==> Waiting for containers to start..."
sleep 5

# Check if containers are running
if ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose ps" | grep -q "Up\|running"; then
  echo "==> Deploy complete! Containers are running."
else
  echo "==> Warning: Containers may not have started correctly."
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose logs --tail=20"
  exit 1
fi

# Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
  echo "==> Showing logs (Ctrl+C to exit)..."
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose logs -f"
fi
