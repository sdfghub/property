import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { PaymentService } from './payment.service'

@Controller('communities/:communityId/payments')
@UseGuards(JwtAuthGuard, ScopesGuard)
@Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
export class PaymentController {
  constructor(private readonly svc: PaymentService) {}

  @Get()
  list(@Param('communityId') communityId: string) {
    return this.svc.listPayments(communityId)
  }

  @Get('open-charges')
  openCharges(
    @Param('communityId') communityId: string,
    @Query('billingEntityId') billingEntityId: string,
    @Query('fundId') fundId?: string,
    @Query('unitId') unitId?: string,
  ) {
    return this.svc.getOpenChargeSummary(communityId, billingEntityId, { fundId, unitId })
  }

  @Get(':id')
  get(@Param('communityId') communityId: string, @Param('id') id: string) {
    return this.svc.getPayment(communityId, id)
  }

  @Post()
  create(@Param('communityId') communityId: string, @Body() body: any) {
    return this.svc.createOrApply(communityId, body)
  }

  @Post('intent')
  intent(@Param('communityId') communityId: string, @Body() body: any) {
    return this.svc.createIntent(communityId, body)
  }

  @Post(':id/confirm')
  confirm(@Param('communityId') communityId: string, @Param('id') id: string, @Body() body: any) {
    return this.svc.confirmIntent(communityId, id, body)
  }

  @Post(':id/apply')
  reapply(@Param('communityId') communityId: string, @Param('id') id: string) {
    return this.svc.reapply(communityId, id)
  }

}
