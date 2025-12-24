import { Body, Controller, Post, UseGuards, Req, Get, Param, Delete, UnauthorizedException } from '@nestjs/common'
import { InviteService } from './invite.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ScopesGuard } from '../../common/guards/scopes.guard'

@Controller('invites')
export class InviteController{
  constructor(private readonly invites:InviteService){}

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'SYSTEM_ADMIN', scopeType:'SYSTEM' })
  @Post()
  createSystemInvite(@Body() body:any, @Req() req:any){
    const { email, role, scopeType, scopeId } = body
    const inviterId = req?.user?.sub
    if (!inviterId) {
      throw new UnauthorizedException('Missing auth user')
    }
    return this.invites.createInvite(email, role, scopeType, scopeId, inviterId)
  }

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'SYSTEM_ADMIN', scopeType:'SYSTEM' })
  @Get('community/:communityId/pending')
  async pendingForCommunity(@Param('communityId') communityId:string){
    return this.invites.pendingForCommunity(communityId)
  }

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'SYSTEM_ADMIN', scopeType:'SYSTEM' })
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
