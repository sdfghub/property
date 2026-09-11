// Fix: the July cash-register payments were imported with only `providerMeta.funds` (audit
// metadata), not a real `allocationSpec` — so PeriodService.prepare()'s payment reapplication
// falls back to generic FIFO auto-spread against THAT PERIOD's own open charges only, which throws
// "Payment exceeds open charges" once a payment (e.g. a large REABILITARE fund contribution) is
// bigger than what that unit happens to owe for July alone. Same fix as
// fix-kralik-june-payment-specs.ts, targeting the July batch instead: every payment gets fixed
// per-fund lines plus an advance fallback into its own dominant fund, so leftover money has a safe
// home instead of throwing.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService) as any

  const funds = await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const fundId = new Map(funds.map((f: any) => [f.code, f.id]))

  const payments = await prisma.payment.findMany({ where: { communityId: COMM, provider: 'cash-register-2026-07' }, select: { id: true, amount: true, providerMeta: true } })

  let updated = 0, skippedZero = 0, advanceOnly = 0
  for (const p of payments) {
    const fundsMap: Record<string, number> = (p.providerMeta as any)?.funds || {}
    const entries = Object.entries(fundsMap).filter(([, amt]) => Number.isFinite(Number(amt)) && Math.abs(Number(amt)) >= 0.005)
    if (!entries.length) { skippedZero++; continue }
    const hasNegative = entries.some(([, amt]) => Number(amt) < 0)
    let dominantCode: string | null = null, dominantAbs = -1
    for (const [code, amt] of entries) {
      const v = Math.abs(Number(amt))
      if (v > dominantAbs) { dominantAbs = v; dominantCode = code }
    }
    if (!dominantCode || !fundId.get(dominantCode)) { skippedZero++; continue }
    const lines: any[] = []
    if (hasNegative) {
      lines.push({ advance: true, fundId: fundId.get(dominantCode) })
      advanceOnly++
    } else {
      for (const [code, amt] of entries) {
        const fid = fundId.get(code)
        if (!fid) { console.log(`  ⚠ unknown fund code ${code} on payment ${p.id}`); continue }
        lines.push({ fundId: fid, amount: Number(Number(amt).toFixed(4)) })
      }
      lines.push({ advance: true, fundId: fundId.get(dominantCode) })
    }
    await prisma.payment.update({ where: { id: p.id }, data: { allocationSpec: lines } })
    updated++
  }
  console.log(`✅ allocationSpec set on ${updated} payments (${advanceOnly} advance-only due to a negative component, ${skippedZero} had no usable fund lines)`)

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
