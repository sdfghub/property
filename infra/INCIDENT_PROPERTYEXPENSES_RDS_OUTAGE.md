# Incident Summary - PropertyExpenses RDS Outage and ECS Deploy Failure

## Context
- Stack: PropertyExpenses-App (ECS Fargate, Prisma, Postgres)
- Stack: PropertyExpenses-Data (RDS PostgreSQL, private subnets)
- Region: eu-central-1
- Auth: GitHub Actions (OIDC) + CDK

## What Happened
- ECS deployment failed.
- CloudFormation status: UPDATE_FAILED -> UPDATE_ROLLBACK_IN_PROGRESS.
- Failing resource: AWS::ECS::Service.
- Error: NotStabilized (service never reached steady state).

Application logs (Prisma):

```
P1001: Can't reach database server at <rds-endpoint>:5432
```

ECS tasks started, failed DB connection, exited -> service never stabilized.

## Initial Suspicion
Security groups / networking / NAT / VPC.

Verified as correct:
- ECS SG allowed outbound.
- DB SG allowed inbound from ECS SG.
- Same VPC and subnets.

## Root Cause
RDS DB instance was deleted, likely due to AWS free tier / account cleanup.

Evidence:
- `aws rds describe-db-instances` -> 0 instances.
- RDS console -> DB not visible.
- DescribeDBInstances by identifier -> DBInstanceNotFound.

However, CloudFormation PropertyExpenses-Data stack still showed:
- AWS::RDS::DBInstance -> UPDATE_COMPLETE.

Result: stack drifted. CFN thought the DB existed, but it did not.

## Key Discovery (Good News)
A final RDS snapshot exists and is available.

Snapshot ID:

```
final-propertyexpenses-data-postgres9dc8bb04-<uuid>
```

Timestamp: 2026-01-14.

The database can be restored with data intact.

## Why App Deploys Failed
ECS task definition pulls DATABASE_URL from SSM:

```
/property-expenses/DATABASE_URL
```

That value pointed to the old RDS endpoint which no longer existed.

Result:
- Prisma failed to connect.
- Container exited.
- ECS service never stabilized.
- CloudFormation rolled back the App stack.

## Immediate Recovery Plan (Chosen)
1. Restore DB from snapshot (new identifier).

```
aws rds restore-db-instance-from-db-snapshot \
  --region eu-central-1 \
  --db-instance-identifier propertyexpenses-data-postgres-restore-20260119 \
  --db-snapshot-identifier final-propertyexpenses-data-postgres9dc8bb04-... \
  --db-subnet-group-name propertyexpenses-data-postgressubnetgroup9f8a4d6e-... \
  --vpc-security-group-ids sg-04c8ded3fb3eb83ce
```

Wait:

```
aws rds wait db-instance-available \
  --db-instance-identifier propertyexpenses-data-postgres-restore-20260119 \
  --region eu-central-1
```

2. Get new endpoint.

```
aws rds describe-db-instances \
  --db-instance-identifier propertyexpenses-data-postgres-restore-20260119 \
  --region eu-central-1 \
  --query "DBInstances[0].Endpoint.Address" \
  --output text
```

3. Update SSM parameter (single required app change).

```
aws ssm put-parameter \
  --region eu-central-1 \
  --name /property-expenses/DATABASE_URL \
  --type SecureString \
  --value 'postgresql://USER:PASSWORD@NEW_ENDPOINT:5432/DBNAME' \
  --overwrite
```

4. Force ECS redeploy.

```
aws ecs update-service \
  --cluster property-expenses \
  --service api \
  --force-new-deployment \
  --region eu-central-1
```

(Alternative: `cdk deploy PropertyExpenses-App`.)

## State of IaC After Recovery
- PropertyExpenses-Data stack is drifted.
- CFN still references a DB instance that was deleted.
- Restored DB is not managed by CloudFormation.

Acceptable short-term to restore service, but should be cleaned up.

## Follow-Up Improvements (Recommended)
1. Make DB endpoint management explicit.
   - Data stack should output DB endpoint and write `/property-expenses/DATABASE_URL`.
   - App stack should only consume, never hardcode.
2. Make DB identity replaceable.
   - Treat DB identifier as disposable.
   - App depends on SSM parameter + SG/VPC wiring only.
3. Drift safety.
   - Avoid deleting DBs outside CloudFormation.
   - Consider termination protection and snapshot alarms.
4. CI/CD hardening.
   - GHA creds expired mid-deploy earlier; CDK monitor failed even though AWS continued.
   - Refresh AWS creds immediately before `cdk deploy`.

## Final Conclusion
This was not a networking or ECS issue.

It was a silent RDS deletion plus CloudFormation drift.

App failures were a symptom, not the cause.

Snapshot restore + SSM update is the correct recovery.

IaC should be adjusted to prevent this class of failure in the future.
