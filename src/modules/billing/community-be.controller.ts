import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common'
import { BillingPeriodLookupService } from './period-lookup.service'
import { BeQueryService } from './be-query.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'

@Controller('communities/:communityId/periods/:periodCode/billing-entities')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CommunityBillingEntityController {
  constructor(private readonly periods: BillingPeriodLookupService, private readonly beQueries: BeQueryService) {}

  @Get()
  list(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.beQueries.listBillingEntities(communityId, periodCode, req.user?.roles ?? [], req.user?.sub ?? req.user?.id)
  }

  @Get(':beCode')
  members(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('beCode') beCode: string,
    @Req() req: any,
  ) {
    return this.beQueries.getBillingEntityMembers(communityId, periodCode, beCode, req.user?.roles ?? [], req.user?.sub ?? req.user?.id)
  }

  @Get(':beCode/allocations')
  allocations(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('beCode') beCode: string,
    @Req() req: any,
  ) {
    return this.beQueries.getBillingEntityAllocations(communityId, periodCode, beCode, req.user?.roles ?? [], req.user?.sub ?? req.user?.id)
  }

  @Get(':beCode/members/:unitCode/allocations')
  memberAllocations(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('beCode') beCode: string,
    @Param('unitCode') unitCode: string,
    @Req() req: any,
  ) {
    return this.beQueries.getBillingEntityMemberAllocations(communityId, periodCode, beCode, unitCode, req.user?.roles ?? [], req.user?.sub ?? req.user?.id)
  }
}
