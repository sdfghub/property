// Correction: 6 payments dated 02.07–09.07.2026 got imported TWICE — once into the April cycle
// (cash-2026-05.json, the historical April/May injection, whose window ran through ~13.07) and again
// into the June cycle (cash-2026-06.json, built from Registru Bancă's 01.07–19.08 window, which
// overlaps the same dates). Same BE, same date, same amount, same fund split — confirmed duplicates,
// not two real transactions. April's copy is already baked into April's closed/approved dueEnd chain,
// so the June-cycle copy is the one removed here (Payment row + its ledger/cash-tx footprint).
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'

const DUPLICATE_JUNE_PAYMENT_IDS = [
  'cmt0a0l5x001zhdsnvs1ht9z8', // Dascăl Adriana, 09.07, 1727.00
  'cmt0a0l5c000fhdsn28d2zchz', // David Marius, 02.07, 2841.21
  'cmt0a0l5i000phdsnc95c23t9', // Grosu Alexandru, Pricop Alexandra, 02.07, 4122.70
  'cmt0a0l5n0011hdsnxshj5uc5', // Karacs Bebe, 03.07, 1500.00
  'cmt0a0l5p0017hdsnq9f65q6g', // Codrea Ruxandra-Georgeta, 08.07, 14.52 (Rulment)
  'cmt0a0l5q001bhdsnydaxb389', // Codrea Ruxandra-Georgeta, 08.07, 34.60 (Reparații)
]

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService) as any

  for (const paymentId of DUPLICATE_JUNE_PAYMENT_IDS) {
    const pay = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, amount: true, billingEntityId: true, refId: true } })
    if (!pay) { console.log(`  ⚠ payment ${paymentId} not found (already removed?)`); continue }

    const entries = await prisma.beLedgerEntry.findMany({
      where: { communityId: COMM, billingEntityId: pay.billingEntityId, refType: 'PAYMENT', refId: paymentId },
      select: { id: true },
    })
    if (entries.length) {
      const ids = entries.map((e: any) => e.id)
      await prisma.paymentApplication.deleteMany({ where: { chargeId: { in: ids } } })
      await prisma.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: { in: ids } } })
      await prisma.beLedgerEntry.deleteMany({ where: { id: { in: ids } } })
    }
    await prisma.paymentApplication.deleteMany({ where: { paymentId } })
    await prisma.cashTx.deleteMany({ where: { communityId: COMM, refType: 'BE_PAYMENT', refId: paymentId } })
    await prisma.payment.delete({ where: { id: paymentId } })
    console.log(`  removed duplicate payment ${pay.refId} (${pay.amount} RON), ${entries.length} ledger entries cleaned`)
  }

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
