import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { FEATURE_META, FeaturesService } from './features.service'

@Controller('communities/:communityId/features')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  /** The feature catalog (codes + default labels/hints) so the UI need not hardcode them. */
  @Get('registry')
  registry() {
    return FEATURE_META
  }

  /** Any authenticated user may read a community's flags (the UI needs them to render). */
  @Get()
  get(@Param('communityId') communityId: string) {
    return this.features.getFeatures(communityId)
  }

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Post()
  set(@Param('communityId') communityId: string, @Body() body: any) {
    return this.features.setFeatures(communityId, body || {})
  }
}
