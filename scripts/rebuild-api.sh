#!/usr/bin/env bash
set -euo pipefail
# Completely rebuild an association THROUGH THE API:
#   1) flush it completely from the DB   (npm run wipe:community -- <COMM> --all)
#   2) import community / funds / opening balances / templates   (via API)
#   3) submit each period's actuals, then close -> prepare -> approve, and create
#      the next open period + vendor payments   (via API, the api-reset-and-import flow)
#
# The backend must already be running (it does the import over HTTP).
#
# Usage:
#   API_EMAIL=root@x API_PASSWORD=secret bash scripts/rebuild-api.sh ./data/PENTEST
#
# Env:
#   API_EMAIL / API_PASSWORD   system-admin login (required). `npm run seed` creates
#                              a root admin: bogdan.boji@gmail.com / 123456.
#   BASE_URL                   backend base (default http://localhost:3100).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DIR="${1:-}"
[[ -n "$DIR" ]] || { echo "Usage: bash scripts/rebuild-api.sh <community-data-dir>   (e.g. ./data/PENTEST)"; exit 1; }
[[ -f "$DIR/def.json" ]] || { echo "❌ Missing $DIR/def.json"; exit 1; }

: "${API_EMAIL:?Set API_EMAIL (a system-admin login — e.g. seed one with 'npm run seed')}"
: "${API_PASSWORD:?Set API_PASSWORD}"
BASE_URL="${BASE_URL:-http://localhost:3100}"

# Community code/id comes from def.json (falls back to the folder name).
COMM="$(node -e "const p=require('path');const d=process.argv[1];process.stdout.write(String(require(p.resolve(d,'def.json')).id||p.basename(d)))" "$DIR")"
echo "▶ Association: $COMM   (data: $DIR,  base: $BASE_URL)"

# 0) Backend must be up — the import runs over HTTP.
if ! curl -sf "$BASE_URL/api/healthz" >/dev/null 2>&1 && ! curl -sf "$BASE_URL/healthz" >/dev/null 2>&1; then
  echo "❌ Backend not reachable at $BASE_URL — start it (npm run dev) first."; exit 1
fi

# 1) Complete DB flush: ledgers, payments, invoices, vendors, cash, periods, topology, templates…
echo "🚮 Flushing $COMM from DB (wipe:community --all)…"
npm run wipe:community -- "$COMM" --all

# 2+3) Import + actuals + full close flow, via API. WIPE=false: we already flushed at DB level.
echo "🏗️  Importing + posting actuals + closing via API…"
WIPE=false BASE_URL="$BASE_URL" API_EMAIL="$API_EMAIL" API_PASSWORD="$API_PASSWORD" \
  npx ts-node --transpile-only src/scripts/api-reset-and-import.ts "$DIR"

echo "✅ Done: $COMM rebuilt via API."
