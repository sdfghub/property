// Kralik: import June 2026-06 actuals ONLY — no prepare, no approve. Leaves the period OPEN and
// editable (e.g. to add the Aquatim water bill once per-unit readings exist) instead of running
// the full close cycle. If June is currently CLOSED (from a prior full-cycle run), this properly
// reopens it first via PeriodService.reopen() (cleans up CLOSE_FINAL ledger/statements/penalty
// buckets) rather than leaving stale close artifacts behind.
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

  const may = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: '2026-05' } } })
  if (!may || may.status !== 'CLOSED') throw new Error('May (2026-05) must be CLOSED before June can chain off it')

  let june = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: JUNE.code } } })
  if (!june) {
    const [jy, jm] = JUNE.code.split('-').map(Number)
    june = await prisma.period.create({
      data: { communityId: COMM, code: JUNE.code, seq: jy * 12 + jm, status: 'OPEN', startDate: new Date(JUNE.start), endDate: new Date(JUNE.end), dueDate: new Date(JUNE.due) },
    })
    console.log('created period 2026-06 (OPEN)')
  } else if (june.status === 'CLOSED' || june.status === 'PREPARED') {
    await periods.reopen(COMM, JUNE.code)
    june = await prisma.period.findUnique({ where: { id: june.id } })
    console.log(`reopened 2026-06 (was ${june.status === 'OPEN' ? 'CLOSED/PREPARED' : june.status}) — cleaned up prior close artifacts`)
  } else {
    console.log('2026-06 already OPEN')
  }

  // ── per-unit SQM (CPI) — static, needed by the BY_CPI leaves ──
  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  let nSqm = 0
  for (const u of units) {
    if (cpiByCode[u.code] == null) continue
    await prisma.periodMeasure.upsert({
      where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId: COMM, periodId: june.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'SQM' } },
      update: { value: cpiByCode[u.code], origin: 'ADMIN', meterId: `SQM-${u.code}` },
      create: { communityId: COMM, periodId: june.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'SQM', value: cpiByCode[u.code], origin: 'ADMIN', meterId: `SQM-${u.code}` },
    })
    nSqm++
  }
  console.log(`unit measures: SQM=${nSqm}`)

  // ── import the 3 known invoices as bill-template submissions — no template closing, no prepare/approve ──
  const groups = new Map<string, { values: Record<string, any>; meta: any }>()
  for (const it of (packet.items || [])) {
    const g = groups.get(it.templateCode) || { values: {}, meta: {} }
    if (Number(it.amount) > 0) g.values[it.detailKey] = Number(it.amount)
    g.meta.invoiceNumber = g.meta.invoiceNumber ?? it.invoiceNumber
    g.meta.invoiceGross = g.meta.invoiceGross ?? it.invoiceGross
    g.meta.serviceStartPeriod = JUNE.code
    g.meta.serviceEndPeriod = JUNE.code
    groups.set(it.templateCode, g)
  }
  for (const [templateCode, g] of groups) {
    if (!Object.keys(g.values).length) continue
    await templates.saveBillTemplateState(COMM, JUNE.code, templateCode, [], { state: 'SUBMITTED', values: { ...g.values, ...g.meta } })
    console.log(`  imported ${templateCode}: ${JSON.stringify(g.values)}`)
  }

  console.log('✅ June actuals imported. Period left OPEN — no prepare, no approve.')
  await app.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
