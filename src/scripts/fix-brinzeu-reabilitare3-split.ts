// Fix: FT26225F9HN1 (13.08.2026, 9,603.00 lei, Fond Reabilitare 3) was recorded as a single lump
// under SAD 2/2 alone. Confirmed by Adriana Dascal: it's actually for BOTH of Brînzeu Adina's
// units — SAD 1: 4,284.03, SAD 2/2: 5,318.87. The generic cash-import format has no way to split
// one transaction across two units of the same billing entity, so this sets the correct
// two-unit allocationSpec directly (see cash-2026-06.json's own _correctedSplit note on tx n=107).
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const REF = 'FT26225F9HN1'
const SAD1_AMOUNT = 4284.03
// 4284.03 + 5318.87 = 9602.90, 0.10 short of the payment's real 9603.00. A fixed line's leftover
// (the normal case here — REABILITARE_3 rarely has a discrete open charge to match) stays tagged
// with that line's own unitId, but any amount OUTSIDE the fixed lines entirely falls into the
// payment-level advance, which carries no unitId — so a 0.10 gap here left one unit's arrears
// short by that dime, breaking BeUnitStatement's per-unit-sum-must-equal-BE-total trust check
// (tolerance 0.015). Absorbed into SAD 2/2 so both lines sum to exactly 9603.00.
const SAD22_AMOUNT = 5318.97

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService) as any

  const payment = await prisma.payment.findFirst({ where: { communityId: COMM, providerRef: REF } })
  if (!payment) throw new Error(`Payment with providerRef ${REF} not found`)

  const fund = await prisma.fund.findFirst({ where: { communityId: COMM, code: 'REABILITARE_3' }, select: { id: true } })
  if (!fund) throw new Error('REABILITARE_3 fund not found')

  const sad1 = await prisma.unit.findFirst({ where: { communityId: COMM, code: '400191-C1-U5-SAD 1' }, select: { id: true } })
  const sad22 = await prisma.unit.findFirst({ where: { communityId: COMM, code: '400191-C1-U17-SAD 2/2' }, select: { id: true } })
  if (!sad1 || !sad22) throw new Error('SAD 1 / SAD 2/2 unit not found')

  const allocationSpec = [
    { fundId: fund.id, unitId: sad1.id, amount: SAD1_AMOUNT },
    { fundId: fund.id, unitId: sad22.id, amount: SAD22_AMOUNT },
    { advance: true, fundId: fund.id, unitId: sad22.id },
  ]
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      allocationSpec,
      providerMeta: { ...(payment.providerMeta as any), unitLabel: 'SAD 1 + SAD 2/2 (split)', splitNote: `SAD 1: ${SAD1_AMOUNT}, SAD 2/2: ${SAD22_AMOUNT} (0.10 rounding vs the confirmed 5318.87 absorbed here so the lines sum to the real 9603.00 payment)` },
    },
  })
  console.log(`✅ ${REF} split: SAD 1 = ${SAD1_AMOUNT}, SAD 2/2 = ${SAD22_AMOUNT}`)

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
