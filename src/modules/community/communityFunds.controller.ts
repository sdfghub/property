import { Controller, Get, Param, NotFoundException } from '@nestjs/common'
import { CommunityService } from './community.service'

// Public endpoint to expose funds independently
@Controller('community-funds')
export class CommunityFundsController {
  constructor(private svc: CommunityService) {}

  @Get(':communityCode')
  async list(@Param('communityCode') communityCode: string) {
    const funds = await this.svc.listFunds(communityCode)
    if (!funds) throw new NotFoundException('Community not found')
    return funds
  }
}
