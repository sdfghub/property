#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-central-1}"
DATA_STACK="${DATA_STACK:-PropertyExpenses-Data}"
SNAPSHOT_FILE="${SNAPSHOT_FILE:-$HOME/property-secrets/last-snapshot}"

db_instance_id="${DB_INSTANCE_ID:-}"
if [ "${db_instance_id}" = "" ]; then
  db_instance_id="$(aws cloudformation list-stack-resources \
    --stack-name "${DATA_STACK}" \
    --region "${AWS_REGION}" \
    --query "StackResourceSummaries[?ResourceType=='AWS::RDS::DBInstance'].PhysicalResourceId | [0]" \
    --output text)"
fi

if [ "${db_instance_id}" != "None" ] && [ "${db_instance_id}" != "" ]; then
  if ! aws rds describe-db-instances \
    --db-instance-identifier "${db_instance_id}" \
    --region "${AWS_REGION}" >/dev/null 2>&1; then
    db_instance_id=""
  fi
fi

if [ "${db_instance_id}" = "None" ] || [ "${db_instance_id}" = "" ]; then
  db_instance_count="$(aws rds describe-db-instances \
    --region "${AWS_REGION}" \
    --query "length(DBInstances)" \
    --output text)"
  if [ "${db_instance_count}" = "1" ]; then
    db_instance_id="$(aws rds describe-db-instances \
      --region "${AWS_REGION}" \
      --query "DBInstances[0].DBInstanceIdentifier" \
      --output text)"
  fi
fi

if [ "${db_instance_id}" = "None" ] || [ "${db_instance_id}" = "" ]; then
  echo "Could not find DB instance in stack ${DATA_STACK}" >&2
  echo "Set DB_INSTANCE_ID explicitly if the instance is outside the stack or renamed." >&2
  exit 1
fi

snapshot_id="property-expenses-${db_instance_id}-$(date -u +%Y%m%d%H%M%S)"

echo "📸 Creating RDS snapshot ${snapshot_id}"
aws rds create-db-snapshot \
  --db-instance-identifier "${db_instance_id}" \
  --db-snapshot-identifier "${snapshot_id}" \
  --region "${AWS_REGION}" >/dev/null

echo "⏳ Waiting for snapshot to be available"
aws rds wait db-snapshot-available \
  --db-snapshot-identifier "${snapshot_id}" \
  --region "${AWS_REGION}"

mkdir -p "$(dirname "${SNAPSHOT_FILE}")"
echo "${snapshot_id}" > "${SNAPSHOT_FILE}"
echo "✅ Snapshot ready: ${snapshot_id}"
echo "Saved snapshot id to ${SNAPSHOT_FILE}"
