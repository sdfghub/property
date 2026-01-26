#!/usr/bin/env bash
set -euo pipefail

if [ "${CONFIRM_DESTROY:-}" != "1" ]; then
  echo "Refusing to destroy stacks without CONFIRM_DESTROY=1" >&2
  echo "This will delete RDS and all data in PropertyExpenses-Data." >&2
  exit 1
fi

AWS_REGION="${AWS_REGION:-eu-central-1}"
TAKE_SNAPSHOT="${TAKE_SNAPSHOT:-1}"
STACKS=(
  PropertyExpenses-Frontend-Expo
  PropertyExpenses-Frontend
  PropertyExpenses-App
  PropertyExpenses-Access
  PropertyExpenses-Data
  PropertyExpenses-Network
)

db_instance_id="${DB_INSTANCE_ID:-}"
if [ "${db_instance_id}" = "" ]; then
  db_instance_id="$(aws cloudformation list-stack-resources \
    --stack-name "PropertyExpenses-Data" \
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

if [ "${db_instance_id}" != "None" ] && [ "${db_instance_id}" != "" ]; then
  if [ "${TAKE_SNAPSHOT}" = "1" ]; then
    DB_INSTANCE_ID="${db_instance_id}" ./scripts/snapshot-db.sh
  fi
  if [ "${AUTO_DELETE_DB:-}" = "1" ]; then
    echo "🗑️  Deleting DB instance ${db_instance_id}"
    aws rds delete-db-instance \
      --db-instance-identifier "${db_instance_id}" \
      --skip-final-snapshot \
      --delete-automated-backups \
      --region "${AWS_REGION}" >/dev/null
    echo "⏳ Waiting for DB instance ${db_instance_id} to be deleted"
    aws rds wait db-instance-deleted \
      --db-instance-identifier "${db_instance_id}" \
      --region "${AWS_REGION}"
  fi
fi

any_stack="0"
for stack in "${STACKS[@]}"; do
  if aws cloudformation describe-stacks --stack-name "${stack}" --region "${AWS_REGION}" >/dev/null 2>&1; then
    any_stack="1"
    break
  fi
done

if [ "${any_stack}" = "0" ]; then
  echo "✅ Stacks already destroyed; nothing to do."
  exit 0
fi

echo "🧨 Destroying CDK stacks (includes RDS data loss)"
pushd infra/cdk >/dev/null
if [ ! -d node_modules ]; then
  npm ci
fi
npm run build
npx cdk destroy \
  PropertyExpenses-App \
  PropertyExpenses-Access \
  PropertyExpenses-Frontend \
  PropertyExpenses-Frontend-Expo \
  PropertyExpenses-Data \
  PropertyExpenses-Network \
  --require-approval never \
  --force
popd >/dev/null

echo "✅ Infra shutdown complete"
