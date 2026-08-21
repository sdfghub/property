// Correction: cross-checking cash-2026-06.json against the association's own Registru Bancă (not just
// ExtrasCont, the raw bank statement) found 3 owner payments that are genuine bank transactions but do
// NOT appear anywhere in Registru Bancă — the register has no entries at all for 10.08 (n=93) and none
// for 11.08 besides one unrelated one (n=101, n=102; the Pricop Alexandra 2742.87 on 11.08 IS a match
// for n=100, just logged under a later date than the bank statement — n=100 is NOT a gap, only these 3
// are). Per instruction: exclude their amounts from June's Încasări (park under cycleCode='2026-07',
// same mechanism as the earlier date-cutoff exclusions) and record a TODO correction per payment so an
// admin can reconcile the Registru Bancă gap before deciding which period it actually belongs to.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { CorrectionsModule } from '../modules/corrections/corrections.module'
import { CorrectionsService } from '../modules/corrections/corrections.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule, CorrectionsModule] })
class ScriptModule {}

const COMM = 'Kralik'

const GAP_PAYMENTS: Array<{ refIdSuffix: string; beCode: string; amount: number; note: string }> = [
  {
    refIdSuffix: 'cash:2026-06:93',
    beCode: 'BE_CODREA_RUXANDRA_GEORGETA',
    amount: 100.51,
    note: 'RO: Încasare de 100,51 lei (Bolog Bleich Oana, ap. 3, "intreținere luna iunie 2026", ref FT26222C9L8Z, 10.08.2026) apare în ExtrasCont lei.pdf, dar Registru Bancă nu are nicio înregistrare pentru 10.08.2026. Exclusă din Încasările lunii iunie până la reconciliere — probabil va fi înregistrată pentru luna iulie. EN: A 100.51 RON receipt (Bolog Bleich Oana, unit 3, "intreținere luna iunie 2026", ref FT26222C9L8Z, 2026-08-10) appears in the raw bank statement but Registru Bancă has no entries at all for 2026-08-10. Excluded from June\'s collections pending reconciliation — likely to post against July.',
  },
  {
    refIdSuffix: 'cash:2026-06:101',
    beCode: 'BE_CATARGIU_CONSTANTIN',
    amount: 503.83,
    note: 'RO: Încasare de 503,83 lei (Gloria Lucia Catargiu, ap. 4A, "martie 2026, Fond rulment+reparații", ref FT26223C77Z7, 11.08.2026) apare în ExtrasCont lei.pdf, dar nu apare în Registru Bancă. Exclusă din Încasările lunii iunie până la reconciliere — probabil va fi înregistrată pentru luna iulie. EN: A 503.83 RON receipt (Gloria Lucia Catargiu, unit 4A, "martie 2026, Fond rulment+reparații", ref FT26223C77Z7, 2026-08-11) appears in the raw bank statement but not in Registru Bancă. Excluded from June\'s collections pending reconciliation — likely to post against July.',
  },
  {
    refIdSuffix: 'cash:2026-06:102',
    beCode: 'BE_CATARGIU_CONSTANTIN',
    amount: 51.55,
    note: 'RO: Încasare de 51,55 lei (Gloria Lucia Catargiu, ap. 12 (SAD4/A), "martie 2026", ref FT26223RV6F0, 11.08.2026) apare în ExtrasCont lei.pdf, dar nu apare în Registru Bancă. Exclusă din Încasările lunii iunie până la reconciliere — probabil va fi înregistrată pentru luna iulie. EN: A 51.55 RON receipt (Gloria Lucia Catargiu, unit 12 (SAD4/A), "martie 2026", ref FT26223RV6F0, 2026-08-11) appears in the raw bank statement but not in Registru Bancă. Excluded from June\'s collections pending reconciliation — likely to post against July.',
  },
]

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService) as any
  const corrections = app.get(CorrectionsService)

  for (const g of GAP_PAYMENTS) {
    const p = await prisma.payment.findFirst({ where: { communityId: COMM, refId: g.refIdSuffix }, select: { id: true, amount: true, providerMeta: true } })
    if (!p) { console.log(`  ⚠ payment ${g.refIdSuffix} not found`); continue }
    if (Number(p.amount) !== g.amount) console.log(`  ⚠ amount mismatch for ${g.refIdSuffix}: expected ${g.amount}, found ${p.amount}`)
    await prisma.payment.update({ where: { id: p.id }, data: { providerMeta: { ...(p.providerMeta as any), cycleCode: '2026-07' } } })
    console.log(`  parked ${g.refIdSuffix} (${p.amount} RON) → cycleCode 2026-07`)

    const be = await prisma.billingEntity.findFirst({ where: { communityId: COMM, code: g.beCode }, select: { id: true } })
    const res = await corrections.create(COMM, 'system:register-gap-audit', {
      type: 'MANUAL_ADJUSTMENT',
      status: 'TODO',
      billingEntityId: be.id,
      fundCode: 'EXPENSES',
      amount: g.amount,
      note: g.note,
    })
    console.log(`  correction created: ${res.id}`)
  }

  // n=100 was previously mislabeled as missing from Registru Bancă — it IS present there (row 56,
  // 11.08.2026, same amount/unit), just logged under a later date than when it cleared the bank.
  // Fix the memo so it no longer claims a gap that doesn't exist; no financial change.
  const p100 = await prisma.payment.findFirst({ where: { communityId: COMM, refId: 'cash:2026-06:100' }, select: { id: true, providerMeta: true } })
  if (p100) {
    const meta = { ...(p100.providerMeta as any), memo: 'Tabel mai 2026 — bancă 27.07 (FT26208SW0PD), Registru Bancă îl înregistrează la 11.08 (același sold, fără ref)' }
    await prisma.payment.update({ where: { id: p100.id }, data: { providerMeta: meta } })
    console.log('  corrected n=100 memo (was NOT actually missing from Registru Bancă)')
  }

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
