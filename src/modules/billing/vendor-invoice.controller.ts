import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { VendorInvoiceService } from './vendor-invoice.service'

@Controller('communities/:communityId/invoices')
@UseGuards(JwtAuthGuard, ScopesGuard)
@Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
export class VendorInvoiceController {
  constructor(private readonly svc: VendorInvoiceService) {}

  @Get()
  list(@Param('communityId') communityId: string) {
    return this.svc.listInvoices(communityId)
  }

  // Dashboard read — broader than the class-level admin-only scope so censor/committee viewers
  // (who already see other finance widgets there) can see the payables summary too.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('summary')
  summary(@Param('communityId') communityId: string, @Query('period') period?: string) {
    return this.svc.invoiceSummaryForPeriod(communityId, period)
  }

  @Get(':id')
  get(@Param('communityId') communityId: string, @Param('id') id: string) {
    return this.svc.getInvoice(communityId, id)
  }

  @Post()
  create(@Param('communityId') communityId: string, @Body() body: any) {
    return this.svc.createInvoice(communityId, body)
  }

  @Patch(':id')
  update(@Param('communityId') communityId: string, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateInvoice(communityId, id, body)
  }

  @Post(':id/fund-links')
  linkFund(
    @Param('communityId') communityId: string,
    @Param('id') invoiceId: string,
    @Body() body: { fundId: string; amount?: number; portionKey?: string; notes?: any },
  ) {
    return this.svc.linkFund(communityId, invoiceId, body)
  }

  @Post(':id/fund-links/remove')
  unlinkFund(
    @Param('communityId') communityId: string,
    @Param('id') invoiceId: string,
    @Body() body: { fundId: string; portionKey?: string },
  ) {
    return this.svc.unlinkFund(communityId, invoiceId, body.fundId, body.portionKey ?? null)
  }

  @Post(':id/payments')
  pay(
    @Param('communityId') communityId: string,
    @Param('id') invoiceId: string,
    @Body() body: any,
  ) {
    return this.svc.createVendorPayment(communityId, invoiceId, body)
  }

  @Patch(':id/payments/:paymentId')
  updatePayment(
    @Param('communityId') communityId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: any,
  ) {
    return this.svc.updateVendorPayment(communityId, paymentId, body)
  }

  @Delete(':id/payments/:paymentId')
  deletePayment(
    @Param('communityId') communityId: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.svc.deleteVendorPayment(communityId, paymentId)
  }
}

// #18 "Configurare furnizori" — separate route prefix from the invoices controller above, same
// underlying service (VendorInvoiceService already owns Vendor resolution via resolveVendor).
@Controller('communities/:communityId/vendors')
@UseGuards(JwtAuthGuard, ScopesGuard)
@Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
export class VendorController {
  constructor(private readonly svc: VendorInvoiceService) {}

  @Get()
  list(@Param('communityId') communityId: string) {
    return this.svc.listVendors(communityId)
  }

  @Post()
  create(@Param('communityId') communityId: string, @Body() body: any) {
    return this.svc.createVendor(communityId, body)
  }

  @Patch(':vendorId')
  update(
    @Param('communityId') communityId: string,
    @Param('vendorId') vendorId: string,
    @Body() body: any,
  ) {
    return this.svc.updateVendor(communityId, vendorId, body)
  }
}
