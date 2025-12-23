-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'APPLE', 'FACEBOOK', 'MICROSOFT');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "password_hash" TEXT;

-- CreateTable
CREATE TABLE "user_oauth_account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_oauth_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_oauth_account_email_idx" ON "user_oauth_account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_oauth_account_provider_provider_user_id_key" ON "user_oauth_account"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_oauth_account_user_id_provider_key" ON "user_oauth_account"("user_id", "provider");

-- AddForeignKey
ALTER TABLE "user_oauth_account" ADD CONSTRAINT "user_oauth_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
