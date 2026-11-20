import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { BudgetService } from './budget.service'

/** Budget vs Forecast vs Actual — read routes (docs/budget.md). Lines are loaded by `npm run import:budget`. */
@Controller('communities/:communityId/budget')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get()
  get(@Param('communityId') c: string, @Query('version') version?: string, @Query('years') years?: string, @Query('currency') currency?: string) {
    return this.budget.getBudget(c, version, { years, currency })
  }

  /** Edit one year's EUR rate: a rate, or "fund X has Y EUR in that year" (rate = fund budget ÷ Y). */
  @Scopes({ role: ['COMMUNITY_ADMIN'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Patch('fx-rates')
  setFx(@Param('communityId') c: string, @Body() body: { version?: string; year: string; rate?: number; fundCode?: string; eur?: number }) {
    return this.budget.setFxRate(c, body)
  }

  /** One line: its calculation, evidence, months and the per-unit split. */
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('lines/:lineId')
  line(@Param('communityId') c: string, @Param('lineId') lineId: string) {
    return this.budget.getLine(c, lineId)
  }
}
