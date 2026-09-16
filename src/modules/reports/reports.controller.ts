import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
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

  /**
   * Risk exposure v2: every unit, every fund (not just penalty-configured ones), aged and
   * anchored live to the ledger — see `ReportsService.riskExposureDetail`. Backs the rewritten
   * RiskPanel.
   */
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('risk-detail')
  riskExposureDetail(@Param('communityId') c: string, @Query('period') period?: string) {
    return this.reports.riskExposureDetail(c, period)
  }

  /**
   * Admin-only: preview (apply=false, default) or write (apply=true) a penalty-bucket
   * reconciliation, anchoring the aging breakdown back to the live ledger truth — see
   * `PenaltyReconciliationService`. Stricter scope than the read routes above: this can write.
   */
  @Scopes({ role: ['COMMUNITY_ADMIN'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('reconcile-penalties')
  reconcilePenalties(
    @Param('communityId') c: string,
    @Body() body: { periodCode?: string; fundCode?: string; unitCode?: string; apply?: boolean },
  ) {
    return this.reports.reconcilePenalties(c, { periodCode: body?.periodCode, fundCode: body?.fundCode, unitCode: body?.unitCode, apply: body?.apply === true })
  }
}
