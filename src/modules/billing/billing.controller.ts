import { Controller, Get, Param } from '@nestjs/common';
import { BillingService } from './billing.service';

/**
 * Drill-down API:
 *  - GET /communities/:communityId/periods/:periodCode/billing-entities
 *  - GET /communities/:communityId/periods/:periodCode/billing-entities/:beCode
 *  - GET /communities/:communityId/periods/:periodCode/billing-entities/:beCode/allocations
 */
@Controller('communities/:communityId/periods/:periodCode')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get('billing-entities')
  list(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string) {
    return this.service.listBillingEntities(communityId, periodCode);
  }

  @Get('billing-entities/:beCode')
  members(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('beCode') beCode: string,
  ) {
    return this.service.getBillingEntityMembers(communityId, periodCode, beCode);
  }

  @Get('billing-entities/:beCode/allocations')
  allocations(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('beCode') beCode: string,
  ) {
    return this.service.getBillingEntityAllocations(communityId, periodCode, beCode);
  }

  @Get('billing-entities/:beCode/members/:unitCode/allocations')
  memberAllocations(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('beCode') beCode: string,
    @Param('unitCode') unitCode: string,
  ) {
    return this.service.getBillingEntityMemberAllocations(communityId, periodCode, beCode, unitCode);
  }

}
