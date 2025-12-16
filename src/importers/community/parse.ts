import fs from 'fs'
import path from 'path'
import { CommunityDefJson, CommunityImportPlan, StructureRow } from './types'

const toNum = (v: any) => {
  if (v == null) return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

type NormalizedRow = {
  code: string
  residents?: number | string | null
  sqm?: number | string | null
  order?: number
  billing_entity: string
  group_codes: string
  start_period: string
  end_period: string
}

export function parseCommunity(defFolder: string): CommunityImportPlan {
  const def: CommunityDefJson = JSON.parse(fs.readFileSync(path.join(defFolder, 'def.json'), 'utf8'))
  if (!Array.isArray((def as any).structure) || !(def as any).structure.length) {
    throw new Error('def.json.structure[] is required (structure.csv removed)')
  }

  const rawRows = (def.structure ?? []) as Array<StructureRow & Record<string, any>>

  const rows: NormalizedRow[] = rawRows
    .map((r) => ({
      code: String(r.code ?? '').trim(),
      residents: r.residents,
      sqm: r.sqm,
      order: (r as any).order,
      billing_entity: r.billingEntity ?? r.billing_entity ?? '',
      group_codes: Array.isArray(r.groupCodes) ? r.groupCodes.join(';') : (r.group_codes ?? ''),
      start_period: r.startPeriod ?? r.start_period ?? '',
      end_period: r.endPeriod ?? r.end_period ?? ''
    }))
    .filter((r) => r.code && r.code.toLowerCase() !== 'total');
    
  const units: Array<{ code: string; order: number; kind?: string }> = []
  const seenUnits = new Set<string>()
  for (const r of rows) {
    if (!seenUnits.has(r.code)) {
      seenUnits.add(r.code)
      const ord = typeof r.order === 'number' ? r.order : units.length
      units.push({ code: r.code, order: ord })
    }
  }
  const beOrders: Record<string, number> = {}
  if ((def as any).billingEntities && Array.isArray((def as any).billingEntities)) {
    ;(def as any).billingEntities.forEach((be: any) => {
      const code = be.code || be.name
      if (code && typeof be.order === 'number') beOrders[String(code)] = be.order
    })
  }
  if ((def as any).billingEntityOrder && typeof (def as any).billingEntityOrder === 'object') {
    for (const [k, v] of Object.entries((def as any).billingEntityOrder)) {
      if (typeof v === 'number' && !(k in beOrders)) beOrders[k] = v as number
    }
  }
  for (const r of rows) {
    const be = r.billing_entity
    if (be && !(be in beOrders)) beOrders[be] = Object.keys(beOrders).length + 1
  }
  const memberships: CommunityImportPlan['memberships'] = []
  const periodMeasures: CommunityImportPlan['periodMeasures'] = []

  for (const r of rows) {
    const res = toNum(r.residents); const sqm = toNum(r.sqm)
    if (res != null) periodMeasures.push({ unitCode: r.code, typeCode: 'RESIDENTS', value: res })
    if (sqm != null) periodMeasures.push({ unitCode: r.code, typeCode: 'SQM', value: sqm })

    if (r.billing_entity)
      memberships.push({ unitCode: r.code, billingEntityCode: String(r.billing_entity).trim(), startPeriod: r.start_period, endPeriod: r.end_period })

    for (const g of String(r.group_codes || '').split(';').map(s => s.trim()).filter(Boolean))
      memberships.push({ unitCode: r.code, groupCode: g, startPeriod: r.start_period, endPeriod: r.end_period })
  }

  // Build expense types: prefer explicit list; otherwise derive from expenseSplits
  const explicitTypes = def.expenseTypes ?? []
  let derivedTypes: Array<{ code: string; name: string; ruleCode: string; currency?: string; params?: any; splitTemplate?: any }> = []
  if (!explicitTypes.length && Array.isArray(def.expenseSplits)) {
    derivedTypes = def.expenseSplits
      .filter((s: any) => s && s.expenseTypeCode)
      .map((s: any) => {
        // derive ruleCode from first leaf allocation (method or ruleCode)
        const firstLeaf = (() => {
          const stack = Array.isArray(s.splits) ? [...s.splits] : []
          while (stack.length) {
            const node = stack.shift()
            if (node.children && node.children.length) stack.push(...node.children)
            else return node
          }
          return null
        })()
        const alloc = firstLeaf?.allocation ?? {}
        const ruleCode = alloc.ruleCode || alloc.method || 'BY_RESIDENTS'
        const name = s.name ? String(s.name) : String(s.expenseTypeCode)
        return { code: String(s.expenseTypeCode), name, ruleCode, currency: s.currency ?? 'RON', splitTemplate: s.splits ?? s }
      })
  }

  const expenseTypes = (explicitTypes.length ? explicitTypes : derivedTypes).map(t => ({
    code: t.code,
    name: t.name,
    ruleCode: t.ruleCode,
    currency: t.currency ?? 'RON',
    params: { ...(t as any).params },
    splitTemplate: (t as any).splitTemplate,
  }))

  return {
    communityId: def.id,
    communityName: def.name,
    periodCode: def.period.code,
    periodStart: def.period.start,
    periodEnd: def.period.end,
    groups: def.groups ?? [],
    buckets: def.buckets ?? [],
    splitGroups: (def.splitGroups || []).map((g: any, idx: number) => ({
      ...g,
      order: g.order ?? idx + 1,
    })),
    rules: (def.allocationRules ?? []).map(r => {
      const method = (r as any).method ?? (r as any).name ?? 'BY_SQM'
      return {
        code: r.code,
        method: method as string,
        name: (r as any).name ?? method,
        params: r.params,
      }
    }),
    expenseTypes,
    expenseSplits: def.expenseSplits ?? [],
    measureTypes: def.measureTypes ?? [],
    meters: def.meters ?? [],
    derivedMeters: def.derivedMeters ?? [],
    aggregations: def.aggregations ?? [],
    units,
    beOrders,
    memberships,
    periodMeasures
  }
}
