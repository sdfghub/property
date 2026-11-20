// August 2026: penalty write-offs (PENALTY_WRITEOFF → negative ADJUSTMENT on PENALIZARI), at the
// association's request — they cancel the July 2026 manual penalty overrides kept on Ap 1B (78.10)
// and Ap 11 (4.06) so those amounts are no longer owed. Unit-tagged so a multi-unit BE's per-unit
// split stays intact. Idempotent: skips a (BE, amount) write-off already ACTIVE for 2026-08.
//   npx ts-node --transpile-only src/scripts/add-kralik-august-penalty-writeoffs.ts
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { CorrectionsModule } from '../modules/corrections/corrections.module'
import { CorrectionsService } from '../modules/corrections/corrections.service'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, CorrectionsModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = '2026-08' // must be the community's currentPeriod() (latest OPEN/PREPARED) when this runs

const writeoffs = [
  { beCode: 'BE_MATEI_VIOREL', unitCode: '400191-C1-U28-AP 1/B', amount: 78.1,
    note: 'Scutire penalizări Ap 1B: 78.10 lei — anulează penalitatea Iulie 2026 setată manual (78.10, conform HomeFile), la cererea administratorului.' },
  { beCode: 'BE_MACRI_NICODEMO_MACRI_FRANCESCO_MACRI_ANTONIO', unitCode: '400191-C1-U32-AP 11', amount: 4.06,
    note: 'Scutire penalizări Ap 11: 4.06 lei — anulează penalitatea Iulie 2026 setată manual (4.06, conform HomeFile; ca în lista HomeFile August 2026), la cererea administratorului.' },
]

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const corrections = app.get(CorrectionsService)
  const prisma = app.get(PrismaService) as any
  try {
    for (const w of writeoffs) {
      const be = await prisma.billingEntity.findFirst({ where: { communityId: COMM, code: w.beCode }, select: { id: true } })
      const unit = await prisma.unit.findFirst({ where: { communityId: COMM, code: w.unitCode }, select: { id: true } })
      if (!be || !unit) throw new Error(`not found: ${w.beCode} / ${w.unitCode}`)
      const active = await prisma.correction.findMany({ where: { communityId: COMM, type: 'PENALTY_WRITEOFF', status: 'ACTIVE', periodCode: PERIOD_CODE, billingEntityId: be.id }, select: { amount: true } })
      const dup = active.some((c: any) => Math.abs(Number(c.amount) - w.amount) < 0.005) // Decimal vs float: compare numerically
      if (dup) { console.log(`  = already active: ${w.unitCode} ${w.amount}`); continue }
      const r = await corrections.create(COMM, 'script:add-kralik-august-penalty-writeoffs', {
        type: 'PENALTY_WRITEOFF', billingEntityId: be.id, unitId: unit.id, amount: w.amount, note: w.note,
      })
      if (r.periodCode !== PERIOD_CODE) throw new Error(`correction landed on ${r.periodCode}, expected ${PERIOD_CODE}`)
      console.log(`  created: ${w.unitCode} −${w.amount} (${r.id})`)
    }
  } finally {
    await app.close()
  }
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
