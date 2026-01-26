#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-central-1}"
SNAPSHOT_FILE="${SNAPSHOT_FILE:-$HOME/property-secrets/last-snapshot}"
DB_SNAPSHOT_ID="${DB_SNAPSHOT_ID:-}"

if [ "${DB_SNAPSHOT_ID}" = "" ] && [ -f "${SNAPSHOT_FILE}" ]; then
  DB_SNAPSHOT_ID="$(cat "${SNAPSHOT_FILE}")"
fi

if [ "${DB_SNAPSHOT_ID}" = "" ]; then
  echo "DB_SNAPSHOT_ID is required (or set SNAPSHOT_FILE with a saved snapshot id)" >&2
  exit 1
fi

status="$(aws rds describe-db-snapshots \
  --db-snapshot-identifier "${DB_SNAPSHOT_ID}" \
  --region "${AWS_REGION}" \
  --query "DBSnapshots[0].Status" \
  --output text)"

if [ "${status}" = "None" ] || [ "${status}" = "" ]; then
  echo "Snapshot not found: ${DB_SNAPSHOT_ID}" >&2
  exit 1
fi

echo "✅ Snapshot ${DB_SNAPSHOT_ID} status: ${status}"
