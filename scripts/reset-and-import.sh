#!/usr/bin/env bash
set -euo pipefail

# Flush DB, then import LOTUS-TM community, meters, and expenses.
# Assumes npm scripts:
#  - db:flush
#  - import:community
#  - import:meters
#  - import:expense

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/data/LOTUS-TM"

cd "$ROOT"

echo "🚮 Flushing database..."
npm run db:flush -- --yes

echo "🏗️  Importing community LOTUS-TM..."
npm run import:community -- "$DATA"

echo "📁 Importing programs..."
npm run import:programs -- "$DATA/programs.json" LOTUS-TM

echo "💰 Importing opening balances..."
npm run import:opening -- "$DATA/opening-balances.csv"

echo "🧾 Importing bill templates..."
npm run import:bill-templates -- "$DATA"

echo "🧾 Importing meter entry templates..."
npm run import:meter-templates -- "$DATA"

echo "🔌 Importing meters (water total)..."
npm run import:meters -- "$DATA/meters-2025-09-water-total.csv" LOTUS-TM

echo "🔌 Importing meters (water)..."
npm run import:meters -- "$DATA/meters-2025-09-water.csv" LOTUS-TM

echo "🔌 Importing meters (hot water)..."
npm run import:meters -- "$DATA/meters-2025-09-hotwater.csv" LOTUS-TM

echo "🔌 Importing meters (heating)..."
npm run import:meters -- "$DATA/meters-2025-09-heating.csv" LOTUS-TM

echo "🔌 Importing meters (gas totals)..."
npm run import:meters -- "$DATA/meters-2025-09-gas.csv" LOTUS-TM

echo "🔌 Importing meters (electricity)..."
npm run import:meters -- "$DATA/meters-2025-09-electricity.csv" LOTUS-TM

echo "💸 Importing expenses..."
npm run import:expense -- "$DATA" 2025-09

echo "✅ Done."
