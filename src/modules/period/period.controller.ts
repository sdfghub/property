import { Controller, Param, Post, UseGuards } from '@nestjs/common'
import { PeriodService } from './period.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ScopesGuard } from '../../common/guards/scopes.guard'

@Controller('api/communities/:communityId/periods/:periodCode')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class PeriodController {
  constructor(private readonly periods: PeriodService) {}

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('prepare')
  prepare(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.prepare(c, p)
  }

  @Scopes({ role: 'CENSOR', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('approve')
  approve(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.approve(c, p)
  }

  @Scopes({ role: 'CENSOR', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('reject')
  reject(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.reject(c, p)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('reopen')
  reopen(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.reopen(c, p)
  }
}
