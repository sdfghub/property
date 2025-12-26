// Types mirrored from backend responses to keep components type-safe and self-documenting.
// Only the most commonly used fields are mapped here.
// Authenticated user shape returned by backend.
export type User = {
  id: string
  email: string
  name?: string | null
}

export type RoleAssignment = {
  role: 'SYSTEM_ADMIN' | 'COMMUNITY_ADMIN' | 'CENSOR' | 'BILLING_ENTITY_USER'
  scopeType: 'SYSTEM' | 'COMMUNITY' | 'BILLING_ENTITY'
  scopeId?: string | null
}

export type Community = {
  id: string
  code: string
  name: string
}

export type PeriodRef = {
  id: string
  code: string
  seq: number
}

export type BillingEntity = {
  id: string
  code: string
  name: string
  total_amount: number
}

// API shapes for billing drilldowns
export type BillingEntityListResponse = {
  period: PeriodRef
  items: BillingEntity[]
}

export type BillingEntityMembersResponse = {
  period: PeriodRef
  be: {
    id: string
    code: string
    name: string
  }
  members: Array<{
    unit_id: string
    unit_code: string
    unit_amount: number
  }>
}

export type BillingEntityAllocationsResponse = {
  period: PeriodRef
  be: {
    id: string
    code: string
    name: string
  }
  lines: Array<{
    allocation_id: string
    amount: number
    unit_id: string
    unit_code: string
    expense_id: string
    expense_description: string
    expense_type_code: string
    currency: string
    allocatable_amount: number
  }>
}

export type MemberAllocationsResponse = {
  period: PeriodRef
  be: {
    id: string
    code: string
    name: string
  }
  unit: {
    id: string
    code: string
  }
  total: number
  lines: Array<{
    allocation_id: string
    amount: number
    expense_id: string
    expense_description: string
    expense_type_code: string
    currency: string
    allocatable_amount: number
  }>
}
