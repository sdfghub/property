#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-central-1}"
SSM_PARAM_NAME="${SSM_PARAM_NAME:-/property-expenses/DATABASE_URL}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/property-secrets/db.env}"

if [ -f "${SECRETS_FILE}" ]; then
  # shellcheck disable=SC1090
  source "${SECRETS_FILE}"
fi

if [ "${DATABASE_URL:-}" != "" ]; then
  echo "🔐 Writing SSM parameter ${SSM_PARAM_NAME} in ${AWS_REGION}"
  aws ssm put-parameter \
    --name "${SSM_PARAM_NAME}" \
    --type "SecureString" \
    --value "${DATABASE_URL}" \
    --overwrite \
    --region "${AWS_REGION}"
else
  echo "⚠️  DATABASE_URL not set; leaving ${SSM_PARAM_NAME} unchanged"
fi

echo "🏗️  Deploying CDK stacks"
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
  --require-approval never
popd >/dev/null

echo "✅ Infra startup complete"
