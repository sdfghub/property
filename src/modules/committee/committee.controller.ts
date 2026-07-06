import { Feature } from '../../common/decorators/feature.decorator'
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { CommitteeService } from './committee.service'

@Controller('communities/:communityId/committee/decisions')
@UseGuards(JwtAuthGuard, ScopesGuard)
@Feature('committee')
export class CommitteeController {
  constructor(private readonly committee: CommitteeService) {}

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get()
  list(@Param('communityId') c: string, @Req() req: any) {
    return this.committee.listDecisions(c, req.user?.id ?? req.user?.sub)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post()
  create(@Param('communityId') c: string, @Body() body: any, @Req() req: any) {
    return this.committee.createDecision(c, req.user?.id ?? req.user?.sub, body)
  }

  @Scopes({ role: 'EXECUTIVE_COMITEE_MEMBER', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post(':id/vote')
  vote(@Param('communityId') c: string, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.committee.vote(c, id, req.user?.id ?? req.user?.sub, body?.vote, body?.comment)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post(':id/cancel')
  cancel(@Param('communityId') c: string, @Param('id') id: string) {
    return this.committee.cancel(c, id)
  }
}
