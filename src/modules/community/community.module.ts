import { Module } from '@nestjs/common'
import { CommunityController } from './community.controller'
import { CommunityDashboardController } from './communityDashboard.controller'
import { CommunityService } from './community.service'
import { CommunityConfigController } from './communityConfig.controller'
import { CommunityProgramsController } from './communityPrograms.controller'
import { CommunityPublicController } from './communityPublic.controller'
import { PrismaService } from '../user/prisma.service'
import { PeriodModule } from '../period/period.module'
import { TicketingModule } from '../ticketing/ticketing.module'
import { EngagementModule } from '../engagement/engagement.module'

@Module({
  imports: [PeriodModule, TicketingModule, EngagementModule],
  controllers: [
    CommunityController,
    CommunityConfigController,
    CommunityProgramsController,
    CommunityPublicController,
    CommunityDashboardController,
  ],
  providers: [CommunityService, PrismaService],
  exports: [CommunityService],
})
export class CommunityModule {}
