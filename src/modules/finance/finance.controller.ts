import { Controller, Get, Post, Param, Query, Body, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { FinanceService } from './finance.service'
import { PeriodService } from '../period/period.service'

@Controller('communities/:communityId/finance')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService, private readonly periods: PeriodService) {}

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('receivables')
  receivables(@Param('communityId') c: string, @Query('period') period?: string) {
    return this.finance.receivables(c, period)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('vendor-invoices/unpaid')
  unpaidVendorInvoices(@Param('communityId') c: string) {
    return this.finance.unpaidVendorInvoices(c)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('funds-status')
  fundsStatus(@Param('communityId') c: string) {
    return this.finance.fundsStatus(c)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('avizier')
  avizier(@Param('communityId') c: string, @Query('period') period?: string) {
    return this.finance.avizier(c, period)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('avizier/explain')
  explainCell(
    @Param('communityId') c: string,
    @Query('period') period: string,
    @Query('be') be: string,
    @Query('category') category: string,
  ) {
    return this.finance.explainCell(c, period, be, category)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('avizier/explain-sold')
  explainSold(
    @Param('communityId') c: string,
    @Query('period') period: string,
    @Query('be') be: string,
  ) {
    return this.finance.explainSold(c, period, be)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('avizier/payments')
  paymentsLog(
    @Param('communityId') c: string,
    @Query('period') period: string,
    @Query('be') be: string,
  ) {
    return this.finance.paymentsLog(c, period, be)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('avizier/adjustments')
  explainAdjustments(
    @Param('communityId') c: string,
    @Query('period') period: string,
    @Query('be') be: string,
  ) {
    return this.finance.explainAdjustments(c, period, be)
  }

  // Manual charge override (generic; PENALIZARI = penalty). Admin-only, applied on a PREPARED period,
  // realized as two ADJUSTMENT legs (−computed, +override) with a mandatory comment + audit trail.
  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('avizier/charge-override')
  overrideCharge(
    @Param('communityId') c: string,
    @Body() body: { period: string; be: string; fund?: string; amount: number | null; comment: string },
    @Req() req: any,
  ) {
    return this.periods.overrideCharge(c, body.period, { be: body.be, fund: body.fund, amount: body.amount, comment: body.comment }, req?.user?.email || 'unknown')
  }

  // Focused penalty-review list (close wizard) — computed penalty + active override per BE.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('penalties')
  penaltyReview(@Param('communityId') c: string, @Query('period') period?: string) {
    return this.finance.penaltyReview(c, period as string)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('avizier/charge-override')
  chargeOverrideHistory(
    @Param('communityId') c: string,
    @Query('period') period: string,
    @Query('be') be: string,
    @Query('fund') fund?: string,
  ) {
    return this.finance.chargeOverrideHistory(c, period, be, fund || 'PENALIZARI')
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('avizier/explain-penalty')
  explainPenalty(
    @Param('communityId') c: string,
    @Query('period') period: string,
    @Query('be') be: string,
    @Query('fund') fund?: string,
  ) {
    return this.finance.explainPenalty(c, period, be, fund)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('collection')
  collection(@Param('communityId') c: string, @Query('period') period?: string) {
    return this.finance.collection(c, period)
  }
}
