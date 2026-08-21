// Kralik: open + compute June 2026-06 on top of May (already CLOSED/approved). Unlike the
// April→May cutover script, this does NOT inject any ledger — computeStatements chains
// dueStart from May's beStatement.dueEnd automatically (architecture.md §2/§5).
//
// PARTIAL month: only the 3 BY_CPI-allocated charges from data/Kralik/actuals-2026-06.json are
// posted (administrare, apa_meteo, curatenie). Aquatim's apa_rece/canal/penalitati are
// deliberately NOT submitted — they use BY_WATER_COLD weighting and no per-unit June water
// readings exist yet; allocation.service.ts throws rather than falling back to equal (see the
// packet's _note). curent_scara/salubritate/comision_banca/interfon have no June invoice at all.
import fs from 'fs'
import path from 'path'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { TemplateService } from '../modules/billing/template.service'
import { PeriodService } from '../modules/period/period.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const JUNE = { code: '2026-06', start: '2026-06-01', end: '2026-06-30', due: '2026-07-15' }

function loadJson(f: string) { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, f), 'utf8')) }

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService) as any

  const def = loadJson('def.json')
  const packet = loadJson('actuals-2026-06.json')
  const cpiByCode: Record<string, number> = Object.fromEntries(
    (def.structure || []).filter((u: any) => u.cpi != null).map((u: any) => [u.code, Number(u.cpi)]),
  )

  // ── config patches (idempotent, same as the April/May seed) ──
  const cpiRule = (def.allocationRules || []).find((r: any) => r.code === 'BY_CPI')
  const cpiWeights = cpiRule?.params?.weights || cpiByCode
  for (const f of await prisma.fund.findMany({ where: { communityId: COMM } })) {
    const a = (f.allocation as any) || {}
    if (a.method === 'BY_CPI') await prisma.fund.update({ where: { id: f.id }, data: { allocation: { ...a, method: 'EXPLICIT', weights: cpiWeights } } })
  }
  for (const et of await prisma.expenseType.findMany({ where: { communityId: COMM } })) {
    const p = (et.params as any) || {}
    if (!p.fundCode) await prisma.expenseType.update({ where: { id: et.id }, data: { params: { ...p, fundCode: def.expenseFundCode || 'EXPENSES' } } })
  }

  // ── period: June must chain from May's dueEnd — May must already be CLOSED ──
  const may = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: '2026-05' } } })
  if (!may || may.status !== 'CLOSED') throw new Error('May (2026-05) must be CLOSED before computing June')

  const [jy, jm] = JUNE.code.split('-').map(Number)
  const junePeriod = await prisma.period.upsert({
    where: { communityId_code: { communityId: COMM, code: JUNE.code } },
    update: { startDate: new Date(JUNE.start), endDate: new Date(JUNE.end), dueDate: new Date(JUNE.due), status: 'OPEN', preparedAt: null, closedAt: null },
    create: { communityId: COMM, code: JUNE.code, seq: jy * 12 + jm, status: 'OPEN', startDate: new Date(JUNE.start), endDate: new Date(JUNE.end), dueDate: new Date(JUNE.due) },
  })

  // ── per-unit SQM (CPI) only — static, needed by the BY_CPI leaves. No RESIDENTS/WATER_COLD. ──
  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  let nSqm = 0
  for (const u of units) {
    if (cpiByCode[u.code] == null) continue
    await prisma.periodMeasure.upsert({
      where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId: COMM, periodId: junePeriod.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'SQM' } },
      update: { value: cpiByCode[u.code], origin: 'ADMIN', meterId: `SQM-${u.code}` },
      create: { communityId: COMM, periodId: junePeriod.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'SQM', value: cpiByCode[u.code], origin: 'ADMIN', meterId: `SQM-${u.code}` },
    })
    nSqm++
  }
  console.log(`unit measures: SQM=${nSqm} (RESIDENTS/WATER_COLD intentionally not seeded — see packet _note)`)

  // ── post the 3 safe actuals (grouped by template) ──
  const groups = new Map<string, { values: Record<string, any>; meta: any }>()
  for (const it of (packet.items || [])) {
    const g = groups.get(it.templateCode) || { values: {}, meta: {} }
    if (Number(it.amount) > 0) g.values[it.detailKey] = Number(it.amount)
    g.meta.invoiceNumber = g.meta.invoiceNumber ?? it.invoiceNumber
    g.meta.invoiceGross = g.meta.invoiceGross ?? it.invoiceGross
    // Attribute every invoice's spend to June's close regardless of its true service period (same
    // convention as May's RC-0093: the true service window lives in the packet, not the ledger).
    g.meta.serviceStartPeriod = JUNE.code
    g.meta.serviceEndPeriod = JUNE.code
    groups.set(it.templateCode, g)
  }
  for (const [templateCode, g] of groups) {
    if (!Object.keys(g.values).length) continue
    await templates.saveBillTemplateState(COMM, JUNE.code, templateCode, [], { state: 'SUBMITTED', values: { ...g.values, ...g.meta } })
    console.log(`  posted ${templateCode}: ${JSON.stringify(g.values)}`)
  }

  // ── close ALL bill/meter template instances (prepare() requires every template closed, not just
  //    the ones with data — getEditable() checks instance state, allocation only runs for submitted
  //    bills, so unsubmitted templates post zero charge). ──
  for (const b of await prisma.billTemplate.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })) {
    await prisma.billTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: junePeriod.id, templateId: b.id } },
      update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: junePeriod.id, templateId: b.id, state: 'CLOSED' },
    })
  }
  for (const mt of await prisma.meterEntryTemplate.findMany({ where: { communityId: COMM }, select: { id: true } })) {
    await prisma.meterEntryTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: junePeriod.id, templateId: mt.id } },
      update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: junePeriod.id, templateId: mt.id, state: 'CLOSED' },
    })
  }

  await periods.prepare(COMM, JUNE.code)
  await periods.approve(COMM, JUNE.code)
  console.log(`  ✅ ${JUNE.code} prepared + approved (chained from May's dueEnd)`)

  // ── report ──
  const juneDebt: any[] = await prisma.$queryRawUnsafe(
    `select round(sum(due_end),2)::float8 debt, round(sum(due_start),2)::float8 opening, round(sum(charges),2)::float8 charges, round(sum(payments),2)::float8 payments
       from be_statement where community_id=$1 and period_id=$2`, COMM, junePeriod.id)
  console.log(`June statement totals: opening=${juneDebt[0]?.opening} charges=${juneDebt[0]?.charges} payments=${juneDebt[0]?.payments} → DEBT(dueEnd)=${juneDebt[0]?.debt}`)
  const charged: any[] = await prisma.$queryRawUnsafe(
    `select cc.source_key, round(cc.amount,2)::float8 amount from community_charge cc
      where cc.community_id=$1 and cc.period_id=$2 and cc.source_type='EXPENSE' order by cc.source_key`, COMM, junePeriod.id)
  console.log('expense charges posted:'); for (const r of charged) console.log(`  ${r.source_key}: ${r.amount}`)
  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
