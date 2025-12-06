export type GroupDef = { code: string; name?: string; kind?: 'PHYSICAL'|'LOGICAL'|'ADHOC' }

export type CommunityDefJson = {
  id: string
  name: string
  period: { code: string; start?: string; end?: string }
  groups?: GroupDef[]
  allocationRules?: Array<{ code: string; method: 'BY_RESIDENTS'|'BY_SQM'|'BY_CONSUMPTION'|'EQUAL'|'MIXED'; params?: any }>
  expenseTypes?: Array<{
    code: string
    name: string
    ruleCode: string
    currency?: string
    preset?: { defaultTargetType?: 'GROUP'|'UNIT'|'COMMUNITY'|'EXPLICIT_SET'; defaultTargetCode?: string; weightSource?: 'RESIDENTS'|'SQM'|'CONSUMPTION'|'EQUAL' }
    params?: any
  }>
}

export type CsvRow = {
  code: string
  residents?: string | number
  sqm?: string | number
  billing_entity?: string
  group_codes?: string // "A;B;C"
  start_period?: string
  end_period?: string
}

export type CommunityImportPlan = {
  communityId: string
  communityName: string
  periodCode: string
  periodStart?: string
  periodEnd?: string
  groups: GroupDef[]
  rules: Array<{ code: string; method: string; params?: any }>
  expenseTypes: Array<{ code: string; name: string; ruleCode: string; currency?: string; params?: any }>
  units: Array<{ code: string }>
  memberships: Array<{ unitCode: string; groupCode?: string; billingEntityCode?: string; startPeriod?: string; endPeriod?: string }>
  periodMeasures: Array<{ unitCode: string; typeCode: 'RESIDENTS'|'SQM'; value: number }>
}
