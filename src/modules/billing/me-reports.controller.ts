import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { MeReportsService } from './me-reports.service'

/**
 * Resident-facing association reports. No @Scopes — access is enforced in the service by
 * billing-entity sub-role (OWNER/EXPENSE_RESPONSIBLE) against the caller's own memberships, so a
 * client-supplied billing entity can never widen the view. Reports are whole-community and
 * closed-period only.
 */
@Controller('me/communities/:communityId')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class MeReportsController {
  constructor(private readonly svc: MeReportsService) {}

  private ctx(req: any) {
    return { userId: req.user?.id ?? req.user?.sub, roles: req.user?.roles ?? [] }
  }

  @Get('capabilities')
  capabilities(@Param('communityId') c: string, @Req() req: any) {
    const { userId, roles } = this.ctx(req)
    return this.svc.capabilities(userId, c, roles)
  }

  @Get('avizier')
  avizier(@Param('communityId') c: string, @Req() req: any, @Query('period') period?: string) {
    const { userId, roles } = this.ctx(req)
    return this.svc.avizier(userId, c, roles, period)
  }

  @Get('collection-rate')
  collectionRate(
    @Param('communityId') c: string,
    @Req() req: any,
    @Query('period') period?: string,
    @Query('domain') domain?: string,
  ) {
    const { userId, roles } = this.ctx(req)
    return this.svc.collectionRate(userId, c, roles, period, domain)
  }

  @Get('vendor-invoices/unpaid')
  unpaidVendorInvoices(@Param('communityId') c: string, @Req() req: any) {
    const { userId, roles } = this.ctx(req)
    return this.svc.unpaidVendorInvoices(userId, c, roles)
  }

  @Get('funds')
  funds(@Param('communityId') c: string, @Req() req: any) {
    const { userId, roles } = this.ctx(req)
    return this.svc.funds(userId, c, roles)
  }

  @Get('funds/:fundId/ledger')
  fundLedger(@Param('communityId') c: string, @Param('fundId') fundId: string, @Req() req: any) {
    const { userId, roles } = this.ctx(req)
    return this.svc.fundLedger(userId, c, roles, fundId)
  }
}
