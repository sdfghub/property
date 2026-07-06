import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { ExpenseTypeService } from './expense-type.service'

@Controller('communities/:communityId/expense-types')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class ExpenseTypeController {
  constructor(private readonly expenseTypes: ExpenseTypeService) {}

  @Post()
  upsert(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    return this.expenseTypes.upsertExpenseType(communityId, req.user?.roles ?? [], body)
  }
}
