import { Body, Controller, Post, UseGuards, Req, Res, Get, Param, Delete } from '@nestjs/common'
import { InviteService } from './invite.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Response } from 'express'

@Controller('invites')
export class InviteController{
  constructor(private readonly invites:InviteService){}

  @UseGuards(JwtAuthGuard,ScopesGuard)
  @Scopes({ role:'SYSTEM_ADMIN', scopeType:'SYSTEM' })
  @Post()
  createSystemInvite(@Body() body:any, @Req() req:any){
    const { email, role, scopeType, scopeId } = body
    const inviterId=req.user.sub
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

  @Post('accept')
  async accept(@Body('token') token:string, @Body('name') name:string|undefined, @Req() req:any, @Res({passthrough:true}) res:Response){
    const result = await this.invites.acceptInvite(token, name, req.headers['user-agent'] as string, req.ip)
    if (result.refreshToken) {
      res.cookie('refresh_token', result.refreshToken, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 30 * 24 * 3600 * 1000 })
    }
    return result
  }
}
