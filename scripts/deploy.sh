#!/bin/bash
# Deploy Kai Test Dashboard to server
# Server: 10.18.3.20 (katalon user), Port: 3006

set -e

SERVER="katalon@10.18.3.20"
REMOTE_DIR="/home/katalon/test-kai"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Deploying Kai Test Dashboard ==="
echo "From: $PROJECT_DIR"
echo "To:   $SERVER:$REMOTE_DIR"
echo ""

# 1. Sync project files to server
echo "[1/3] Syncing files to server..."
rsync -avz --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '__pycache__' \
  --exclude '.env' \
  --exclude 'web/data' \
  --exclude 'web/frontend/dist' \
  --exclude 'results/*.json' \
  --exclude '.claude' \
  --exclude 'sessions' \
  "$PROJECT_DIR/" "$SERVER:$REMOTE_DIR/"

# 2. Ensure .env exists on server
echo "[2/3] Checking .env on server..."
ssh "$SERVER" "test -f $REMOTE_DIR/.env || echo 'WARNING: .env not found on server! Copy it manually.'"

# 3. Build and restart container
echo "[3/3] Building and restarting container..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up --build -d"

echo ""
echo "=== Deploy complete ==="
echo "Dashboard: http://10.18.3.20:3006"
echo ""

# Show container status
ssh "$SERVER" "cd $REMOTE_DIR && docker compose ps"
