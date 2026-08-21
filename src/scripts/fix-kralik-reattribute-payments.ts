// Correction: the 62 cash/bank-register payments stay attributed to JUNE (cycleCode='2026-06') — the
// earlier idea of moving all of them to May was wrong and is reverted here. What IS wrong: 12 of them
// are dated after June's own afișare cutoff (cash register: after 2026-08-10; bank register: after
// 2026-08-11, one day later per bank clearing lag) — Guțuleac, Soames, Fikl Emil (x2), Codrea (x2),
// Catargiu Constantin, Brînzeu Adina (x2), Popescu Miruna, Jakabhazi, Alexandru Grosu. Those fall
// outside June's collection window entirely (residents couldn't have been paying June's avizier before
// it was displayed) and belong to a future cycle not yet processed, so they're parked under
// cycleCode='2026-07' — excluded from June (and not moved to May, which stays untouched/CLOSED).
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
// cash:2026-06:<n> refIds to park as a future cycle, excluded from June
const PARK_N = new Set([79, 80, 103, 104, 105, 106, 107, 108, 109, 110, 111, 68])

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService) as any

  const payments = await prisma.payment.findMany({
    where: { communityId: COMM, provider: 'cash-register-2026-06' },
    select: { id: true, refId: true, amount: true, providerMeta: true },
  })

  let kept = 0, parked = 0
  for (const p of payments) {
    const meta = (p.providerMeta as any) || {}
    const m = /^cash:2026-06:(\d+)$/.exec(p.refId || '')
    const n = m ? Number(m[1]) : null
    const park = n != null && PARK_N.has(n)
    const newCycle = park ? '2026-07' : '2026-06'
    await prisma.payment.update({
      where: { id: p.id },
      data: { providerMeta: { ...meta, cycleCode: newCycle } },
    })
    if (park) { parked++; console.log(`  parked n=${n} amount=${p.amount} payer=${meta.payer}`) }
    else kept++
  }
  console.log(`✅ ${kept} payments kept on cycleCode 2026-06, ${parked} parked as 2026-07`)

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
