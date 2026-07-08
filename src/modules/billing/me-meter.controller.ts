import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { MeMeterService } from './me-meter.service'

/**
 * Resident self-service meter readings. No @Scopes — any authenticated user; ownership is enforced
 * in MeMeterService by the caller's billing-entity/unit membership (mirrors MePaymentController).
 */
@Controller('me/communities/:communityId')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class MeMeterController {
  constructor(private readonly svc: MeMeterService) {}

  @Get('periods/:periodCode/meters')
  list(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.svc.listMyMeters(req.user?.id ?? req.user?.sub, communityId, periodCode)
  }

  @Post('periods/:periodCode/meters')
  submit(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Body() body: any, @Req() req: any) {
    return this.svc.submitMyReading(
      req.user?.id ?? req.user?.sub,
      req.user?.roles ?? [],
      communityId,
      periodCode,
      body?.meterId,
      Number(body?.value),
    )
  }
}
