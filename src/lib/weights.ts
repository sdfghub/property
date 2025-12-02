import { PrismaClient, AllocationMethod } from '@prisma/client'
const prisma = new PrismaClient()
export type RuleParams = { type?: 'SINGLE' | 'MIXED'; single?: { typeCode: string }; mixed?: { parts: Array<{ typeCode: string; weight: number }> } }
export async function buildWeightsFromRule(periodId: string, unitIds: string[], rule: { id: string; method: AllocationMethod; params: any }) {
  const params: RuleParams = rule.params ?? {}
  const pick = async (typeCode: string) => {
    const rows = await prisma.periodMeasure.findMany({ where: { periodId, scopeType: 'UNIT', typeCode, scopeId: { in: unitIds } }, select: { scopeId: true, value: true } })
    const map = new Map(rows.map(r => [r.scopeId, Number(r.value)]))
    return unitIds.map(u => ({ unitId: u, raw: map.get(u) ?? 0 }))
  }
  let items: Array<{ unitId: string; raw: number }>
  switch (rule.method) {
    case 'EQUAL': items = unitIds.map(u => ({ unitId: u, raw: 1 })); break
    case 'BY_SQM': items = await pick('SQM'); break
    case 'BY_RESIDENTS': items = await pick('RESIDENTS'); break
    case 'BY_CONSUMPTION': items = await pick(params?.single?.typeCode ?? 'WATER_M3'); break
    case 'MIXED': {
      const parts = params?.mixed?.parts ?? []
      if (!parts.length) { items = unitIds.map(u => ({ unitId: u, raw: 1 })); break }
      const maps = await Promise.all(parts.map(p => pick(p.typeCode)))
      const byU: Record<string, number> = Object.fromEntries(unitIds.map(u => [u, 0]))
      for (let i=0;i<parts.length;i++) for (const it of maps[i]) byU[it.unitId] += parts[i].weight * it.raw
      items = unitIds.map(u => ({ unitId: u, raw: byU[u] })); break
    }
    default: throw new Error(`Unsupported method ${rule.method}`)
  }
  const eps = 1e-12
  const sum = items.reduce((a,b)=>a+Math.max(eps,b.raw),0)
  return items.map(x => ({ unitId: x.unitId, raw: x.raw, weight: Math.max(eps,x.raw)/sum }))
}
