#!/usr/bin/env bash
set -euo pipefail

STACK_ACCESS="PropertyExpenses-Access"
STACK_DATA="PropertyExpenses-Data"
DB_ID_DEFAULT="propertyexpenses-data-postgres-restore-20260119"
LOCAL_PORT="${LOCAL_PORT:-3333}"
REMOTE_PORT="${REMOTE_PORT:-5432}"
DB_ID="${DB_ID:-$DB_ID_DEFAULT}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found" >&2
  exit 1
fi

BASTION_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_ACCESS" \
  --query "Stacks[0].Outputs[?OutputKey=='BastionInstanceId'].OutputValue" \
  --output text)

if [[ -z "$BASTION_ID" || "$BASTION_ID" == "None" ]]; then
  echo "BastionInstanceId not found in $STACK_ACCESS" >&2
  exit 1
fi

RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier "$DB_ID" \
  --query "DBInstances[0].Endpoint.Address" \
  --output text)

if [[ -z "$RDS_ENDPOINT" || "$RDS_ENDPOINT" == "None" ]]; then
  echo "RDS endpoint not found for $DB_ID" >&2
  exit 1
fi

echo "Starting SSM tunnel: localhost:${LOCAL_PORT} -> ${RDS_ENDPOINT}:${REMOTE_PORT}"
echo "Bastion: $BASTION_ID"

aws ssm start-session \
  --target "$BASTION_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$RDS_ENDPOINT\"],\"portNumber\":[\"$REMOTE_PORT\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}"
