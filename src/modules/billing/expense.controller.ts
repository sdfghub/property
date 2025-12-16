import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ExpenseService } from './expense.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'

@Controller('communities/:communityId')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}

  @Get('periods/:periodCode/expense-types')
  listExpenseTypes(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.expenses.listExpenseTypes(communityId, periodCode, req.user?.roles ?? [])
  }

  @Get('periods/:periodCode/expenses')
  listExpenses(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.expenses.listExpenses(communityId, periodCode, req.user?.roles ?? [])
  }

  @Get('periods/:periodCode/expenses/status')
  expenseStatus(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.expenses.expenseStatus(communityId, periodCode, req.user?.roles ?? [])
  }

  @Post('expense-types')
  createExpenseType(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    return this.expenses.createExpenseType(communityId, req.user?.roles ?? [], {
      code: body.code,
      name: body.name,
      method: body.method,
      params: body.params,
      currency: body.currency,
    })
  }

  @Post('periods/:periodCode/expenses')
  createExpense(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Body() body: any, @Req() req: any) {
    return this.expenses.createExpense(communityId, periodCode, req.user?.roles ?? [], {
      description: body.description,
      amount: Number(body.amount),
      currency: body.currency,
      expenseTypeId: body.expenseTypeId,
      allocationMethod: body.allocationMethod,
      allocationParams: body.allocationParams,
    })
  }
}
