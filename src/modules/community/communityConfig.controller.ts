import { Controller, Get, Param, NotFoundException } from '@nestjs/common'
import { CommunityService } from './community.service'

// Public endpoint to expose community configuration (parsed def.json)
@Controller('community-config')
export class CommunityConfigController {
  constructor(private svc: CommunityService) {}

  @Get(':communityCode')
  async config(@Param('communityCode') communityCode: string) {
    const cfg = await this.svc.getConfigSnapshot(communityCode)
    if (!cfg) throw new NotFoundException('Config not found')
    return cfg
  }

  @Get(':communityCode/meters')
  async meters(@Param('communityCode') communityCode: string) {
    const cfg = await this.svc.getMeterConfig(communityCode)
    if (!cfg) throw new NotFoundException('Config not found')
    return cfg
  }

  @Get(':communityCode/template-coverage')
  async templateCoverage(@Param('communityCode') communityCode: string) {
    const coverage = await this.svc.getTemplateCoverage(communityCode)
    if (!coverage) throw new NotFoundException('Coverage not found')
    return coverage
  }

  // Back-compat alias
  @Get(':communityCode/meters-config')
  async metersAlias(@Param('communityCode') communityCode: string) {
    return this.meters(communityCode)
  }
}
