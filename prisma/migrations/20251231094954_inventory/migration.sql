-- CreateEnum
CREATE TYPE "InventoryAssetStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "source_inventory_rule_id" TEXT;

-- CreateTable
CREATE TABLE "inventory_asset" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "InventoryAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_maintenance_rule" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "interval_days" INTEGER NOT NULL,
    "next_due_at" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_maintenance_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_rule_tag" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "tag" "TicketTag" NOT NULL,

    CONSTRAINT "inventory_rule_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_asset_community_id_idx" ON "inventory_asset"("community_id");

-- CreateIndex
CREATE INDEX "inventory_maintenance_rule_asset_id_enabled_idx" ON "inventory_maintenance_rule"("asset_id", "enabled");

-- CreateIndex
CREATE INDEX "inventory_maintenance_rule_next_due_at_idx" ON "inventory_maintenance_rule"("next_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_rule_tag_rule_id_tag_key" ON "inventory_rule_tag"("rule_id", "tag");

-- CreateIndex
CREATE INDEX "ticket_source_inventory_rule_id_idx" ON "ticket"("source_inventory_rule_id");

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_source_inventory_rule_id_fkey" FOREIGN KEY ("source_inventory_rule_id") REFERENCES "inventory_maintenance_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset" ADD CONSTRAINT "inventory_asset_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset" ADD CONSTRAINT "inventory_asset_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_maintenance_rule" ADD CONSTRAINT "inventory_maintenance_rule_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "inventory_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_maintenance_rule" ADD CONSTRAINT "inventory_maintenance_rule_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_rule_tag" ADD CONSTRAINT "inventory_rule_tag_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "inventory_maintenance_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
