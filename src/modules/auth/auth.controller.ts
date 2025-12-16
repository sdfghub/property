import { Body, Controller, Post, Res, UseGuards, Req, Logger } from '@nestjs/common'
import { AuthService } from './auth.service'
import { Response, Request } from 'express'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'

@Controller('auth')
export class AuthController{
  private readonly logger = new Logger(AuthController.name)
  constructor(private readonly auth:AuthService){}

  @Post('request-link')
  async request(@Body('email') email:string){
    return this.auth.requestMagicLink(email)
  }

  @Post('consume-link')
  async consume(@Body('token') token:string, @Req() req:Request, @Res({passthrough:true}) res:Response){
    this.logger.log(`consume-link hit token=${token?.slice(0,8) ?? 'null'}... ip=${req.ip}`)
    const {accessToken, refreshToken, user}=await this.auth.consumeMagicToken(token, req.headers['user-agent'] as string, req.ip)
    res.cookie('refresh_token',refreshToken,{ httpOnly:true, sameSite:'lax', secure:false, maxAge:30*24*3600*1000 })
    return { accessToken, user }
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
