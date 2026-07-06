import { Body, Controller, Post, UseGuards, Req, Get, Param, Delete, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { InviteService } from './invite.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ScopesGuard } from '../../common/guards/scopes.guard'

@Controller('invites')
export class InviteController{
  constructor(private readonly invites:InviteService){}

  private isSystemAdmin(roles: Array<{ role: string; scopeType: string }>) {
    return roles.some((r) => r.role === 'SYSTEM_ADMIN' && r.scopeType === 'SYSTEM')
  }

  private isCommunityAdmin(roles: Array<{ role: string; scopeType: string; scopeId?: string | null }>, communityId: string) {
    return roles.some(
      (r) => r.role === 'COMMUNITY_ADMIN' && r.scopeType === 'COMMUNITY' && r.scopeId && r.scopeId === communityId,
    )
  }

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'SYSTEM_ADMIN', scopeType:'SYSTEM' })
  @Post()
  createSystemInvite(@Body() body:any, @Req() req:any){
    const { email, role, scopeType, scopeId, beRoles } = body
    const inviterId = req?.user?.sub
    if (!inviterId) {
      throw new UnauthorizedException('Missing auth user')
    }
    return this.invites.createInvite(email, role, scopeType, scopeId, inviterId, beRoles)
  }

  @UseGuards(JwtAuthGuard)
  @Post('community/:communityId')
  createCommunityInvite(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    const { email, role } = body
    const inviterId = req?.user?.sub
    if (!inviterId) throw new UnauthorizedException('Missing auth user')
    const roles = Array.isArray(req?.user?.roles) ? req.user.roles : []
    if (!this.isSystemAdmin(roles) && !this.isCommunityAdmin(roles, communityId)) {
      throw new ForbiddenException('Community admin required')
    }
    const normalizedRole = (role || 'COMMUNITY_ADMIN') as any
    const allowedCommunityRoles = ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER']
    if (!allowedCommunityRoles.includes(normalizedRole)) {
      throw new ForbiddenException('Unsupported community role')
    }
    return this.invites.createInvite(email, normalizedRole, 'COMMUNITY', communityId, inviterId)
  }

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'COMMUNITY_ADMIN', scopeType:'COMMUNITY', scopeParam:'communityId' })
  @Get('community/:communityId/pending')
  async pendingForCommunity(@Param('communityId') communityId:string){
    return this.invites.pendingForCommunity(communityId)
  }

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'COMMUNITY_ADMIN', scopeType:'COMMUNITY', scopeParam:'communityId' })
  @Delete('community/:communityId/pending/:inviteId')
  async deletePending(@Param('inviteId') inviteId:string){
    return this.invites.deletePending(inviteId)
  }

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'SYSTEM_ADMIN', scopeType:'SYSTEM' })
  @Get('billing-entity/:beId/pending')
  async pendingForBe(@Param('beId') beId:string){
    return this.invites.pendingForBe(beId)
  }

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'SYSTEM_ADMIN', scopeType:'SYSTEM' })
  @Delete('billing-entity/:beId/pending/:inviteId')
  async deletePendingBe(@Param('inviteId') inviteId:string){
    return this.invites.deletePending(inviteId)
  }

  @Get(':token')
  async summary(@Param('token') token: string){
    return this.invites.getInviteSummary(token)
  }

  @UseGuards(JwtAuthGuard)
  @Post('claim')
  async claim(@Body('token') token: string, @Req() req: any){
    const userId = req?.user?.sub
    if (!userId) {
      throw new UnauthorizedException('Missing auth user')
    }
    return this.invites.claimInviteForUser(token, userId)
  }
}
