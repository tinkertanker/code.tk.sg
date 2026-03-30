#!/bin/bash
set -euo pipefail

# Redis backup script for code.tk.sg
# Retention: daily×7, weekly×4, monthly×12, yearly×forever
#
# Usage: ./scripts/backup.sh [--remote]
# --remote: Run on the Docker host via SSH (for cron on local machine)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_BASE="${BACKUP_BASE:-$SCRIPT_DIR/../backups}"
REMOTE_HOST="tinkertanker@dev.tk.sg"
REMOTE_DIR="Docker/code.tk.sg"

DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%u)   # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)  # 01-31
MONTH=$(date +%m)          # 01-12

DAILY_DIR="$BACKUP_BASE/daily"
WEEKLY_DIR="$BACKUP_BASE/weekly"
MONTHLY_DIR="$BACKUP_BASE/monthly"
YEARLY_DIR="$BACKUP_BASE/yearly"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR" "$YEARLY_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Redis backup..."

cleanup_tmpfile() {
  if [ -n "${TMPFILE:-}" ] && [ -f "${TMPFILE:-}" ]; then
    rm -f "$TMPFILE"
  fi
}

trap cleanup_tmpfile EXIT

# Trigger a Redis BGSAVE and copy the RDB file
if [ "${1:-}" = "--remote" ]; then
  TMPFILE=$(mktemp)
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && docker compose exec -T redis redis-cli BGSAVE >/dev/null"
  sleep 2
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && CONTAINER_ID=\$(docker compose ps -q redis) && docker cp \$CONTAINER_ID:/data/dump.rdb -" > "$TMPFILE"
elif [ -f "$SCRIPT_DIR/../docker-compose.yml" ]; then
  TMPFILE=$(mktemp)
  (
    cd "$SCRIPT_DIR/.."
    docker compose exec -T redis redis-cli BGSAVE >/dev/null
    sleep 2
    CONTAINER_ID=$(docker compose ps -q redis)
    docker cp "$CONTAINER_ID:/data/dump.rdb" "$TMPFILE"
  )
else
  # Local backup (development)
  redis-cli BGSAVE >/dev/null 2>&1
  sleep 2
  REDIS_DIR=$(redis-cli CONFIG GET dir | tail -1)
  TMPFILE="$REDIS_DIR/dump.rdb"
fi

DUMP_FILE="$DAILY_DIR/dump-$DATE.rdb"
cp "$TMPFILE" "$DUMP_FILE"
echo "  Daily backup: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# Weekly backup (Sunday)
if [ "$DAY_OF_WEEK" = "7" ]; then
  cp "$DUMP_FILE" "$WEEKLY_DIR/dump-$DATE.rdb"
  echo "  Weekly backup: $WEEKLY_DIR/dump-$DATE.rdb"
fi

# Monthly backup (1st of month)
if [ "$DAY_OF_MONTH" = "01" ]; then
  cp "$DUMP_FILE" "$MONTHLY_DIR/dump-$DATE.rdb"
  echo "  Monthly backup: $MONTHLY_DIR/dump-$DATE.rdb"
fi

# Yearly backup (1st January)
if [ "$DAY_OF_MONTH" = "01" ] && [ "$MONTH" = "01" ]; then
  cp "$DUMP_FILE" "$YEARLY_DIR/dump-$DATE.rdb"
  echo "  Yearly backup: $YEARLY_DIR/dump-$DATE.rdb"
fi

# --- Retention cleanup ---

# Daily: keep 7 days
find "$DAILY_DIR" -name "dump-*.rdb" -mtime +7 -delete 2>/dev/null
echo "  Pruned daily backups older than 7 days"

# Weekly: keep 4 weeks (28 days)
find "$WEEKLY_DIR" -name "dump-*.rdb" -mtime +28 -delete 2>/dev/null
echo "  Pruned weekly backups older than 4 weeks"

# Monthly: keep 12 months (365 days)
find "$MONTHLY_DIR" -name "dump-*.rdb" -mtime +365 -delete 2>/dev/null
echo "  Pruned monthly backups older than 12 months"

# Yearly: keep forever (no pruning)
echo "  Yearly backups: kept forever"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete."
