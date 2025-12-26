import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PushService } from './push.service'

@Controller('push-tokens')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly svc: PushService) {}

  @Get()
  list(@Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listTokens(userId)
  }

  @Post()
  register(@Req() req: any, @Body() body: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.registerToken(userId, {
      token: body.token,
      platform: body.platform,
      deviceInfo: body.deviceInfo,
    })
  }

  @Delete(':id')
  revoke(@Req() req: any, @Param('id') id: string) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.revokeToken(userId, id)
  }

  @Post('test-send')
  testSend(@Req() req: any, @Body() body: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.sendTest(userId, {
      token: body.token,
      title: body.title,
      body: body.body,
      url: body.url,
    })
  }
}
