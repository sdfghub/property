import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { MeasureModeService } from './measure-mode.service'

@Controller('communities/:communityId/measure-modes')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class MeasureModeController {
  constructor(private readonly svc: MeasureModeService) {}

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get()
  get(@Param('communityId') communityId: string) {
    return this.svc.get(communityId)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post()
  set(@Param('communityId') communityId: string, @Body() body: any) {
    return this.svc.set(communityId, body || {})
  }
}
