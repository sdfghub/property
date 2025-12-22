import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { PaymentService } from './payment.service'

@Controller('communities/:communityId/payments')
export class PaymentController {
  constructor(private readonly svc: PaymentService) {}

  @Get()
  list(@Param('communityId') communityId: string) {
    return this.svc.listPayments(communityId)
  }

  @Get(':id')
  get(@Param('communityId') communityId: string, @Param('id') id: string) {
    return this.svc.getPayment(communityId, id)
  }

  @Post()
  create(@Param('communityId') communityId: string, @Body() body: any) {
    return this.svc.createOrApply(communityId, body)
  }

  @Post(':id/apply')
  reapply(@Param('communityId') communityId: string, @Param('id') id: string) {
    return this.svc.reapply(communityId, id)
  }
}
