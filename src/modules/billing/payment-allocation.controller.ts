import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { PaymentAllocationService } from './payment-allocation.service'

@Controller('communities/:communityId/payment-allocation')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class PaymentAllocationController {
  constructor(private readonly svc: PaymentAllocationService) {}

  // Community admins/censors may view the strategy; the UI needs it to render.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get()
  get(@Param('communityId') communityId: string) {
    return this.svc.get(communityId)
  }

  // Setting the allocation order is an association policy (Civil Code art. 1506) → community admin.
  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post()
  set(@Param('communityId') communityId: string, @Body() body: any) {
    return this.svc.set(communityId, body || {})
  }
}
