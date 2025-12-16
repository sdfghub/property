import { Controller, Get, Param, Req } from '@nestjs/common'
import { BillingPeriodLookupService } from './period-lookup.service'
import { BeQueryService } from './be-query.service'

@Controller('communities/be')
export class BillingBeController {
  constructor(
    private readonly periods: BillingPeriodLookupService,
    private readonly beQueries: BeQueryService,
  ) {}

  @Get(':beId/periods/closed')
  listClosed(@Param('beId') beId: string, @Req() req: any) {
    return this.periods.listClosedForBe(beId)
  }

  @Get(':beId/periods')
  listAll(@Param('beId') beId: string, @Req() req: any) {
    return this.periods.listAllForBe(beId)
  }

  @Get(':beId/periods/:periodCode/allocations')
  allocations(@Param('beId') beId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.beQueries.getAllocationsByBeId(beId, periodCode, req.user?.roles ?? [])
  }

  @Get(':beId/periods/:periodCode/financials')
  financials(@Param('beId') beId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.beQueries.getFinancials(beId, periodCode, req.user?.roles ?? [])
  }
}
