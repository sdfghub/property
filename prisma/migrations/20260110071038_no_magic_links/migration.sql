/*
  Warnings:

  - You are about to drop the `login_token` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "login_token" DROP CONSTRAINT "login_token_user_id_fkey";

-- DropTable
DROP TABLE "login_token";
