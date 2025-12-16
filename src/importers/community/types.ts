export type GroupDef = { code: string; name?: string }

export type CommunityDefJson = {
  id: string
  name: string
  period: { code: string; start?: string; end?: string }
  groups?: GroupDef[]
  buckets?: Array<{ code: string; name?: string; programCode?: string; expenseTypeCodes?: string[]; splitGroupCodes?: string[]; splitNodeIds?: string[]; priority?: number }>
  splitGroups?: Array<{ code: string; name?: string; splitIds: string[]; order?: number }>
  structure?: StructureRow[]
  allocationRules?: Array<{
    code: string
    name?: string
    method?: 'BY_RESIDENTS'|'BY_SQM'|'BY_CONSUMPTION'|'EQUAL'|'MIXED'
    params?: any
  }>
  expenseTypes?: Array<{
    code: string
    name: string
    ruleCode: string
    currency?: string
    preset?: { defaultTargetType?: 'GROUP'|'UNIT'|'COMMUNITY'|'EXPLICIT_SET'; defaultTargetCode?: string; weightSource?: 'RESIDENTS'|'SQM'|'CONSUMPTION'|'EQUAL' }
    params?: any
  }>
  measureTypes?: Array<{ code: string; unit: string; name?: string }>
  meters?: Array<{
    scopeType: 'UNIT'|'GROUP'
    scopeCode: string
    typeCode: string
    meterId: string
    origin?: 'METER'|'DECLARATION'|'ADMIN'|'DERIVED'
    installedAt?: string
    retiredAt?: string
    multiplier?: number
    notes?: string
  }>
  expenseSplits?: any[]
  aggregations?: Array<{ targetType: string; unitTypes: string[]; residualType?: string }>
  derivedMeters?: Array<{ scopeType?: 'COMMUNITY'|'GROUP'|'UNIT'; sourceType: string; subtractTypes: string[]; targetType: string; origin?: 'METER'|'DECLARATION'|'ADMIN'|'DERIVED' }>
}

export type StructureRow = {
  code: string
  residents?: number
  sqm?: number
  billingEntity?: string
  groupCodes?: string[]
  startPeriod?: string
  endPeriod?: string
}

export type CommunityImportPlan = {
  communityId: string
  communityName: string
  periodCode: string
  periodStart?: string
  periodEnd?: string
  groups: GroupDef[]
  buckets?: Array<{ code: string; name?: string; programCode?: string; expenseTypeCodes?: string[]; splitGroupCodes?: string[]; splitNodeIds?: string[]; priority?: number }>
  splitGroups?: Array<{ code: string; name?: string; splitIds: string[]; order?: number }>
  rules: Array<{ code: string; method: string; name?: string; params?: any }>
  expenseTypes: Array<{ code: string; name: string; ruleCode: string; currency?: string; params?: any; splitTemplate?: any }>
  units: Array<{ code: string; order?: number }>
  beOrders?: Record<string, number>
  memberships: Array<{ unitCode: string; groupCode?: string; billingEntityCode?: string; startPeriod?: string; endPeriod?: string }>
  periodMeasures: Array<{ unitCode: string; typeCode: 'RESIDENTS'|'SQM'; value: number }>
  expenseSplits?: any[]
  measureTypes?: Array<{ code: string; unit: string; name?: string }>
  meters?: Array<{ scopeType: 'UNIT'|'GROUP'|'COMMUNITY'; scopeCode: string; typeCode: string; meterId: string; origin?: string }>
  aggregations?: Array<{ targetType: string; unitTypes: string[]; residualType?: string }>
  derivedMeters?: Array<{ scopeType?: 'COMMUNITY'|'GROUP'|'UNIT'; sourceType: string; subtractTypes: string[]; targetType: string; origin?: string }>
}
