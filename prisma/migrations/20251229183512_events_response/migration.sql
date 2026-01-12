-- CreateTable
CREATE TABLE "event_rsvp" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_rsvp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_rsvp_event_id_idx" ON "event_rsvp"("event_id");

-- CreateIndex
CREATE INDEX "event_rsvp_user_id_idx" ON "event_rsvp"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_rsvp_event_id_user_id_key" ON "event_rsvp"("event_id", "user_id");

-- AddForeignKey
ALTER TABLE "event_rsvp" ADD CONSTRAINT "event_rsvp_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_rsvp" ADD CONSTRAINT "event_rsvp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
