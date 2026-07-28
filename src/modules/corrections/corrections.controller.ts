import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { CorrectionsService } from './corrections.service'

// Admin-created corrections (declarations → derived ledger). Reads open to admin/censor/committee;
// writes are COMMUNITY_ADMIN only. Corrections target the community's current non-CLOSED period.
@Controller('communities/:communityId/corrections')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CorrectionsController {
  constructor(private readonly svc: CorrectionsService) {}

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get()
  list(@Param('communityId') c: string, @Query('period') period?: string, @Query('debug') debug?: string) {
    return this.svc.list(c, period, debug)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('context')
  context(@Param('communityId') c: string) {
    return this.svc.context(c)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post()
  create(@Param('communityId') c: string, @Body() body: any, @Req() req: any) {
    return this.svc.create(c, req.user?.email ?? req.user?.id ?? req.user?.sub, body)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post(':id/void')
  void(@Param('communityId') c: string, @Param('id') id: string, @Req() req: any) {
    return this.svc.void(c, id, req.user?.email ?? req.user?.id ?? req.user?.sub)
  }
}
