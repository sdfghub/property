import { Controller, Get, Req, UseGuards, Delete, Param, Post, Body } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { CommunityService } from './community.service'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { Query } from '@nestjs/common'

@Controller('communities')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CommunityController {
  constructor(private svc: CommunityService) {}

  @Get()
  async list(@Req() req: any, @Query('q') q?: string) {
    // Support either req.user.id or req.user.sub (depending on your JWT)
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listForUser(userId, q)
  }

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Post()
  async create(@Body() body: any) {
    return this.svc.createCommunity(body)
  }

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Get(':communityId/admins')
  async admins(@Param('communityId') communityId: string) {
    return this.svc.listAdmins(communityId)
  }

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Delete(':communityId/admins/:userId')
  async revoke(
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
  ) {
    return this.svc.revokeAdmin(communityId, userId)
  }

  @UseGuards(JwtAuthGuard, ScopesGuard)
  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get(':communityId/billing-entities/responsibles')
  async beResponsibles(@Param('communityId') communityId: string) {
    return this.svc.listBillingEntityResponsibles(communityId)
  }
}
