import { Controller, Get, Param, NotFoundException } from '@nestjs/common'
import { CommunityService } from './community.service'

// Public endpoint to expose programs independently
@Controller('community-programs')
export class CommunityProgramsController {
  constructor(private svc: CommunityService) {}

  @Get(':communityCode')
  async list(@Param('communityCode') communityCode: string) {
    const programs = await this.svc.listPrograms(communityCode)
    if (!programs) throw new NotFoundException('Community not found')
    return programs
  }
}
