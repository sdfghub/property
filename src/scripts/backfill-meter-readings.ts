/**
 * Phase-1 backfill: seed the raw MeterReading layer from the existing per-(scope,type) PeriodMeasure rows,
 * so the meter-entry form (which reads per physical meter) shows the values and multi-meter entry can sum.
 *
 * For each metered PeriodMeasure we create ONE MeterReading:
 *   - if the measure's meterId is already a real Meter id → use it 1:1;
 *   - else (synthetic aggregate, e.g. Kralik cold water) → put it on the scope's FIRST real meter of that
 *     type, so the form surfaces it (a per-physical split isn't known for historical data);
 *   - if the scope has NO physical meter of that type (derived residuals, static SQM/RESIDENTS) → skip.
 * The per-unit rollup (Σ MeterReading) then reproduces PeriodMeasure.value exactly → zero billing change.
 * Idempotent (upsert on periodId+meterId).
 *
 * Usage: ts-node src/scripts/backfill-meter-readings.ts [CommunityCode=Kralik]
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const ref = process.argv[2] || 'Kralik'
  const community = await prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true, code: true } })
  if (!community) throw new Error(`Community not found: ${ref}`)
  const cid = community.id

  const meters = await prisma.meter.findMany({ select: { meterId: true, scopeType: true, scopeCode: true, typeCode: true } })
  const realIds = new Set(meters.map((m) => m.meterId))
  const byScope = new Map<string, string[]>() // scopeType|scopeCode|typeCode -> [meterId] (sorted, deterministic)
  for (const m of meters) {
    const k = `${m.scopeType}|${m.scopeCode}|${m.typeCode}`
    const arr = byScope.get(k) ?? byScope.set(k, []).get(k)!
    arr.push(m.meterId)
  }
  for (const arr of byScope.values()) arr.sort()

  const units = await prisma.unit.findMany({ where: { communityId: cid }, select: { id: true, code: true } })
  const unitCode = new Map(units.map((u) => [u.id, u.code]))

  const pms = await prisma.periodMeasure.findMany({ where: { communityId: cid } })
  let created = 0, remapped = 0, skipped = 0
  for (const pm of pms) {
    let meterId: string | null = null
    if (realIds.has(pm.meterId)) {
      meterId = pm.meterId
    } else {
      const scopeCode = pm.scopeType === 'UNIT' ? unitCode.get(pm.scopeId) ?? pm.scopeId : pm.scopeId
      const arr = byScope.get(`${pm.scopeType}|${scopeCode}|${pm.typeCode}`)
      if (arr && arr.length) { meterId = arr[0]; remapped++ }
    }
    if (!meterId) { skipped++; continue } // no physical meter for this (scope,type) → not a meter reading

    await (prisma as any).meterReading.upsert({
      where: { periodId_meterId: { periodId: pm.periodId, meterId } },
      update: { value: pm.value, reading: pm.reading, origin: pm.origin, estimated: pm.estimated, enteredById: pm.enteredById, selfReported: pm.selfReported },
      create: {
        communityId: cid, periodId: pm.periodId, meterId,
        scopeType: pm.scopeType, scopeId: pm.scopeId, typeCode: pm.typeCode,
        origin: pm.origin, value: pm.value, reading: pm.reading,
        estimated: pm.estimated, enteredById: pm.enteredById, selfReported: pm.selfReported,
      },
    })
    created++
  }
  console.log(`backfill-meter-readings [${community.code}]: wrote ${created} MeterReading(s) (${remapped} remapped onto a physical meter), skipped ${skipped} (derived/static — no physical meter)`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
