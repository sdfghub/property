import { Module } from '@nestjs/common'
import { MailModule } from '../mail/mail.module'
import { PushModule } from '../push/push.module'
import { PrismaService } from '../user/prisma.service'
import { NotificationsJobsController } from './notifications-jobs.controller'
import { NotificationsJobsService } from './notifications-jobs.service'

@Module({
  imports: [MailModule, PushModule],
  controllers: [NotificationsJobsController],
  providers: [NotificationsJobsService, PrismaService],
  exports: [NotificationsJobsService],
})
export class NotificationsJobsModule {}
