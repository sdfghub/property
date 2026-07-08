#!/usr/bin/env bash
set -euo pipefail
# Rebuild the Kralik association from its committed source (does NOT touch other communities).
# Loads the FULL historical ledger (Feb-2022 .. Feb-2026) directly from the exported history
# (data/Kralik/history/{matrix,penalties}.csv, mapped by data/Kralik/history-mapping.json) via the
# reusable migration injector — no allocation/recompute, exact by construction. def.json's 2026-03
# then stands as the current OPEN period, operated live going forward.
# Usage: bash scripts/rebuild-kralik.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "🚮 wiping Kralik (incl. invoices + vendors)..."
npm run wipe:community -- Kralik --all >/dev/null

echo "🏗️  importing community + funds + bill-templates + meter-templates..."
npm run import:community -- ./data/Kralik >/dev/null
npm run import:funds -- ./data/Kralik/funds.json Kralik >/dev/null
npm run import:bill-templates -- ./data/Kralik >/dev/null
npm run import:meter-templates -- ./data/Kralik >/dev/null

echo "📚 injecting full history at ledger level from the export (charges + balances + penalties)..."
npm run history:inject -- ./data/Kralik

echo "✅ Kralik rebuilt: history injected (Feb-22..Feb-26); 2026-03 is the current open period."
