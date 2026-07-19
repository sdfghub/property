// Import + compute Kralik period 2026-05 with ZERO opening balances (no history, no arrears).
// Prereq: community/funds/bill-templates/meter-templates already imported (creates the 2026-03
// anchor period from def.json). This script creates 2026-05 standalone, loads the May packet
// (data/Kralik/actuals-2026-05.json: per-unit water+residents, branch reading, 8 vendor bills with
// the 3-way water split), and closes it. The 2026-03 anchor is kept EMPTY/uncomputed — the reserve
// funds anchor their per-period offset on its code (funds.json startPeriodCode), so it must exist.
import fs from 'fs'
import path from 'path'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { TemplateService } from '../modules/billing/template.service'
import { PeriodService } from '../modules/period/period.service'
import { PenaltyLedgerService } from '../modules/period/penalty-ledger.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD = { code: '2026-05', start: '2026-05-01', end: '2026-05-31', due: '2026-06-15' }
const GRACE_DAYS = 30

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)
  const periods = app.get(PeriodService)
  const ledger = app.get(PenaltyLedgerService)
  const prisma = app.get(PrismaService) as any

  const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'def.json'), 'utf8'))
  const packet = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, `actuals-${PERIOD.code}.json`), 'utf8'))
  const byUnit: Record<string, { water_cold: number; residents: number }> = packet.unitMeasures?.byUnit || {}
  const cpiByCode: Record<string, number> = Object.fromEntries(
    (def.structure || []).filter((u: any) => u.cpi != null).map((u: any) => [u.code, Number(u.cpi)]),
  )

  // 1) community grace
  await prisma.community.update({ where: { id: COMM }, data: { penaltyGraceDays: GRACE_DAYS } })

  // 2) CPI reserve funds → EXPLICIT weights (importer gap; same as seed-kralik-close)
  const cpiRule = (def.allocationRules || []).find((r: any) => r.code === 'BY_CPI')
  const cpiWeights: Record<string, number> = cpiRule?.params?.weights || cpiByCode
  let patched = 0
  for (const f of await prisma.fund.findMany({ where: { communityId: COMM } })) {
    const alloc = (f.allocation as any) || {}
    if (alloc.method === 'BY_CPI') {
      await prisma.fund.update({ where: { id: f.id }, data: { allocation: { ...alloc, method: 'EXPLICIT', weights: cpiWeights } } })
      patched++
    }
    // May penalty rate = 0 (Kralik rate has been 0 since mid-2023) — zero arrears anyway.
    if (alloc.penaltyPerDayPct != null && Number(alloc.penaltyPerDayPct) !== 0) {
      await prisma.fund.update({ where: { id: f.id }, data: { allocation: { ...(f.allocation as any), penaltyPerDayPct: 0 } } })
    }
  }

  // 2b) expense types → params.fundCode = EXPENSES (importer gap)
  const expFund = def.expenseFundCode || 'EXPENSES'
  let etp = 0
  for (const et of await prisma.expenseType.findMany({ where: { communityId: COMM } })) {
    const params = (et.params as any) || {}
    if (!params.fundCode) { await prisma.expenseType.update({ where: { id: et.id }, data: { params: { ...params, fundCode: expFund } } }); etp++ }
  }
  console.log(`grace=${GRACE_DAYS}d; CPI funds→EXPLICIT: ${patched}; expense types fundCode-patched: ${etp}`)

  // 3) create the 2026-05 period (standalone; status defaults OPEN). NO opening-balance rows are
  //    created for it → openings are zero by construction.
  const [y, m] = PERIOD.code.split('-').map(Number)
  const seq = y * 12 + m
  const period = await prisma.period.upsert({
    where: { communityId_code: { communityId: COMM, code: PERIOD.code } },
    update: { startDate: new Date(PERIOD.start), endDate: new Date(PERIOD.end), dueDate: new Date(PERIOD.due) },
    create: { communityId: COMM, code: PERIOD.code, seq, status: 'OPEN', startDate: new Date(PERIOD.start), endDate: new Date(PERIOD.end), dueDate: new Date(PERIOD.due) },
  })
  // Close the 2026-03 anchor stub: it exists only so the reserve funds can anchor their per-period
  // offset (funds.json startPeriodCode=2026-03 → periodSeqByCode lookup). Leaving it OPEN would make
  // getEditable() (earliest non-CLOSED period) block prepare on 2026-05. It carries no charges.
  const closedAnchors = await prisma.period.updateMany({
    where: { communityId: COMM, code: { not: PERIOD.code }, status: { not: 'CLOSED' } },
    data: { status: 'CLOSED' },
  })
  console.log(`period ${PERIOD.code} (seq=${seq}) ready; dueDate=${PERIOD.due}; anchor periods closed: ${closedAnchors.count}`)

  // 4) per-unit measures for 2026-05: SQM=cotă (cpi), RESIDENTS + WATER_COLD from the May sheet.
  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  let nSqm = 0, nRes = 0, nWater = 0, waterSum = 0
  for (const u of units) {
    const upsertMeasure = async (typeCode: string, value: number, origin: string) => {
      await prisma.periodMeasure.upsert({
        where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId: COMM, periodId: period.id, scopeType: 'UNIT', scopeId: u.id, typeCode } },
        update: { value, origin, meterId: `${typeCode}-${u.code}` },
        create: { communityId: COMM, periodId: period.id, scopeType: 'UNIT', scopeId: u.id, typeCode, value, origin, meterId: `${typeCode}-${u.code}` },
      })
    }
    const cota = cpiByCode[u.code]
    if (cota != null) { await upsertMeasure('SQM', cota, 'ADMIN'); nSqm++ }
    const um = byUnit[u.code]
    if (um) {
      await upsertMeasure('RESIDENTS', Number(um.residents) || 0, 'DECLARATION'); nRes++
      await upsertMeasure('WATER_COLD', Number(um.water_cold) || 0, 'ADMIN'); nWater++
      waterSum += Number(um.water_cold) || 0
    }
  }
  console.log(`unit measures: SQM=${nSqm}, RESIDENTS=${nRes}, WATER_COLD=${nWater} (Σ=${waterSum.toFixed(3)} m³)`)

  // 5) branch (community) cold-water reading → triggers residual recompute (WATER_RESIDUAL).
  const branch = Number(packet.meters?.community?.COMMUNITY_WATER_COLD)
  if (branch > 0) {
    await templates.upsertMeterReading(COMM, PERIOD.code, [], { meterId: 'COMMUNITY_WATER_COLD', value: branch })
    console.log(`branch reading COMMUNITY_WATER_COLD=${branch} m³ → residual ≈ ${(branch - waterSum).toFixed(3)}`)
  }

  // 6) post actuals — GROUP items by templateCode so the 3-line water bill submits in ONE call.
  const groups = new Map<string, { values: Record<string, any>; meta: any }>()
  for (const it of (packet.items || [])) {
    const g = groups.get(it.templateCode) || { values: {}, meta: {} }
    if (Number(it.amount) > 0) g.values[it.detailKey] = Number(it.amount)
    g.meta.invoiceNumber = g.meta.invoiceNumber ?? it.invoiceNumber
    g.meta.invoiceGross = g.meta.invoiceGross ?? it.invoiceGross
    // Attribute every invoice's fund spend to the close period. (The curățenie invoice is dated for
    // June service; its serviceStartPeriod=2026-06 has no period row, which would fail fund-spend
    // resolution. The true service window is retained in actuals-2026-05.json for the record.)
    g.meta.serviceStartPeriod = PERIOD.code
    g.meta.serviceEndPeriod = PERIOD.code
    groups.set(it.templateCode, g)
  }
  for (const [templateCode, g] of groups) {
    if (!Object.keys(g.values).length) continue
    try {
      await templates.saveBillTemplateState(COMM, PERIOD.code, templateCode, [], {
        state: 'SUBMITTED',
        values: { ...g.values, ...g.meta },
      })
    } catch (e: any) { console.log(`  actuals ${templateCode}: ${e?.message || e}`) }
  }

  // 7) close bill + meter template instances
  for (const b of await prisma.billTemplate.findMany({ where: { communityId: COMM }, select: { id: true } })) {
    await prisma.billTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: period.id, templateId: b.id } },
      update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: period.id, templateId: b.id, state: 'CLOSED' },
    })
  }
  for (const mt of await prisma.meterEntryTemplate.findMany({ where: { communityId: COMM }, select: { id: true } })) {
    await prisma.meterEntryTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: period.id, templateId: mt.id } },
      update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: period.id, templateId: mt.id, state: 'CLOSED' },
    })
  }

  // 8) zero openings → seedFromOpenings is a no-op; prepare + approve
  const seed = await ledger.seedFromOpenings(COMM, period.id)
  console.log(`seedFromOpenings: ${JSON.stringify(seed)} (expected created:0)`)
  await periods.prepare(COMM, PERIOD.code)
  await periods.approve(COMM, PERIOD.code)
  console.log(`  ✅ ${PERIOD.code} prepared + approved`)

  // 9) report
  const chg: any[] = await prisma.$queryRawUnsafe(
    `select f.code fund, round(sum(ble.amount),2)::float8 charges
       from be_ledger_entry ble join fund f on f.id=ble.fund_id
      where ble.community_id=$1 and ble.period_id=$2 and ble.kind='CHARGE' and ble.ref_type in ('CLOSE_FINAL','OPENING_BALANCE')
      group by f.code order by f.code`, COMM, period.id)
  console.log('charges per fund:'); for (const r of chg) console.log(`  ${r.fund}: ${r.charges}`)
  const water: any[] = await prisma.$queryRawUnsafe(
    `select cc.source_key, round(cc.amount,2)::float8 amount
       from community_charge cc where cc.community_id=$1 and cc.period_id=$2
        and cc.source_key in ('apa_rece','canal','penalitati','apa_meteo') order by cc.source_key`, COMM, period.id)
  console.log('water split:'); for (const r of water) console.log(`  ${r.source_key}: ${r.amount}`)
  const opening: any[] = await prisma.$queryRawUnsafe(
    `select coalesce(round(sum(amount),2),0)::float8 total from be_ledger_entry
      where community_id=$1 and period_id=$2 and ref_type='OPENING_BALANCE'`, COMM, period.id)
  console.log(`opening balances total: ${opening[0]?.total ?? 0} (expected 0)`)
  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
