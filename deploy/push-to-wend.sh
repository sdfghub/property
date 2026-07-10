#!/usr/bin/env bash
# Deploy the current local checkout to the prod host (wend).
#
#   Usage:  ./deploy/push-to-wend.sh
#
# Overridable via env:
#   PROD_HOST   ssh target           (default: bogdan@192.168.1.139)
#   PROD_DIR    compose dir on host  (default: ~/app)
#   SERVICES    services to rebuild  (default: "api web")
#
# Schema changes need no extra step — the api container runs
# `prisma db push` on start, so the DB is synced automatically.
set -euo pipefail

HOST="${PROD_HOST:-bogdan@192.168.1.139}"
REMOTE_DIR="${PROD_DIR:-~/app}"
SERVICES="${SERVICES:-api web}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ [1/3] syncing code to ${HOST}:${REMOTE_DIR}/backend ..."
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' --exclude 'frontend/node_modules' \
  --exclude 'dist' --exclude 'frontend/dist' \
  --exclude '.env' --exclude '.env.*' \
  ./ "${HOST}:${REMOTE_DIR}/backend/"

echo "→ [2/3] rebuilding images (${SERVICES}) ..."
ssh "${HOST}" "cd ${REMOTE_DIR} && docker compose build ${SERVICES}"

echo "→ [3/3] restarting ..."
ssh "${HOST}" "cd ${REMOTE_DIR} && docker compose up -d ${SERVICES} && sleep 5 && docker compose ps"

echo "✓ deployed to ${HOST}. (schema synced via 'prisma db push' on api start)"
