import { Module } from '@nestjs/common'
import { CommunityController } from './community.controller'
import { CommunityDashboardController } from './communityDashboard.controller'
import { CommunityService } from './community.service'
import { CommunityConfigController } from './communityConfig.controller'
import { CommunityFundsController } from './communityFunds.controller'
import { CommunityPublicController } from './communityPublic.controller'
import { PrismaService } from '../user/prisma.service'
import { PeriodModule } from '../period/period.module'
import { TicketingModule } from '../ticketing/ticketing.module'
import { EngagementModule } from '../engagement/engagement.module'
import { CommunityImportController } from './communityImport.controller'
import { CommunityStructureController } from './community-structure.controller'

@Module({
  imports: [PeriodModule, TicketingModule, EngagementModule],
  controllers: [
    CommunityController,
    CommunityConfigController,
    CommunityFundsController,
    CommunityPublicController,
    CommunityDashboardController,
    CommunityImportController,
    CommunityStructureController,
  ],
  providers: [CommunityService, PrismaService],
  exports: [CommunityService],
})
export class CommunityModule {}
