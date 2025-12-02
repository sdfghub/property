# Property Expenses — App + CI/CD + Infra (CDK)

End-to-end: Prisma + TypeScript app, allocation, seed, Dockerfile, GitHub Actions, AWS CDK skeleton.

## Local
```bash
cp .env.example .env
npm i
npm run dev:db
npm run generate
npm run build
npm run seed
node dist/server.js
# -> GET http://localhost:3000/healthz
```
Allocate:
```bash
npm run allocate -- <expenseId>
```
Bill:
```bash
curl http://localhost:3000/bills/2025-11
```

## Docker
```bash
docker build -t property-expenses:dev .
docker run --rm -p 3000:3000 -e DATABASE_URL=... property-expenses:dev
```

## CI/CD
- **CI**: build + prisma validate on push/PR.
- **CD** (tag `vX.Y.Z`): push to ECR `property-expenses-api`, run migrations, force ECS rollout.
Secrets: `AWS_ROLE_ARN`, `DATABASE_URL_PROD`.

## Infra (CDK)
```bash
cd infra/cdk
npm i
npm run build
npm run synth
# npm run deploy
```
Adjust stack names, ECR repo, and ECS cluster/service names to your account.
