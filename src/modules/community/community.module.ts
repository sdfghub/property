import { Module } from '@nestjs/common'
import { CommunityController } from './community.controller'
import { CommunityService } from './community.service'
import { CommunityConfigController } from './communityConfig.controller'
import { CommunityProgramsController } from './communityPrograms.controller'
import { CommunityPublicController } from './communityPublic.controller'
import { PrismaService } from '../user/prisma.service'

@Module({
  controllers: [CommunityController, CommunityConfigController, CommunityProgramsController, CommunityPublicController],
  providers: [CommunityService, PrismaService],
  exports: [CommunityService],
})
export class CommunityModule {}
