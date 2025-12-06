export type ExpenseCsvRow = {
  description: string
  expenseTypeCode: string
  allocatableAmount: string | number
  currency?: string
  targetType?: 'GROUP'|'UNIT'|'COMMUNITY'|'EXPLICIT_SET'
  targetCode?: string
  weightSource?: 'RESIDENTS'|'SQM'|'CONSUMPTION'|'EQUAL'
}

export type ExpenseImportPlan = {
  communityId: string
  periodCode: string
  items: Array<{
    description: string
    expenseTypeCode: string
    amount: number
    currency: string
    targetType?: ExpenseCsvRow['targetType']
    targetCode?: string
    weightSource?: ExpenseCsvRow['weightSource']
  }>
}
