import { Feature } from '../../common/decorators/feature.decorator'
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ServicesService } from './services.service'

@Controller('communities/:communityId/services')
@UseGuards(JwtAuthGuard, ScopesGuard)
@Feature('services')
export class ServicesController {
  constructor(private readonly svc: ServicesService) {}

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get()
  catalog(@Param('communityId') communityId: string, @Query('lang') lang?: string) {
    return this.svc.getCatalog(communityId, lang === 'en' ? 'en' : 'ro')
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get(':itemId/history')
  history(@Param('communityId') communityId: string, @Param('itemId') itemId: string) {
    return this.svc.getHistory(communityId, itemId)
  }

  /** Whole-catalogue order (also applied to the avizier and the budget). */
  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Patch('order')
  order(@Param('communityId') communityId: string, @Body() body: { ids: string[] }) {
    return this.svc.saveOrder(communityId, body?.ids)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get(':itemId/equipment')
  equipment(@Param('communityId') communityId: string, @Param('itemId') itemId: string) {
    return this.svc.getEquipment(communityId, itemId)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Patch(':itemId/equipment')
  setEquipment(@Param('communityId') communityId: string, @Param('itemId') itemId: string, @Body() body: any) {
    return this.svc.setEquipment(communityId, itemId, body)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Patch(':itemId/status')
  status(@Param('communityId') communityId: string, @Param('itemId') itemId: string, @Body() body: { status: string | null }, @Req() req: any) {
    return this.svc.setStatus(communityId, itemId, req.user?.id ?? req.user?.sub ?? null, body?.status)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post(':itemId/assessments')
  assess(
    @Param('communityId') communityId: string,
    @Param('itemId') itemId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.svc.assess(communityId, itemId, req.user?.id ?? req.user?.sub ?? null, body)
  }
}
