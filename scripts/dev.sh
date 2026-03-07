#!/usr/bin/env bash
# Start all local services for test-kai development
# Usage: ./scripts/dev.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo "Shutting down..."
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
    wait 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

# Check .env exists
if [ ! -f "$ROOT_DIR/.env" ]; then
    echo "ERROR: $ROOT_DIR/.env not found. Copy .env.example and fill in credentials."
    exit 1
fi

# Check python deps
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "Installing Python dependencies..."
    pip3 install -r "$ROOT_DIR/requirements.txt"
fi

# Check node_modules
if [ ! -d "$ROOT_DIR/web/frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    (cd "$ROOT_DIR/web/frontend" && npm install)
fi

echo "=== Starting Test Kai (local dev) ==="
echo ""

# Backend: FastAPI on port 8006
echo "[backend] Starting FastAPI on http://localhost:8006"
(cd "$ROOT_DIR/web" && python3 -m uvicorn server:app --reload --port 8006) &
BACKEND_PID=$!

# Wait for backend to be ready
for i in $(seq 1 10); do
    if curl -s http://localhost:8006/api/sessions >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Frontend: Vite dev server on port 3006
echo "[frontend] Starting Vite on http://localhost:3006"
(cd "$ROOT_DIR/web/frontend" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "=== Services running ==="
echo "  Frontend: http://localhost:3006"
echo "  Backend:  http://localhost:8006"
echo "  API docs: http://localhost:8006/docs"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

wait
