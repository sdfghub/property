// Display-only fix. The Contoare digest (GET .../meter-templates, TemplateService.listMeterTemplates)
// builds its per-item `values` LIVE from the raw `MeterReading` table (one row per physical meter per
// period, upserted normally by TemplateService.upsertMeterReading/saveMeterTemplateState) — it does
// NOT read PeriodMeasure (the per-scope rollup the billing engine actually consumes) or
// MeterEntryTemplateInstance.values. Periods seeded by scripts that write PeriodMeasure directly
// (e.g. seed-kralik-june-water.ts, for the 30 unit meters) never create a matching MeterReading row,
// so the digest shows "—" for every such meter even though the real reading exists and is used
// correctly by billing. This backfills the missing MeterReading rows (and, for good measure, the
// MeterEntryTemplateInstance.values blob too) from the real PeriodMeasure data — no calculation is
// touched, and (deliberately, unlike saveMeterTemplateState) neither Period.status nor the
// instance's own `state` is changed.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const COMM = process.argv[2] || 'Kralik'
const PERIOD_CODE = process.argv[3] || '2026-06'
const TEMPLATE_CODE = process.argv[4] || 'MONTHLY_WATER_COLD'

async function main() {
  const community = await prisma.community.findFirst({ where: { OR: [{ id: COMM }, { code: COMM }] }, select: { id: true } })
  if (!community) throw new Error(`Community ${COMM} not found`)
  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: community.id, code: PERIOD_CODE } } })
  if (!period) throw new Error(`Period ${PERIOD_CODE} not found`)
  const tpl = await (prisma as any).meterEntryTemplate.findUnique({
    where: { communityId_code: { communityId: community.id, code: TEMPLATE_CODE } },
  })
  if (!tpl) throw new Error(`Meter template ${TEMPLATE_CODE} not found`)

  const items: any[] = Array.isArray(tpl.template?.items) ? tpl.template.items : []
  const meterIds = items.filter((it) => it.kind === 'meter' && it.meterId).map((it) => String(it.meterId))
  const meters = await (prisma as any).meter.findMany({ where: { meterId: { in: meterIds } } })
  const meterById = new Map(meters.map((m: any) => [m.meterId, m]))
  const units = await prisma.unit.findMany({ where: { communityId: community.id }, select: { id: true, code: true } })
  const unitIdByCode = new Map(units.map((u) => [u.code, u.id]))

  const values: Record<string, number> = {}
  let matched = 0
  const skipped: string[] = []
  for (const item of items) {
    if (item.kind !== 'meter' || !item.meterId) continue
    const meter: any = meterById.get(item.meterId)
    if (!meter) { skipped.push(`${item.key} (no meter row)`); continue }
    const scopeId = meter.scopeType === 'COMMUNITY' ? community.id : unitIdByCode.get(meter.scopeCode)
    if (!scopeId) { skipped.push(`${item.key} (no scope match for ${meter.scopeCode})`); continue }
    const measure = await prisma.periodMeasure.findUnique({
      where: {
        communityId_periodId_scopeType_scopeId_typeCode: {
          communityId: community.id,
          periodId: period.id,
          scopeType: meter.scopeType,
          scopeId,
          typeCode: meter.typeCode,
        },
      },
    })
    if (!measure) { skipped.push(`${item.key} (no PeriodMeasure)`); continue }
    values[item.key] = Number(measure.value)
    matched++

    // The digest's real data source: one MeterReading row per (periodId, meterId).
    await prisma.meterReading.upsert({
      where: { periodId_meterId: { periodId: period.id, meterId: meter.meterId } },
      update: {
        scopeType: measure.scopeType, scopeId: measure.scopeId, typeCode: measure.typeCode,
        origin: measure.origin, value: measure.value, reading: measure.reading, estimated: measure.estimated,
      },
      create: {
        communityId: community.id, periodId: period.id, meterId: meter.meterId,
        scopeType: measure.scopeType, scopeId: measure.scopeId, typeCode: measure.typeCode,
        origin: measure.origin, value: measure.value, reading: measure.reading, estimated: measure.estimated,
      },
    })
  }

  console.log(`Resolved ${matched}/${items.filter((i) => i.kind === 'meter').length} meter items from PeriodMeasure (MeterReading backfilled for each).`)
  if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`)

  const existing = await (prisma as any).meterEntryTemplateInstance.findUnique({
    where: { communityId_periodId_templateId: { communityId: community.id, periodId: period.id, templateId: tpl.id } },
  })
  if (!existing) throw new Error('No MeterEntryTemplateInstance found for this period/template — nothing to backfill')

  await (prisma as any).meterEntryTemplateInstance.update({
    where: { id: existing.id },
    data: { values }, // state intentionally untouched
  })
  console.log(`✅ Backfilled values for ${TEMPLATE_CODE} / ${PERIOD_CODE} (instance state unchanged: ${existing.state})`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(async () => prisma.$disconnect())
