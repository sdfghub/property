// Merge a Kralik water period's three charges (APA_RECE, CANALIZARE, PENALITATI_APA) into one
// APA_RECE line. waterDifferenceMethod stays APA_DIF — this is a pure consolidation, not a method
// change: APA_RECE, CANALIZARE and PENALITATI_APA all use identical split mechanics (same meters,
// same per-unit weight), so (a+b+c) split through APA_RECE's own leaves produces, for every unit,
// the exact same contorizată/diferență amounts as summing the three separate splits would. No
// resident's total water charge changes. First applied to 2026-06, then 2026-05 (same procedure).
//
// Usage: npx ts-node --transpile-only src/scripts/merge-kralik-june-apa-rece.ts <periodCode> <apaRece> <canal> <penalitati> <invoiceNumber>
// Run AFTER: npm run reopen:period -- Kralik <periodCode>
// Run BEFORE: npm run prepare:period -- Kralik <periodCode>
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { TemplateService } from '../modules/billing/template.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = process.argv[2] || '2026-06'
const apaRece = Number(process.argv[3] ?? 1018.41)
const canal = Number(process.argv[4] ?? 986.31)
const penalitati = Number(process.argv[5] ?? 33.3)
const invoiceNumber = process.argv[6] || 'TMA10/1015558474'
const merged = Math.round((apaRece + canal + penalitati) * 100) / 100

const VALUES = {
  apa_rece: merged, // = apaRece + canal + penalitati (pre-merge components)
  canal: 0,
  penalitati: 0,
  invoiceNumber,
  invoiceGross: merged,
  serviceStartPeriod: PERIOD_CODE,
  serviceEndPeriod: PERIOD_CODE,
}

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)
  const prisma = new PrismaClient()

  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: PERIOD_CODE } } })
  if (!period) throw new Error(`Period ${PERIOD_CODE} not found`)
  if (period.status !== 'OPEN') throw new Error(`Period must be OPEN (currently ${period.status}) — run reopen:period first`)

  console.log(`Merging ${PERIOD_CODE}: apa_rece(${apaRece}) + canal(${canal}) + penalitati(${penalitati}) = ${merged}`)
  console.log('Step 1/3: resubmitting BILL_APA_RECE with merged apa_rece value...')
  await templates.saveBillTemplateState(COMM, PERIOD_CODE, 'BILL_APA_RECE', [], { state: 'SUBMITTED', values: VALUES })
  console.log('  ✅ submitted')

  console.log('Step 2/3: deleting stale CANALIZARE/PENALITATI_APA charges for this period...')
  const stale = await prisma.communityCharge.findMany({
    where: { communityId: COMM, periodId: period.id, sourceType: 'VENDOR_INVOICE', sourceKey: { in: ['canal', 'penalitati'] } },
    select: { id: true, sourceKey: true, amount: true },
  })
  if (!stale.length) {
    console.log('  (none found — already clean)')
  } else {
    for (const c of stale) console.log(`  - ${c.sourceKey}: ${c.amount} (charge ${c.id})`)
    await prisma.communityChargeLine.deleteMany({ where: { chargeId: { in: stale.map((s) => s.id) } } })
    await prisma.communityCharge.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
    console.log(`  ✅ deleted ${stale.length} stale charge(s)`)
  }

  console.log('Step 3/3: re-closing BILL_APA_RECE...')
  await templates.saveBillTemplateState(COMM, PERIOD_CODE, 'BILL_APA_RECE', [], { state: 'CLOSED', values: VALUES })
  console.log('  ✅ closed')

  await prisma.$disconnect()
  await app.close()
  console.log(`Done. Now run: npm run prepare:period -- Kralik ${PERIOD_CODE}`)
}

main().catch((e) => { console.error(e?.message || e); process.exit(1) })
