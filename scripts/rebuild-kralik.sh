#!/usr/bin/env bash
set -euo pipefail
# Rebuild the Kralik association from its committed data folder (does NOT touch other communities).
# NOTE: seeds a CLEAN state from source data — no ad-hoc payments (those were never committed), so the
# penalty total is the no-paydown value, not the old exploratory 147.48.
# Usage: bash scripts/rebuild-kralik.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "🚮 wiping Kralik (incl. invoices + vendors)..."
npm run wipe:community -- Kralik --all >/dev/null

echo "🏗️  importing community + funds + arrears + bill-templates + meter-templates..."
npm run import:community -- ./data/Kralik >/dev/null
npm run import:funds -- ./data/Kralik/funds.json Kralik >/dev/null
npm run import:arrears -- ./data/Kralik >/dev/null
npm run import:bill-templates -- ./data/Kralik >/dev/null
npm run import:meter-templates -- ./data/Kralik >/dev/null

echo "📦 CPI patch, due date/grace, actuals, close (with penalties)..."
npx ts-node --transpile-only src/scripts/seed-kralik-close.ts
