#!/usr/bin/env bash
set -euo pipefail

# Flush DB, then import community, templates, meters, expenses, and prepare period.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMUNITY_DIR="${1:-$ROOT/data/LOTUS-TM}"
if [[ "$COMMUNITY_DIR" != /* ]]; then
  COMMUNITY_DIR="$ROOT/$COMMUNITY_DIR"
fi
if [[ ! -d "$COMMUNITY_DIR" ]]; then
  echo "❌ Community data folder not found: $COMMUNITY_DIR"
  exit 1
fi
DATA="$(cd "$COMMUNITY_DIR" && pwd)"
COMMUNITY_CODE="$(basename "$DATA")"

cd "$ROOT"

echo "🚮 Flushing database (preserving users)..."
npm run db:flush -- --yes --preserve-users

echo "🏗️  Importing community ${COMMUNITY_CODE}..."
npm run import:community -- "$DATA"

echo "📁 Importing funds..."
npm run import:funds -- "$DATA/funds.json" "$COMMUNITY_CODE"

echo "💰 Importing opening balances..."
npm run import:opening -- "$DATA/opening-balances.csv"

echo "💰 Importing opening balances per unit..."
npm run import:opening:units -- "$DATA/opening-balances-units.csv"

echo "🧾 Importing bill templates..."
npm run import:bill-templates -- "$DATA"

echo "🧾 Importing meter entry templates..."
npm run import:meter-templates -- "$DATA"

mapfile -t PERIODS < <(
  for f in "$DATA"/meters-????-??-*.csv "$DATA"/expenses-????-??.*; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    if [[ "$base" =~ ([0-9]{4}-[0-9]{2}) ]]; then
      echo "${BASH_REMATCH[1]}"
    fi
  done | sort -u
)

if [[ ${#PERIODS[@]} -eq 0 ]]; then
  echo "⚠️  No periods detected in $DATA (meters-YYYY-MM-*.csv or expenses-YYYY-MM.*)."
  exit 1
fi

for period in "${PERIODS[@]}"; do
  meter_files=("$DATA"/meters-"$period"-*.csv)
  if [[ ${#meter_files[@]} -gt 0 ]]; then
    echo "🔌 Importing meters for ${period}..."
    for meter_file in "${meter_files[@]}"; do
      echo "  ↳ $(basename "$meter_file")"
      npm run import:meters -- "$meter_file" "$COMMUNITY_CODE"
    done
  fi

  if [[ -f "$DATA/expenses-$period.csv" || -f "$DATA/expenses-$period.json" ]]; then
    echo "💸 Importing expenses (${period})..."
    npm run import:expense -- "$DATA" "$period"
  fi

  echo "🔒 Closing template instances (${period})..."
  npm run close:templates -- "$COMMUNITY_CODE" "$period"

  echo "📦 Preparing period ${period}..."
  npm run close:period -- "$COMMUNITY_CODE" "$period"
  echo "📦 Approving period ${period}..."
  npm run close:period -- "$COMMUNITY_CODE" "$period" --approve
done

echo "✅ Done."
