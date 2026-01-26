#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-central-1}"
SSM_PARAM_NAME="${SSM_PARAM_NAME:-/property-expenses/DATABASE_URL}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
DB_PORT="${DB_PORT:-5432}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/property-secrets/db.env}"
SNAPSHOT_FILE="${SNAPSHOT_FILE:-$HOME/property-secrets/last-snapshot}"

if [ -f "${SECRETS_FILE}" ]; then
  # shellcheck disable=SC1090
  source "${SECRETS_FILE}"
fi
SNAPSHOT_FILE="${SNAPSHOT_FILE:-/tmp/property-expenses-db-snapshot}"

DB_SNAPSHOT_ID="${DB_SNAPSHOT_ID:-}"
if [ "${DB_SNAPSHOT_ID}" = "" ] && [ -f "${SNAPSHOT_FILE}" ]; then
  DB_SNAPSHOT_ID="$(cat "${SNAPSHOT_FILE}")"
fi

if [ "${DB_SNAPSHOT_ID}" = "" ]; then
  echo "DB_SNAPSHOT_ID is required (or set SNAPSHOT_FILE with a saved snapshot id)" >&2
  exit 1
fi

if aws cloudformation describe-stacks --stack-name "PropertyExpenses-Data" --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "PropertyExpenses-Data stack already exists; restore aborted." >&2
  exit 1
fi

existing_ids="$(aws rds describe-db-instances \
  --region "${AWS_REGION}" \
  --query "DBInstances[?contains(DBInstanceIdentifier, 'propertyexpenses')].DBInstanceIdentifier" \
  --output text)"
if [ "${existing_ids}" != "" ]; then
  echo "Found existing RDS instance(s): ${existing_ids}" >&2
  echo "Restore aborted. A previous shutdown likely did not finish." >&2
  exit 1
fi

echo "🏗️  Deploying CDK stacks from snapshot ${DB_SNAPSHOT_ID}"
pushd infra/cdk >/dev/null
if [ ! -d node_modules ]; then
  npm ci
fi
npm run build
npx cdk deploy \
  PropertyExpenses-Network \
  PropertyExpenses-Data \
  PropertyExpenses-Access \
  PropertyExpenses-App \
  PropertyExpenses-Frontend \
  PropertyExpenses-Frontend-Expo \
  --require-approval never \
  -c dbSnapshotId="${DB_SNAPSHOT_ID}"
popd >/dev/null

db_instance_id="$(aws cloudformation list-stack-resources \
  --stack-name "PropertyExpenses-Data" \
  --region "${AWS_REGION}" \
  --query "StackResourceSummaries[?ResourceType=='AWS::RDS::DBInstance'].PhysicalResourceId | [0]" \
  --output text)"

if [ "${db_instance_id}" = "None" ] || [ "${db_instance_id}" = "" ]; then
  echo "Could not find DB instance in stack PropertyExpenses-Data" >&2
  exit 1
fi

echo "⏳ Waiting for DB instance ${db_instance_id} to be available"
aws rds wait db-instance-available \
  --db-instance-identifier "${db_instance_id}" \
  --region "${AWS_REGION}"

db_host="$(aws rds describe-db-instances \
  --db-instance-identifier "${db_instance_id}" \
  --region "${AWS_REGION}" \
  --query "DBInstances[0].Endpoint.Address" \
  --output text)"

if [ "${db_host}" = "None" ] || [ "${db_host}" = "" ]; then
  echo "Could not resolve DB endpoint for ${db_instance_id}" >&2
  exit 1
fi

if [ "${DATABASE_URL:-}" = "" ]; then
  if [ "${DB_PASSWORD:-}" != "" ]; then
    DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${db_host}:${DB_PORT}/${DB_NAME}"
  else
    DATABASE_URL="postgres://${DB_USER}@${db_host}:${DB_PORT}/${DB_NAME}"
  fi
fi

echo "🔐 Writing SSM parameter ${SSM_PARAM_NAME} in ${AWS_REGION}"
aws ssm put-parameter \
  --name "${SSM_PARAM_NAME}" \
  --type "SecureString" \
  --value "${DATABASE_URL}" \
  --overwrite \
  --region "${AWS_REGION}"

echo "✅ Infra restore complete"
