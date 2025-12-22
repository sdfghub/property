import { Controller, Get, Param } from '@nestjs/common'
import { ProgramService } from './program.service'

@Controller('communities/:communityId/programs')
export class ProgramController {
  constructor(private readonly svc: ProgramService) {}

  @Get()
  listBalances(@Param('communityId') communityId: string) {
    return this.svc.listBalances(communityId)
  }

  @Get(':programId/invoices')
  listInvoices(@Param('communityId') communityId: string, @Param('programId') programId: string) {
    return this.svc.listInvoices(communityId, programId)
  }

  @Get(':programId/ledger')
  ledger(@Param('communityId') communityId: string, @Param('programId') programId: string) {
    return this.svc.ledgerEntries(communityId, programId)
  }
}
