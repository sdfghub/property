import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ProgramService } from './program.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'

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

  @Post('import')
  @UseGuards(JwtAuthGuard, ScopesGuard)
  importPrograms(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    return this.svc.importPrograms(communityId, req.user?.roles ?? [], body)
  }
}
