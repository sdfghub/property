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

  @Post('cash-accounts')
  createAccount(@Param('communityId') communityId: string, @Body() body: any) {
    return this.cash.createAccount(communityId, body)
  }

  @Get('cash-tx')
  listTx(@Param('communityId') communityId: string, @Query() query: any) {
    return this.cash.listTx(communityId, query)
  }

  @Post('cash-tx')
  createTx(@Param('communityId') communityId: string, @Body() body: any) {
    return this.cash.createTx(communityId, body)
  }
}
