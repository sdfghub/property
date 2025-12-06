import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common'
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
    const inviterId=req.user.sub
    return this.invites.createInvite(email, role, scopeType, scopeId, inviterId)
  }

  @Post('accept')
  accept(@Body('token') token:string, @Body('name') name?:string){
    return this.invites.acceptInvite(token, name)
  }
}
