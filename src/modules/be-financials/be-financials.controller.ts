import { Controller, Get, Param, Query } from '@nestjs/common'
import { BeFinancialsService } from './be-financials.service'

type Grouping = 'MEMBER' | 'SPLIT_GROUP'

@Controller('communities/be/:beId/periods/:periodCode/allocations')
export class BeFinancialsController {
  constructor(private readonly svc: BeFinancialsService) {}

  @Get('aggregate')
  aggregate(
    @Param('beId') beId: string,
    @Param('periodCode') periodCode: string,
    @Query('groupBy') groupBy: Grouping,
  ) {
    const grouping = (groupBy || 'MEMBER') as Grouping
    if (grouping === 'SPLIT_GROUP') {
      return this.svc.aggregateBySplitGroup(beId, periodCode)
    }
    return this.svc.aggregateByMember(beId, periodCode)
  }

  @Get('drill/member/:unitId')
  drillMember(
    @Param('beId') beId: string,
    @Param('periodCode') periodCode: string,
    @Param('unitId') unitId: string,
  ) {
    return this.svc.drillUnitToSplitGroup(beId, periodCode, unitId)
  }

  @Get('drill/split-group/:splitGroupId')
  drillSplitGroup(
    @Param('beId') beId: string,
    @Param('periodCode') periodCode: string,
    @Param('splitGroupId') splitGroupId: string,
  ) {
    return this.svc.drillSplitGroupToUnit(beId, periodCode, splitGroupId)
  }

  @Get('drill/detail/:unitId/:splitGroupId')
  drillDetail(
    @Param('beId') beId: string,
    @Param('periodCode') periodCode: string,
    @Param('unitId') unitId: string,
    @Param('splitGroupId') splitGroupId: string,
  ) {
    return this.svc.drillAllocations(beId, periodCode, unitId, splitGroupId)
  }
}
