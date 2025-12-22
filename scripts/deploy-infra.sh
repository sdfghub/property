#!/usr/bin/env bash
set -euo pipefail

if [ "${DATABASE_URL:-}" = "" ]; then
  echo "DATABASE_URL is required (export DATABASE_URL=...)" >&2
  exit 1
fi

AWS_REGION="${AWS_REGION:-eu-central-1}"
SSM_PARAM_NAME="${SSM_PARAM_NAME:-/property-expenses/DATABASE_URL}"

echo "🔐 Writing SSM parameter ${SSM_PARAM_NAME} in ${AWS_REGION}"
aws ssm put-parameter \
  --name "${SSM_PARAM_NAME}" \
  --type "SecureString" \
  --value "${DATABASE_URL}" \
  --overwrite \
  --region "${AWS_REGION}"

echo "🏗️  Deploying CDK stacks"
pushd infra/cdk >/dev/null
npm ci
npm run build
npx cdk deploy PropertyExpenses-Network PropertyExpenses-Data PropertyExpenses-App --require-approval never
popd >/dev/null

echo "✅ Infra deploy complete"
