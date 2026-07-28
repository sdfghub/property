import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { BeFinancialsService } from './be-financials.service'
import { BeQueryService } from '../billing/be-query.service'

type Grouping = 'MEMBER' | 'SPLIT_GROUP'

// These allocation drilldowns expose a BE's financials, so they must be authenticated and
// ownership-checked (community admin OR a member of the BE) — reusing BeQueryService.assertBeAccess,
// the single source of truth for per-BE access.
@Controller('communities/be/:beId/periods/:periodCode/allocations')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class BeFinancialsController {
  constructor(
    private readonly svc: BeFinancialsService,
    private readonly beq: BeQueryService,
  ) {}

  private access(req: any, beId: string) {
    return this.beq.assertBeAccess(beId, req.user?.roles ?? [], req.user?.sub ?? req.user?.id)
  }

  @Get('aggregate')
  async aggregate(
    @Param('beId') beId: string,
    @Param('periodCode') periodCode: string,
    @Query('groupBy') groupBy: Grouping,
    @Req() req: any,
  ) {
    await this.access(req, beId)
    const grouping = (groupBy || 'MEMBER') as Grouping
    if (grouping === 'SPLIT_GROUP') {
      return this.svc.aggregateBySplitGroup(beId, periodCode)
    }
    return this.svc.aggregateByMember(beId, periodCode)
  }

  @Get('drill/member/:unitId')
  async drillMember(
    @Param('beId') beId: string,
    @Param('periodCode') periodCode: string,
    @Param('unitId') unitId: string,
    @Req() req: any,
  ) {
    await this.access(req, beId)
    return this.svc.drillUnitToSplitGroup(beId, periodCode, unitId)
  }

  @Get('drill/split-group/:splitGroupId')
  async drillSplitGroup(
    @Param('beId') beId: string,
    @Param('periodCode') periodCode: string,
    @Param('splitGroupId') splitGroupId: string,
    @Req() req: any,
    @Query('unitId') unitId?: string,
  ) {
    await this.access(req, beId)
    if (unitId) {
      // further drill to allocation lines for a specific unit within this split group
      return this.svc.drillAllocations(beId, periodCode, unitId, splitGroupId)
    }
    return this.svc.drillSplitGroupToUnit(beId, periodCode, splitGroupId)
  }

  @Get('drill/detail/:unitId/:splitGroupId')
  async drillDetail(
    @Param('beId') beId: string,
    @Param('periodCode') periodCode: string,
    @Param('unitId') unitId: string,
    @Param('splitGroupId') splitGroupId: string,
    @Req() req: any,
  ) {
    await this.access(req, beId)
    return this.svc.drillAllocations(beId, periodCode, unitId, splitGroupId)
  }
}

@Controller('communities/:communityId/periods/:periodCode/allocations')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CommunityAllocationsController {
  constructor(private readonly svc: BeFinancialsService) {}

  // Community-wide allocation detail — governance roles only (this is the admin avizier drilldown).
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('detail')
  drillDetailByCommunity(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Query('unitId') unitId: string,
    @Query('splitGroupId') splitGroupId: string,
  ) {
    return this.svc.drillAllocationsByCommunity(communityId, periodCode, unitId, splitGroupId)
  }
}
