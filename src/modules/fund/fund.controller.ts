import { Feature } from '../../common/decorators/feature.decorator'
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { FundService } from './fund.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'

@Controller('communities/:communityId/funds')
@Feature('funds')
export class FundController {
  constructor(private readonly svc: FundService) {}

  @Get()
  listBalances(@Param('communityId') communityId: string) {
    return this.svc.listBalances(communityId)
  }

  @Get(':fundId/invoices')
  listInvoices(@Param('communityId') communityId: string, @Param('fundId') fundId: string) {
    return this.svc.listInvoices(communityId, fundId)
  }

  @Get(':fundId/ledger')
  ledger(@Param('communityId') communityId: string, @Param('fundId') fundId: string) {
    return this.svc.ledgerEntries(communityId, fundId)
  }

  @Post('import')
  @UseGuards(JwtAuthGuard, ScopesGuard)
  importFunds(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    return this.svc.importFunds(communityId, req.user?.roles ?? [], body)
  }

  @Post()
  @UseGuards(JwtAuthGuard, ScopesGuard)
  create(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    return this.svc.createFund(communityId, req.user?.roles ?? [], body)
  }

  @Patch(':fundId')
  @UseGuards(JwtAuthGuard, ScopesGuard)
  update(@Param('communityId') communityId: string, @Param('fundId') fundId: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateFund(communityId, fundId, req.user?.roles ?? [], body)
  }
}
