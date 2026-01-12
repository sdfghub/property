-- CreateEnum
CREATE TYPE "BillingEntityRole" AS ENUM ('OWNER', 'RESIDENT', 'EXPENSE_RESPONSIBLE');

-- CreateTable
CREATE TABLE "billing_entity_user_role" (
    "id" TEXT NOT NULL,
    "billing_entity_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "BillingEntityRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_entity_user_role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_entity_user_role_billing_entity_id_user_id_role_key" ON "billing_entity_user_role"("billing_entity_id", "user_id", "role");

-- CreateIndex
CREATE INDEX "billing_entity_user_role_user_id_idx" ON "billing_entity_user_role"("user_id");

-- CreateIndex
CREATE INDEX "billing_entity_user_role_billing_entity_id_idx" ON "billing_entity_user_role"("billing_entity_id");

-- AddForeignKey
ALTER TABLE "billing_entity_user_role" ADD CONSTRAINT "billing_entity_user_role_billing_entity_id_fkey" FOREIGN KEY ("billing_entity_id") REFERENCES "billing_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_entity_user_role" ADD CONSTRAINT "billing_entity_user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: translate existing BE responsibles to OWNER
INSERT INTO "billing_entity_user_role" ("id", "billing_entity_id", "user_id", "role")
SELECT
  md5(random()::text || clock_timestamp()::text || ra."user_id"),
  ra."scopeId",
  ra."user_id",
  'OWNER'::"BillingEntityRole"
FROM "role_assignment" ra
JOIN "billing_entity" be ON be."id" = ra."scopeId"
WHERE ra."role" = 'BILLING_ENTITY_USER'
  AND ra."scope_type" = 'BILLING_ENTITY'
  AND ra."scopeId" IS NOT NULL
ON CONFLICT ("billing_entity_id", "user_id", "role") DO NOTHING;
