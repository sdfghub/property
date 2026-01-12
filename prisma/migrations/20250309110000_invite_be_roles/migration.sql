-- AlterTable
ALTER TABLE "invite" ADD COLUMN "be_roles" "BillingEntityRole"[] NOT NULL DEFAULT ARRAY[]::"BillingEntityRole"[];
