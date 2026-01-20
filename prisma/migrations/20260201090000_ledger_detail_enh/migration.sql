-- Add denormalized context fields to be_ledger_entry_detail (nullable first)
ALTER TABLE "be_ledger_entry_detail"
  ADD COLUMN "community_id" TEXT,
  ADD COLUMN "period_id" TEXT,
  ADD COLUMN "billing_entity_id" TEXT,
  ADD COLUMN "kind" TEXT,
  ADD COLUMN "bucket" TEXT,
  ADD COLUMN "currency" TEXT DEFAULT 'RON',
  ADD COLUMN "ref_type" TEXT,
  ADD COLUMN "ref_id" TEXT;

-- Backfill from parent ledger entry
UPDATE "be_ledger_entry_detail" d
SET
  "community_id" = le."community_id",
  "period_id" = le."period_id",
  "billing_entity_id" = le."billing_entity_id",
  "kind" = le."kind",
  "bucket" = le."bucket",
  "currency" = le."currency",
  "ref_type" = le."ref_type",
  "ref_id" = le."ref_id"
FROM "be_ledger_entry" le
WHERE d."ledger_entry_id" = le."id";

-- Enforce non-null constraints
ALTER TABLE "be_ledger_entry_detail"
  ALTER COLUMN "community_id" SET NOT NULL,
  ALTER COLUMN "period_id" SET NOT NULL,
  ALTER COLUMN "billing_entity_id" SET NOT NULL,
  ALTER COLUMN "kind" SET NOT NULL,
  ALTER COLUMN "bucket" SET NOT NULL,
  ALTER COLUMN "currency" SET NOT NULL;

-- Indexes for detail-level querying
CREATE INDEX "be_ledger_entry_detail_community_id_period_id_billing_entit_idx"
  ON "be_ledger_entry_detail" ("community_id", "period_id", "billing_entity_id");
CREATE INDEX "be_ledger_entry_detail_community_id_bucket_idx"
  ON "be_ledger_entry_detail" ("community_id", "bucket");
CREATE INDEX "be_ledger_entry_detail_community_id_kind_idx"
  ON "be_ledger_entry_detail" ("community_id", "kind");
