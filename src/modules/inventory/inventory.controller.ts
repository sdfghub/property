import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { InventoryService } from './inventory.service'

@Controller('communities/:communityId/inventory')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get('assets')
  listAssets(@Param('communityId') communityId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listAssets(communityId, userId, req.user?.roles ?? [])
  }

  @Post('assets')
  createAsset(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.createAsset(communityId, userId, req.user?.roles ?? [], body)
  }

  @Post('assets/:assetId/rules')
  createRule(
    @Param('communityId') communityId: string,
    @Param('assetId') assetId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.createRule(communityId, assetId, userId, req.user?.roles ?? [], body)
  }

  @Get('rules')
  listRules(@Param('communityId') communityId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listRules(communityId, userId, req.user?.roles ?? [])
  }

  @Post('rules/:ruleId/run')
  runRule(
    @Param('communityId') communityId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.runRule(communityId, ruleId, userId, req.user?.roles ?? [], body)
  }
}
