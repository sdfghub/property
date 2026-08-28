import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { CashService } from './cash.service'

@Controller('communities/:communityId')
@UseGuards(JwtAuthGuard, ScopesGuard)
@Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('cash-accounts')
  listAccounts(@Param('communityId') communityId: string) {
    return this.cash.listAccounts(communityId)
  }

  // Dashboard read — broader than the class-level admin-only scope so censor/committee viewers
  // (who already see other finance widgets there) can see bank/cash balances too.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('cash-accounts/balances')
  getBalances(@Param('communityId') communityId: string) {
    return this.cash.getBalances(communityId)
  }

  @Post('cash-accounts')
  createAccount(@Param('communityId') communityId: string, @Body() body: any) {
    return this.cash.createAccount(communityId, body)
  }

  // Dashboard drilldown ("Sold Bancă/Numerar" and "Încasări" cards) — same broader scope as balances.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('cash-tx')
  listTx(@Param('communityId') communityId: string, @Query() query: any) {
    return this.cash.listTx(communityId, query)
  }

  @Post('cash-tx')
  createTx(@Param('communityId') communityId: string, @Body() body: any) {
    return this.cash.createTx(communityId, body)
  }
}
