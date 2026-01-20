ALTER TABLE "payment"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'POSTED',
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "provider_ref" TEXT,
  ADD COLUMN "provider_meta" JSONB,
  ADD COLUMN "allocation_spec" JSONB,
  ADD COLUMN "confirmed_at" TIMESTAMP(3),
  ADD COLUMN "canceled_at" TIMESTAMP(3);

CREATE INDEX "payment_status_idx" ON "payment" ("status");
CREATE INDEX "payment_provider_ref_idx" ON "payment" ("provider_ref");
