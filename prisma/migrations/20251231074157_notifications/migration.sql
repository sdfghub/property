-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('INCIDENT', 'TASK');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELED', 'REOPENED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TicketTag" AS ENUM ('OUTAGE', 'BREAKDOWN', 'LEAK', 'SAFETY', 'SECURITY', 'COMPLAINT', 'ACCESS', 'NOISE', 'CLEANLINESS', 'DAMAGE', 'PREVENTIVE_MAINTENANCE', 'INSPECTION', 'REPAIR', 'UPGRADE', 'CLEANING', 'VENDOR_VISIT', 'COMPLIANCE', 'METER_READING');

-- CreateEnum
CREATE TYPE "TicketEventType" AS ENUM ('STATUS_CHANGE', 'COMMENT', 'ASSIGNMENT', 'TAGS_UPDATED');

-- CreateEnum
CREATE TYPE "AnnouncementAudienceType" AS ENUM ('COMMUNITY', 'UNIT_GROUP');

-- CreateEnum
CREATE TYPE "AnnouncementImpactTag" AS ENUM ('WATER', 'HEAT', 'ELEVATOR', 'ELECTRICITY', 'ACCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationSource" AS ENUM ('TICKET', 'COMMUNICATION');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "ticket" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "type" "TicketType" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "created_by_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tag" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "tag" "TicketTag" NOT NULL,

    CONSTRAINT "ticket_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_event" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "type" "TicketEventType" NOT NULL,
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "audience_type" "AnnouncementAudienceType" NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_impact_tag" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "tag" "AnnouncementImpactTag" NOT NULL,

    CONSTRAINT "announcement_impact_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_audience_group" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "unit_group_id" TEXT NOT NULL,

    CONSTRAINT "announcement_audience_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "NotificationSource" NOT NULL,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_community_id_status_idx" ON "ticket"("community_id", "status");

-- CreateIndex
CREATE INDEX "ticket_created_by_id_idx" ON "ticket"("created_by_id");

-- CreateIndex
CREATE INDEX "ticket_assignee_id_idx" ON "ticket"("assignee_id");

-- CreateIndex
CREATE INDEX "ticket_tag_tag_idx" ON "ticket_tag"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_tag_ticket_id_tag_key" ON "ticket_tag"("ticket_id", "tag");

-- CreateIndex
CREATE INDEX "ticket_event_ticket_id_idx" ON "ticket_event"("ticket_id");

-- CreateIndex
CREATE INDEX "announcement_community_id_idx" ON "announcement"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_impact_tag_announcement_id_tag_key" ON "announcement_impact_tag"("announcement_id", "tag");

-- CreateIndex
CREATE INDEX "announcement_audience_group_unit_group_id_idx" ON "announcement_audience_group"("unit_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_audience_group_announcement_id_unit_group_id_key" ON "announcement_audience_group"("announcement_id", "unit_group_id");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_idx" ON "notification"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_user_id_channel_key" ON "notification_preference"("user_id", "channel");

-- CreateIndex
CREATE INDEX "notification_delivery_notification_id_idx" ON "notification_delivery"("notification_id");

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_impact_tag" ADD CONSTRAINT "announcement_impact_tag_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_audience_group" ADD CONSTRAINT "announcement_audience_group_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_audience_group" ADD CONSTRAINT "announcement_audience_group_unit_group_id_fkey" FOREIGN KEY ("unit_group_id") REFERENCES "unit_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
