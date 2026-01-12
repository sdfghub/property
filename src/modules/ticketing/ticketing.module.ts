import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { TicketingController } from './ticketing.controller'
import { TicketingService } from './ticketing.service'

@Module({
  imports: [NotificationsModule],
  controllers: [TicketingController],
  providers: [TicketingService, PrismaService],
  exports: [TicketingService],
})
export class TicketingModule {}
