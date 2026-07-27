#!/usr/bin/env bash
set -euo pipefail
# Rebuild Kralik WITHOUT the 2026-03 bridge: import the whole history through April straight from
# the export (matrix.csv now carries Mar/Apr), then COMPUTE May on top with the engine.
#
#   2021-11 .. 2026-04   history:inject  (HISTORY_CUTOVER=2026-05 → March + April are plain history)
#   2026-05              seed-kralik-april-may with KRALIK_SKIP_APRIL=1  (engine-computed May only)
#
# The bridge existed only to reconcile injected-history (ended Feb) with the ledger-sourced April.
# With April now imported from the same export, the Feb→Apr chain is continuous by construction, so
# no reconciliation period is needed. May is still computed by the close engine from actuals-2026-05.
#
# Usage: bash scripts/rebuild-kralik-nobridge.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Source-based penalties: PENALIZARI is driven by the export's Penalizări figures, not computed.
export KRALIK_SOURCE_PENALTIES=1

echo "🚮 wiping Kralik (incl. invoices + vendors)..."
npm run wipe:community -- Kralik --all >/dev/null

echo "🏗️  importing community + funds + bill-templates + meter-templates..."
npm run import:community -- ./data/Kralik >/dev/null
npm run import:funds -- ./data/Kralik/funds.json Kralik >/dev/null
npm run import:bill-templates -- ./data/Kralik >/dev/null
npm run import:meter-templates -- ./data/Kralik >/dev/null

echo "📚 injecting history 2021-11..2026-04 from the export (NO bridge; March+April as plain history)..."
HISTORY_CUTOVER=2026-05 npm run history:inject -- ./data/Kralik

echo "📅 computing May from actuals (engine), chained on the injected April..."
KRALIK_SKIP_APRIL=1 npx ts-node --transpile-only src/scripts/seed-kralik-april-may.ts

echo "💰 importing the cash register..."
npm run import:cash

echo "✅ Kralik rebuilt WITHOUT the bridge: 2021-11 → 2026-05."
