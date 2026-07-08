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
import { parseExport } from './history/parse-export'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD = { code: '2026-03', start: '2026-03-01', end: '2026-03-31' }
const GRACE_DAYS = 30

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)
  const periods = app.get(PeriodService)
  const ledger = app.get(PenaltyLedgerService)
  const prisma = app.get(PrismaService) as any

  // 1) community penalty grace
  await prisma.community.update({ where: { id: COMM }, data: { penaltyGraceDays: GRACE_DAYS } })

  // 2) CPI-fund patch (importer gap): BY_CPI reserve funds allocate their per-period contribution by the
  //    indiviz quota. The fund-contribution loop only understands EQUAL/BY_SQM/BY_RESIDENTS/EXPLICIT, so
  //    convert BY_CPI funds to EXPLICIT with the per-unit CPI weights from def.json.
  const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'def.json'), 'utf8'))
  const cpiRule = (def.allocationRules || []).find((r: any) => r.code === 'BY_CPI')
  const cpiWeights: Record<string, number> = cpiRule?.params?.weights
    || Object.fromEntries((def.structure || []).filter((u: any) => u.cpi != null).map((u: any) => [u.code, u.cpi]))
  const cpiFunds = await prisma.fund.findMany({ where: { communityId: COMM } })
  let patched = 0
  for (const f of cpiFunds) {
    const alloc = (f.allocation as any) || {}
    if (alloc.method === 'BY_CPI') {
      await prisma.fund.update({ where: { id: f.id }, data: { allocation: { ...alloc, method: 'EXPLICIT', weights: cpiWeights } } })
      patched++
    }
  }
  console.log(`grace=${GRACE_DAYS}d; CPI funds patched to EXPLICIT: ${patched}; CPI units: ${Object.keys(cpiWeights).length}`)

  // 2b) expense types need params.fundCode (importer gap) — all Kralik expenses go to the EXPENSES fund
  const expFund = def.expenseFundCode || 'EXPENSES'
  const ets = await prisma.expenseType.findMany({ where: { communityId: COMM } })
  let etp = 0
  for (const et of ets) {
    const params = (et.params as any) || {}
    if (!params.fundCode) { await prisma.expenseType.update({ where: { id: et.id }, data: { params: { ...params, fundCode: expFund } } }); etp++ }
  }
  console.log(`expense types patched with fundCode=${expFund}: ${etp}`)

  // 2c) source-driven period settings: due date + penalty rate come from the exported schedule (File 2),
  //     so the computed period matches reality (Kralik's rate has been 0 since mid-2023 → no March penalties).
  const parsed = parseExport(path.join(process.cwd(), 'data', COMM))
  const src = parsed.months.find((m) => m.code === PERIOD.code)
  const dueDate = src?.dueDate || `${PERIOD.code}-30`
  const srcRatePct = (src?.penaltyRate ?? 0) * 100 // penaltyRate is a fraction; Fund.allocation.penaltyPerDayPct is a percent
  const rateFunds = await prisma.fund.findMany({ where: { communityId: COMM } })
  for (const f of rateFunds) {
    const alloc = (f.allocation as any) || {}
    if (alloc.penaltyPerDayPct != null && Number(alloc.penaltyPerDayPct) !== srcRatePct) {
      await prisma.fund.update({ where: { id: f.id }, data: { allocation: { ...alloc, penaltyPerDayPct: srcRatePct } } })
    }
  }
  console.log(`source period ${PERIOD.code}: dueDate=${dueDate} penaltyRate=${srcRatePct}%`)

  // 3) period dueDate (import created the period from def.json)
  const period = await prisma.period.findFirst({ where: { communityId: COMM, code: PERIOD.code } })
  if (!period) throw new Error(`period ${PERIOD.code} not found (did import:community run?)`)
  await prisma.period.update({ where: { id: period.id }, data: { startDate: new Date(PERIOD.start), endDate: new Date(PERIOD.end), dueDate: new Date(dueDate) } })

  // 4) penalty buckets: after a full-history injection there are no opening balances (injected statements
  //    + migrated buckets are the cutover), so seedFromOpenings is a no-op here; March's advance continues
  //    from the injected buckets. (Harmless if openings exist for a non-injected rebuild.)
  const seed = await ledger.seedFromOpenings(COMM, period.id)
  console.log(`seedFromOpenings: ${JSON.stringify(seed)}`)

  // 5) post actuals -> close bill templates -> prepare -> approve (no payments: none in committed data)
  const actuals = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, `actuals-${PERIOD.code}.json`), 'utf8'))
  for (const it of (actuals.items || [])) {
    if (!(Number(it.amount) > 0)) continue
    try {
      await templates.saveBillTemplateState(COMM, PERIOD.code, it.templateCode, [], {
        state: 'SUBMITTED',
        values: {
          [it.detailKey]: Number(it.amount),
          invoiceNumber: it.invoiceNumber,
          invoiceGross: it.invoiceGross ?? Number(it.amount),
          serviceStartPeriod: it.serviceStartPeriod ?? PERIOD.code,
          serviceEndPeriod: it.serviceEndPeriod ?? PERIOD.code,
        },
      })
    } catch (e: any) { console.log(`  actuals ${it.templateCode}: ${e?.message || e}`) }
  }
  const billTemplates = await prisma.billTemplate.findMany({ where: { communityId: COMM }, select: { id: true } })
  for (const b of billTemplates) {
    await prisma.billTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: period.id, templateId: b.id } },
      update: { state: 'CLOSED' },
      create: { communityId: COMM, periodId: period.id, templateId: b.id, state: 'CLOSED' },
    })
  }
  // meter templates must be CLOSED too (no readings imported → consumption splits fall back to equal)
  const meterTemplates = await prisma.meterEntryTemplate.findMany({ where: { communityId: COMM }, select: { id: true } })
  for (const m of meterTemplates) {
    await prisma.meterEntryTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: period.id, templateId: m.id } },
      update: { state: 'CLOSED' },
      create: { communityId: COMM, periodId: period.id, templateId: m.id, state: 'CLOSED' },
    })
  }
  await periods.prepare(COMM, PERIOD.code)
  await periods.approve(COMM, PERIOD.code)
  console.log(`  ✅ ${PERIOD.code} prepared + approved`)

  // 6) report
  const chg: any[] = await prisma.$queryRawUnsafe(
    `select f.code fund, round(sum(ble.amount),2)::float8 charges
       from be_ledger_entry ble join fund f on f.id=ble.fund_id
      where ble.community_id=$1 and ble.period_id=$2 and ble.kind='CHARGE' and ble.ref_type in ('CLOSE_FINAL','OPENING_BALANCE')
      group by f.code order by f.code`, COMM, period.id)
  console.log('charges per fund:'); for (const r of chg) console.log(`  ${r.fund}: ${r.charges}`)
  const pen: any[] = await prisma.$queryRawUnsafe(
    `select coalesce(cc.allocation_snapshot->>'sourceFund','?') src, round(sum(ccl.amount),2)::float8 penalty
       from community_charge cc join community_charge_line ccl on ccl.charge_id=cc.id
      where cc.community_id=$1 and cc.period_id=$2 and cc.source_key like 'penalty:%' group by 1 order by 1`, COMM, period.id)
  console.log('penalties per source fund:'); for (const r of pen) console.log(`  ${r.src}: ${r.penalty}`)
  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
