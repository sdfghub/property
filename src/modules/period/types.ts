export type PeriodStatus = 'DRAFT' | 'OPEN' | 'PREPARED' | 'CLOSED'

export interface Ids {
  communityId: string
  periodId: string
}

export interface StatementNums {
  dueStart: number
  charges: number
  payments: number
  adjustments: number
  dueEnd: number
}
