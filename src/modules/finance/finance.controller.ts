import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { FinanceService } from './finance.service'

@Controller('communities/:communityId/finance')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

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
