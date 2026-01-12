import { Body, Controller, Post, Res, UseGuards, Req } from '@nestjs/common'
import { AuthService } from './auth.service'
import { Response, Request } from 'express'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { InviteService } from '../invite/invite.service'

@Controller('auth')
export class AuthController{
  constructor(private readonly auth:AuthService, private readonly invites: InviteService){}

  @Post('register')
  async register(
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('name') name: string | undefined,
    @Body('inviteToken') inviteToken: string | undefined,
    @Req() req: Request,
    @Res({passthrough:true}) res: Response,
  ){
    const user = await this.auth.registerWithPassword(email, password, name, inviteToken)
    if (inviteToken) await this.invites.claimInviteForUser(inviteToken, user.id)
    const { accessToken, refreshToken } = await this.auth.issueTokensForUser(user, req.headers['user-agent'] as string, req.ip)
    res.cookie('refresh_token',refreshToken,{ httpOnly:true, sameSite:'lax', secure:false, maxAge:30*24*3600*1000 })
    return { accessToken, refreshToken, user }
  }

  @Post('login')
  async login(
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('inviteToken') inviteToken: string | undefined,
    @Req() req: Request,
    @Res({passthrough:true}) res: Response,
  ){
    const user = await this.auth.loginWithPassword(email, password)
    if (inviteToken) await this.invites.claimInviteForUser(inviteToken, user.id)
    const { accessToken, refreshToken } = await this.auth.issueTokensForUser(user, req.headers['user-agent'] as string, req.ip)
    res.cookie('refresh_token',refreshToken,{ httpOnly:true, sameSite:'lax', secure:false, maxAge:30*24*3600*1000 })
    return { accessToken, refreshToken, user }
  }

  @Post('oauth')
  async oauth(
    @Body('provider') provider: 'GOOGLE'|'APPLE'|'FACEBOOK'|'MICROSOFT',
    @Body('providerUserId') providerUserId: string,
    @Body('email') email: string | undefined,
    @Body('name') name: string | undefined,
    @Body('inviteToken') inviteToken: string | undefined,
    @Req() req: Request,
    @Res({passthrough:true}) res: Response,
  ){
    const user = await this.auth.loginWithOAuth(provider, providerUserId, email, name, inviteToken)
    if (inviteToken) await this.invites.claimInviteForUser(inviteToken, user.id)
    const { accessToken, refreshToken } = await this.auth.issueTokensForUser(user, req.headers['user-agent'] as string, req.ip)
    res.cookie('refresh_token',refreshToken,{ httpOnly:true, sameSite:'lax', secure:false, maxAge:30*24*3600*1000 })
    return { accessToken, refreshToken, user }
  }

  @Post('refresh')
  async refresh(@Res({passthrough:true}) res:Response, @Body('refreshToken') bodyToken?:string){
    const cookie=(res.req as any).cookies?.['refresh_token']
    const token=bodyToken||cookie
    return this.auth.refresh(token)
  }

  @Post('logout')
  async logout(@Res({passthrough:true}) res:Response, @Body('refreshToken') bodyToken?:string){
    const cookie=(res.req as any).cookies?.['refresh_token']
    await this.auth.logout(bodyToken||cookie)
    res.clearCookie('refresh_token')
    return { ok:true }
  }

  @UseGuards(JwtAuthGuard)
  @Post('revoke-all')
  async revokeAll(@Req() req:any){
    return this.auth.revokeAllSessions(req.user.sub)
  }
}
