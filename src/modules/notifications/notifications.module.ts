import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { NotificationPreferencesController } from './notification-preferences.controller'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

@Module({
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationsService, PrismaService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
