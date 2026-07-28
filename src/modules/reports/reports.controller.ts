import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ReportsService } from './reports.service'

@Controller('communities/:communityId/reports')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * Collection rate ("grad de colectare") cumulative up to `period`, optionally restricted to a
   * single fund domain (`operational` | `tactic` | `strategic` | `other`).
   */
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('collection-rate')
  collectionRate(
    @Param('communityId') c: string,
    @Query('period') period?: string,
    @Query('domain') domain?: string,
  ) {
    return this.reports.collectionRate(c, period, domain)
  }

  /**
   * Risk exposure ("risc de expunere"): each billing entity's oldest unpaid arrear age → risk tier
   * (fără risc / penalități / sarcină în CF / acțiune în instanță), measured from the scadență.
   */
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('risk')
  riskExposure(@Param('communityId') c: string, @Query('period') period?: string) {
    return this.reports.riskExposure(c, period)
  }
}
