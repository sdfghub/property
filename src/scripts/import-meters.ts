import fs from 'fs'
import path from 'path'
import { PrismaClient, SeriesScope, SeriesOrigin } from '@prisma/client'

type MeterRow = { meterId: string; periodCode: string; value: number; origin: SeriesOrigin }
type AggregationRule = {
  targetType: string
  unitTypes: string[]
  residualType?: string | null
}

/**
 * Import meter readings from a CSV-like file (meterId,periodCode,value,origin?).
 * - For origin DECLARATION (e.g., RESIDENTS), the value is stored directly.
 * - For meter/consumption readings, values are assumed cumulative; the importer computes
 *   the delta versus the last stored period and writes the delta into period_measure.
 * - Also rolls up unit readings to groups and reconciles WATER residuals (community vs sum of units).
 */
const prisma = new PrismaClient()

function parseRows(filePath: string): MeterRow[] {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8').trim()
  return raw
    .split(/\r?\n/)
    .map((l) => l.split(',').map((s) => s.trim()))
    .filter((cols) => cols.length >= 3 && cols[0].toLowerCase() !== 'meterid')
    .map(([meterId, periodCode, value, origin]) => ({
      meterId,
      periodCode,
      value: Number(value),
      origin: (origin?.toUpperCase() as SeriesOrigin) || SeriesOrigin.METER,
    }))
}

async function ensurePeriod(communityId: string, periodCode: string) {
  let period = await prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
  if (period) return period
  const [y, m] = periodCode.split('-').map(Number)
  const seq = y * 12 + m
  const startDate = new Date(y, m - 1, 1)
  const endDate = new Date(y, m, 0)
  period = await prisma.period.create({
    data: { communityId, code: periodCode, startDate, endDate, seq, status: 'OPEN' as any },
  })
  console.log(`  ℹ️ Created missing period ${periodCode} (seq=${seq})`)
  return period
}

async function resolveScope(meter: any, communityId: string) {
  if (meter.scopeType === 'UNIT') {
    const u = await prisma.unit.findUnique({ where: { code_communityId: { code: meter.scopeCode, communityId } } })
    if (!u) throw new Error(`Unit ${meter.scopeCode} missing`)
    return { scopeType: SeriesScope.UNIT, scopeId: u.id }
  }
  if (meter.scopeType === 'GROUP') {
    const g = await prisma.unitGroup.findUnique({ where: { code_communityId: { code: meter.scopeCode, communityId } } })
    if (!g) throw new Error(`Group ${meter.scopeCode} missing`)
    return { scopeType: SeriesScope.GROUP, scopeId: g.id }
  }
  if (meter.scopeType === 'COMMUNITY') {
    return { scopeType: SeriesScope.COMMUNITY, scopeId: communityId }
  }
  throw new Error(`Unsupported scopeType ${meter.scopeType}`)
}

async function computeDelta(
  communityId: string,
  periodId: string,
  scopeType: SeriesScope,
  scopeId: string,
  typeCode: string,
  origin: SeriesOrigin,
  value: number,
) {
  if (origin === SeriesOrigin.DECLARATION) return value
  const last = await prisma.periodMeasure.findFirst({
    where: { communityId, scopeType, scopeId, typeCode, period: { seq: { lt: (await prisma.period.findUnique({ where: { id: periodId }, select: { seq: true } } ))?.seq } } },
    orderBy: { period: { seq: 'desc' } },
    include: { period: { select: { seq: true } } },
  })
  if (!last) return value
  return value - Number(last.value)
}

async function upsertMeasure(
  communityId: string,
  periodId: string,
  scopeType: SeriesScope,
  scopeId: string,
  typeCode: string,
  origin: SeriesOrigin,
  value: number,
  meterId?: string,
) {
  const resolvedMeterId = meterId ?? `${typeCode}-${scopeId}`
  await prisma.periodMeasure.upsert({
    where: {
      communityId_periodId_scopeType_scopeId_typeCode: {
        communityId,
        periodId,
        scopeType,
        scopeId,
        typeCode,
      },
    },
    update: { value, origin, meterId: resolvedMeterId },
    create: {
      communityId,
      periodId,
      scopeType,
      scopeId,
      typeCode,
      origin,
      value,
      meterId: resolvedMeterId,
    },
  })
}

async function rollupGroups(groupTotals: Map<string, { communityId: string; periodId: string; typeCode: string; origin: any; value: number }>, periodCode: string) {
  let groupWrites = 0
  for (const [key, payload] of groupTotals.entries()) {
    const [scopeId] = key.split('::')
    const group = await prisma.unitGroup.findUnique({ where: { id: scopeId }, select: { code: true } })
    await upsertMeasure(payload.communityId, payload.periodId, SeriesScope.GROUP, scopeId, payload.typeCode, payload.origin, payload.value)
    groupWrites += 1
    console.log(
      `  ↳ aggregated GROUP ${group?.code ?? scopeId} type=${payload.typeCode} period=${periodCode} value=${payload.value}`,
    )
  }
  return groupWrites
}

async function reconcileAggregation(communityId: string, periodCode: string, agg: AggregationRule) {
  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
  if (!period) return
  const communityWater = await prisma.periodMeasure.findUnique({
    where: {
      communityId_periodId_scopeType_scopeId_typeCode: {
        communityId,
        periodId: period.id,
        scopeType: SeriesScope.COMMUNITY,
        scopeId: communityId,
        typeCode: agg.targetType,
      },
    },
  })
  if (!communityWater) return
  const unitWater = await prisma.periodMeasure.findMany({
    where: {
      communityId,
      periodId: period.id,
      scopeType: SeriesScope.UNIT,
      typeCode: { in: agg.unitTypes },
    },
    select: { scopeId: true, value: true, typeCode: true },
  })
  const byUnit = new Map<string, number>() // subtotal of all unitTypes
  const basisByUnit = new Map<string, number>() // basis using targetType only (e.g., WATER)
  const byTypeCommunity = new Map<string, number>()
  unitWater.forEach((m) => {
    const val = Number(m.value)
    byUnit.set(m.scopeId, (byUnit.get(m.scopeId) ?? 0) + val)
    if (m.typeCode === agg.targetType) {
      basisByUnit.set(m.scopeId, (basisByUnit.get(m.scopeId) ?? 0) + val)
    }
    byTypeCommunity.set(m.typeCode, (byTypeCommunity.get(m.typeCode) ?? 0) + val)
  })
  const sumUnits = Array.from(byUnit.values()).reduce((s, v) => s + v, 0)
  const sumBasis = Array.from(basisByUnit.values()).reduce((s, v) => s + v, 0)
  const totalCommunity = Number(communityWater.value)
  const residual = totalCommunity - sumUnits
  if (sumUnits <= 0) {
    console.log('  ℹ️ Water residual skipped: no unit water readings')
    return
  }
  console.log(
    `  ℹ️ Water residual: community=${totalCommunity.toFixed(4)} sumUnits=${sumUnits.toFixed(4)} residual=${residual.toFixed(4)}`,
  )
  const basisMap = sumBasis > 0 ? basisByUnit : byUnit
  const basisTotal = sumBasis > 0 ? sumBasis : sumUnits
  for (const [unitId, subtotal] of byUnit.entries()) {
    const basisVal = basisMap.get(unitId) ?? 0
    const share = basisVal / basisTotal
    const adj = residual * share
    if (agg.residualType) {
      await upsertMeasure(communityId, period.id, SeriesScope.UNIT, unitId, agg.residualType, SeriesOrigin.DERIVED, adj, `${agg.residualType}-${unitId}`)
    }
  }
  if (agg.residualType) {
    await upsertMeasure(
      communityId,
      period.id,
      SeriesScope.COMMUNITY,
      communityId,
      agg.residualType,
      SeriesOrigin.DERIVED,
      residual,
      `${agg.residualType}-${communityId}`,
    )
  }
  // also persist community totals for each unitType (for derived shares) but never overwrite the metered target type
  for (const [type, sum] of byTypeCommunity.entries()) {
    if (type === agg.targetType) continue
    await upsertMeasure(
      communityId,
      period.id,
      SeriesScope.COMMUNITY,
      communityId,
      type,
      SeriesOrigin.DERIVED,
      sum,
      `${type}-${communityId}`,
    )
  }
}

async function applyDerivedMeters(communityId: string, periodCode: string, rules: any[]) {
  if (!rules.length) return
  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
  if (!period) return
  for (const r of rules) {
    const scopeType = (r.scopeType as SeriesScope) ?? SeriesScope.COMMUNITY
    const scopeId = scopeType === SeriesScope.COMMUNITY ? communityId : r.scopeId ?? communityId
    const source = await prisma.periodMeasure.findUnique({
      where: {
        communityId_periodId_scopeType_scopeId_typeCode: {
          communityId,
          periodId: period.id,
          scopeType,
          scopeId,
          typeCode: r.sourceType,
        },
      },
    })
    if (!source) continue
    let remainder = Number(source.value)
    if (Array.isArray(r.subtractTypes) && r.subtractTypes.length) {
      const subs = await prisma.periodMeasure.findMany({
        where: {
          communityId,
          periodId: period.id,
          scopeType,
          scopeId,
          typeCode: { in: r.subtractTypes as string[] },
        },
        select: { value: true },
      })
      remainder -= subs.reduce((s, m) => s + Number(m.value), 0)
    }
    await upsertMeasure(
      communityId,
      period.id,
      scopeType,
      scopeId,
      r.targetType,
      (r.origin as SeriesOrigin) ?? SeriesOrigin.DERIVED,
      remainder,
      `${r.targetType}-${scopeId}`,
    )
    console.log(
      `  AGGREGATION Derived meter ${r.targetType} from ${r.sourceType} minus [${(r.subtractTypes ?? []).join(',')}] => ${remainder}`,
    )
  }
}

async function main() {
  const [filePath, communityId] = process.argv.slice(2)
  if (!filePath || !communityId) {
    console.log('Usage: npm run import:meters -- <csv-file> <communityId>')
    process.exit(1)
  }
  console.log(`📥 Importing meters for community=${communityId} from ${filePath}`)
  const rows = parseRows(filePath)
  const aggRules: AggregationRule[] = await (prisma as any).aggregationRule?.findMany
    ? await (prisma as any).aggregationRule.findMany({
        where: { communityId },
        select: { targetType: true, unitTypes: true, residualType: true },
      })
    : []

  const groupTotals = new Map<string, { communityId: string; periodId: string; typeCode: string; origin: any; value: number }>()

  for (const row of rows) {
    const period = await ensurePeriod(communityId, row.periodCode)
    const meter: any = await (prisma as any).meter.findUnique({ where: { meterId: row.meterId } })
    if (!meter) throw new Error(`Meter ${row.meterId} missing`)

    const { scopeType, scopeId } = await resolveScope(meter, communityId)
    const delta = await computeDelta(communityId, period.id, scopeType as SeriesScope, scopeId, meter.typeCode, row.origin, row.value)

    await upsertMeasure(communityId, period.id, scopeType as SeriesScope, scopeId, meter.typeCode, row.origin, delta, meter.meterId)
    console.log(
      `  ✅ ${row.meterId} @ ${row.periodCode} -> scope=${scopeType}/${scopeId} type=${meter.typeCode} value=${row.value} (delta=${delta}) origin=${row.origin}`,
    )

    if (scopeType === SeriesScope.UNIT) {
      const memberships = await prisma.unitGroupMember.findMany({
        where: {
          unitId: scopeId,
          startSeq: { lte: period.seq },
          OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
        },
        select: { groupId: true },
      })
      for (const m of memberships) {
        const key = `${m.groupId}::${period.id}::${meter.typeCode}`
        const existing = groupTotals.get(key)
        if (existing) {
          existing.value += delta
        } else {
          groupTotals.set(key, {
            communityId,
            periodId: period.id,
            typeCode: meter.typeCode,
            origin: row.origin,
            value: delta,
          })
        }
      }
    }
  }

  const groupWrites = await rollupGroups(groupTotals, rows[0]?.periodCode ?? '')
  const periodCode = rows[0]?.periodCode ?? ''
  for (const agg of aggRules) {
    await reconcileAggregation(communityId, periodCode, agg)
    const relevant = Array.isArray(groupWrites) ? groupWrites.filter((g: any) => g.typeCode === agg.targetType) : []
    const total = relevant.reduce((s: number, r: any) => s + (r.value ?? 0), 0)
    console.log(
      relevant.length
        ? `  AGGREGATION Aggregated ${agg.targetType} at ${periodCode} => ${total}`
        : `  AGGREGATION No aggregation data for ${agg.targetType} at ${periodCode}`,
    )
  }
  const derivedRules = (prisma as any).derivedMeterRule?.findMany
    ? await (prisma as any).derivedMeterRule.findMany({ where: { communityId } })
    : []
  await applyDerivedMeters(communityId, periodCode, derivedRules)

  // Virtual gas heating: remainder of GAS total minus GAS_HOTWATER at community scope
  if (periodCode) {
    const period = await prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    if (period) {
      const total = await prisma.periodMeasure.findUnique({
        where: {
          communityId_periodId_scopeType_scopeId_typeCode: {
            communityId,
            periodId: period.id,
            scopeType: SeriesScope.COMMUNITY,
            scopeId: communityId,
            typeCode: 'GAS',
          },
        },
      })
      const hot = await prisma.periodMeasure.findUnique({
        where: {
          communityId_periodId_scopeType_scopeId_typeCode: {
            communityId,
            periodId: period.id,
            scopeType: SeriesScope.COMMUNITY,
            scopeId: communityId,
            typeCode: 'GAS_HOTWATER',
          },
        },
      })
      if (total) {
        const remainder = Number(total.value) - Number(hot?.value ?? 0)
        await upsertMeasure(
          communityId,
          period.id,
          SeriesScope.COMMUNITY,
          communityId,
          'GAS_HEATING',
          SeriesOrigin.DERIVED,
          remainder,
        )
        console.log(
          `  ℹ️ Gas heating virtual meter: total=${Number(total.value)} hot=${Number(hot?.value ?? 0)} remainder=${remainder}`,
        )
      }
    }
  }

  console.log(`✅ Imported ${rows.length} meter readings for ${communityId} (group rollups=${groupWrites})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
