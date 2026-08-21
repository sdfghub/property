// Fix: the 62 June payments were imported with only `providerMeta.funds` (audit metadata), not a real
// `allocationSpec` — so PeriodService.prepare()'s payment reapplication fell back to generic FIFO
// auto-spread, which doesn't respect fund targeting and fails once a fund runs out of open charges FOR
// THAT SPECIFIC UNIT — this isn't limited to REABILITARE_1 (already fully paid off community-wide): a
// low-arrears unit can exhaust ANY fund (e.g. plain EXPENSES) even though that fund has huge headroom
// community-wide. So every payment gets an advance fallback into its own dominant fund (the fund with
// the largest line in that payment) — the engine can only route a payment's combined leftover to ONE
// fund, so this is the best single choice per payment, not a perfect per-fund split.
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

  const payments = await prisma.payment.findMany({ where: { communityId: COMM, provider: 'cash-register-2026-06' }, select: { id: true, amount: true, providerMeta: true } })

  // AllocationSpecLine amounts must be > 0 (the API rejects negative fixed lines) — a couple of payments
  // have a negative fund component (money reattributed away from a fund within the same transaction,
  // e.g. David Marius, Fikl Emil). Those can't be expressed as fixedLines at all, so for those we skip
  // fixedLines entirely and give ONLY an advance-fallback line targeting the dominant fund by absolute
  // magnitude — this leaves automatic FIFO spread across all open charges in place (unchanged behavior)
  // but still gives leftover money a safe home instead of throwing "Payment exceeds open charges".
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
      // No fixedLines — pure automatic spread, with a safe advance fallback into the dominant fund.
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
