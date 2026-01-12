import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { EngagementService } from './engagement.service'
import { EventsController } from './events.controller'
import { PollsController } from './polls.controller'

@Module({
  providers: [PrismaService, EngagementService],
  controllers: [EventsController, PollsController],
  exports: [EngagementService],
})
export class EngagementModule {}
