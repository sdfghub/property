import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { VendorInvoiceService } from './vendor-invoice.service'

@Controller('communities/:communityId/invoices')
export class VendorInvoiceController {
  constructor(private readonly svc: VendorInvoiceService) {}

  @Get()
  list(@Param('communityId') communityId: string) {
    return this.svc.listInvoices(communityId)
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

  @Post(':id/program-links')
  linkProgram(
    @Param('communityId') communityId: string,
    @Param('id') invoiceId: string,
    @Body() body: { programId: string; amount?: number; portionKey?: string; notes?: any },
  ) {
    return this.svc.linkProgram(communityId, invoiceId, body)
  }

  @Post(':id/program-links/remove')
  unlinkProgram(
    @Param('communityId') communityId: string,
    @Param('id') invoiceId: string,
    @Body() body: { programId: string; portionKey?: string },
  ) {
    return this.svc.unlinkProgram(communityId, invoiceId, body.programId, body.portionKey ?? null)
  }
}
