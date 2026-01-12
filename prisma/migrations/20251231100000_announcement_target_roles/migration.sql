-- CreateTable
CREATE TABLE "announcement_target_role" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "role" "BillingEntityRole" NOT NULL,

    CONSTRAINT "announcement_target_role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "announcement_target_role_announcement_id_role_key" ON "announcement_target_role"("announcement_id", "role");

-- CreateIndex
CREATE INDEX "announcement_target_role_announcement_id_idx" ON "announcement_target_role"("announcement_id");

-- AddForeignKey
ALTER TABLE "announcement_target_role" ADD CONSTRAINT "announcement_target_role_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
