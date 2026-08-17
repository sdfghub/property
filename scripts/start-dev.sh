#!/usr/bin/env bash
# Start the full property dev stack: Postgres (docker) + NestJS backend + Vite frontend.
#
# Usage: bash scripts/start-dev.sh            (starts everything, Ctrl+C stops all)
#        bash scripts/start-dev.sh --no-db    (skip docker; assume Postgres already running)
#
# Prerequisites, once: `cp .env.example .env`, `npx prisma db push`, `npm run seed`, and
# `echo 'VITE_API_BASE=http://localhost:3100/api' > frontend/.env.local`. See docs/onboarding.md.
set -uo pipefail

# The repo root IS the backend project; the web client lives in ./frontend.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT"
FRONTEND="$ROOT/frontend"
SKIP_DB=0
[[ "${1:-}" == "--no-db" ]] && SKIP_DB=1

# Kill the whole process group (backend + frontend + their children) on exit / Ctrl+C.
cleanup() { echo; echo "⏹  Stopping dev stack..."; kill 0 2>/dev/null; }
trap cleanup SIGINT SIGTERM EXIT

# 1) Postgres (container property-db on :5540, per docker-compose.yml)
if [[ "$SKIP_DB" -eq 0 ]]; then
  echo "🐘 Starting Postgres (docker compose)..."
  ( cd "$BACKEND" && docker compose up -d ) || { echo "❌ docker compose failed"; exit 1; }
  echo -n "   waiting for DB"
  for _ in $(seq 1 30); do
    if docker exec property-db pg_isready -U postgres >/dev/null 2>&1; then echo " ✅"; break; fi
    echo -n "."; sleep 1
  done
fi

# 2) First-run dependency install. The two trees are SEPARATE npm projects (own lockfiles) —
#    never hoist or symlink one into the other. See docs/onboarding.md.
[[ -d "$BACKEND/node_modules" ]]  || { echo "📦 Installing backend deps...";  ( cd "$BACKEND"  && npm ci ); }
[[ -d "$FRONTEND/node_modules" ]] || { echo "📦 Installing frontend deps..."; ( cd "$FRONTEND" && npm ci ); }

# 3) Backend (NestJS, http://localhost:3100/api). Applies `prisma db push` on boot.
echo "🚀 Starting backend  → http://localhost:3100/api"
( cd "$BACKEND" && npm run dev ) &
echo -n "   waiting for backend"
for _ in $(seq 1 60); do
  if curl -sf http://localhost:3100/api/healthz >/dev/null 2>&1; then echo " ✅"; break; fi
  echo -n "."; sleep 1
done

# 4) Frontend (Vite, http://localhost:5173 — frontend/.env.local points it at :3100/api)
# --strictPort so Vite FAILS loudly if 5173 is taken instead of silently moving to 5174 (which would
# leave this script advertising the wrong URL and the user staring at a stale/blank tab).
echo "🎨 Starting frontend → http://localhost:5173"
( cd "$FRONTEND" && npm run dev -- --port 5173 --strictPort ) &

echo ""
echo "──────────────────────────────────────────────"
echo "  Backend   http://localhost:3100/api"
echo "  Frontend  http://localhost:5173"
echo "  DB        localhost:5540 (property_expenses)"
echo "  Ctrl+C to stop everything."
echo "──────────────────────────────────────────────"

# Wait on the background jobs; if either dies, the trap tears the rest down.
wait
