import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { BeQueryService } from './be-query.service'

@Controller('communities/:communityId')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CommunityDueController {
  constructor(private readonly beQueries: BeQueryService) {}

  @Get('current-due')
  currentDue(
    @Param('communityId') communityId: string,
    @Query('beId') beId: string | undefined,
    @Query('bucket') bucket: string | undefined,
    @Query('unitId') unitId: string | undefined,
    @Req() req: any,
  ) {
    return this.beQueries.getCurrentDue(
      communityId,
      { beId, bucket, unitId },
      req.user?.roles ?? [],
      req.user?.sub ?? req.user?.id,
    )
  }
}
