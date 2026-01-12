import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { CommunicationsController } from './communications.controller'
import { CommunicationsService } from './communications.service'

@Module({
  imports: [NotificationsModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, PrismaService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
