#!/usr/bin/env bash
set -euo pipefail
# Rebuild Kralik with the FULL timeline: injected history + bridge + April/May actuals.
#
#   2021-11 .. 2026-02   history:inject          (vendor export, exact by construction)
#   2026-03              bridge-2026-03          (plug: Feb close → April opening)
#   2026-04 .. 2026-05   seed-kralik-april-may   (vendor actuals) + import:cash
#
# This supersedes rebuild-kralik.sh, which stops at a *computed* 2026-03 that overshoots the
# vendor's April opening by 210,384.55 (it books 115k of charges with no payments and duplicates
# April's REABILITARE_3 billing). See src/scripts/bridge-2026-03.ts for the full reasoning.
#
# Usage: bash scripts/rebuild-kralik-full.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "🚮 wiping Kralik (incl. invoices + vendors)..."
npm run wipe:community -- Kralik --all >/dev/null

echo "🏗️  importing community + funds + bill-templates + meter-templates..."
npm run import:community -- ./data/Kralik >/dev/null
npm run import:funds -- ./data/Kralik/funds.json Kralik >/dev/null
npm run import:bill-templates -- ./data/Kralik >/dev/null
npm run import:meter-templates -- ./data/Kralik >/dev/null

echo "📚 injecting history 2021-11..2026-02 from the export..."
npm run history:inject -- ./data/Kralik

echo "🌉 bridging 2026-03 (Feb close → April opening)..."
npx ts-node --transpile-only src/scripts/bridge-2026-03.ts

echo "📅 seeding April + May from actuals..."
npx ts-node --transpile-only src/scripts/seed-kralik-april-may.ts

echo "💰 importing the cash register..."
npm run import:cash

echo "✅ Kralik rebuilt: unbroken ledger 2021-11 → 2026-05."
