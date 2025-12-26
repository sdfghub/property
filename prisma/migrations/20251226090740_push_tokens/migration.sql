-- DropForeignKey
ALTER TABLE "push_token" DROP CONSTRAINT "push_token_user_id_fkey";

-- AddForeignKey
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
