// Permanent record of the cross-fund credit transfers declared this cycle, so a fresh reseed
// reproduces them instead of leaving June's Reabilitare 1/2/3 and Rulment balances at their raw,
// pre-transfer state. Each one is a real PAYMENT_REATTRIB correction (double-entry: minus on
// fromFund, plus on toFund — see period.service.ts's deriveCorrectionLegs), not a manual ledger edit.
//
// - Fikl Emil (unit 31): May's per-fund payment (12,676.78 RON, cash-2026-06.json ref FT26196GJ8C0)
//   was restricted to a single REABILITARE_3 allocationSpec line to avoid FIFO leakage into
//   EXPENSES/RULMENT's own open charges — that folded a 208.79 EXPENSES credit and a 14.52 RULMENT
//   credit into REABILITARE_3's advance. These two transfers move that credit to the funds it was
//   actually meant to cover, so Restanțe (due_start − payments) reads clean on EXPENSES/RULMENT too,
//   not just due_end.
// - Brînzeu Adina (SAD 1 + SAD 2/2): a June payment (3,212.70 RON) overshot May's Reabilitare 1
//   arrears (1,820.70), leaving a 1,392.00 credit stuck on Reabilitare 1. Per the admin's own
//   allocation: 1,361.80 clears Reabilitare 2 exactly to zero, the remaining 30.20 goes to Rulment.
// - Macri Nicodemo/Francesco/Antonio (Ap 11 + Ap 11A): a longstanding pre-April Reabilitare 1 credit
//   (-6,032.00) exactly matches two real reconciliation entries from Registru Bancă cont EUR
//   (cash-2026-06.json n=82 "Ap 11 reconciliere fonduri" 5,743.00 + n=84 "Ap 11A reconciliere
//   fonduri" 289.00 — both already imported as CashTx-only rows, no BE-ledger effect since they're
//   ADJUSTMENT not PAYMENT kind) — both move Reabilitare 1 → Reabilitare 2, mirroring the bank
//   register exactly (an earlier single-line 6,032.00 → Reabilitare 3 attempt was wrong and voided).
//
// Idempotent: skips any (billingEntity, fromFund, toFund, amount) tuple that already has an ACTIVE
// PAYMENT_REATTRIB correction for the target period.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { CorrectionsModule } from '../modules/corrections/corrections.module'
import { CorrectionsService } from '../modules/corrections/corrections.service'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, CorrectionsModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = '2026-06' // must be the community's currentPeriod() (latest OPEN/PREPARED) when this runs

const transfers = [
  { beName: 'Fikl Emil', fromFund: 'EXPENSES', toFund: 'REABILITARE_3', amount: 208.79,
    note: 'Transfer credit Expenses → Reabilitare 3, Fikl Emil — reface restricția allocationSpec-ului plății FT26196GJ8C0 (12676.78, restrânsă la Reabilitare 3 ca să nu se scurgă via FIFO în Expenses/Rulment).' },
  { beName: 'Fikl Emil', fromFund: 'RULMENT', toFund: 'REABILITARE_3', amount: 14.52,
    note: 'Transfer credit Rulment → Reabilitare 3, Fikl Emil — vezi nota de mai sus (aceeași plată FT26196GJ8C0).' },
  { beName: 'Brînzeu Adina', fromFund: 'REABILITARE_1', toFund: 'REABILITARE_2', amount: 1361.80,
    note: 'Transfer credit Reabilitare 1 → Reabilitare 2, Brînzeu Adina (SAD 1 + SAD 2/2) — aduce Reabilitare 2 exact la 0, per decizia utilizatorului.' },
  { beName: 'Brînzeu Adina', fromFund: 'REABILITARE_1', toFund: 'RULMENT', amount: 30.20,
    note: 'Transfer credit Reabilitare 1 → Rulment, Brînzeu Adina (SAD 1 + SAD 2/2) — restul creditului după cei 1361.80 către Reabilitare 2.' },
  { beName: 'Macri Nicodemo', fromFund: 'REABILITARE_1', toFund: 'REABILITARE_2', amount: 5743.00,
    note: 'Transfer credit Reabilitare 1 → Reabilitare 2, Ap 11 — replică exact tranzacția reală din Registru Bancă cont EUR (n=82, 15.07.2026, "Ap 11 reconciliere fonduri", 5743.00).' },
  { beName: 'Macri Nicodemo', fromFund: 'REABILITARE_1', toFund: 'REABILITARE_2', amount: 289.00,
    note: 'Transfer credit Reabilitare 1 → Reabilitare 2, Ap 11A — replică exact tranzacția reală din Registru Bancă cont EUR (n=84, 15.07.2026, "Ap 11A reconciliere fonduri", 289.00).' },
]

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const corrections = app.get(CorrectionsService)
  const prisma = app.get(PrismaService) as any

  const existing = await prisma.correction.findMany({
    where: { communityId: COMM, type: 'PAYMENT_REATTRIB', status: 'ACTIVE', periodCode: PERIOD_CODE },
    select: { billingEntityId: true, payload: true, amount: true },
  })
  const key = (beId: string, from: string, to: string, amt: number) => `${beId}::${from}::${to}::${amt.toFixed(2)}`
  const already = new Set(existing.map((c: any) => key(c.billingEntityId, c.payload?.fromFund, c.payload?.toFund, Number(c.amount))))

  for (const t of transfers) {
    const be = await prisma.billingEntity.findFirst({ where: { communityId: COMM, name: { contains: t.beName } }, select: { id: true } })
    if (!be) { console.log(`  ⚠ BE not found: ${t.beName}`); continue }
    if (already.has(key(be.id, t.fromFund, t.toFund, t.amount))) { console.log(`  = already active: ${t.beName} ${t.fromFund}→${t.toFund} ${t.amount}`); continue }
    const r = await corrections.create(COMM, 'script:add-kralik-fund-reattributions', {
      type: 'PAYMENT_REATTRIB', billingEntityId: be.id, fromFund: t.fromFund, toFund: t.toFund, amount: t.amount, note: t.note,
    })
    console.log(`  created: ${t.beName} ${t.fromFund}→${t.toFund} ${t.amount} (${r.id}, period ${r.periodCode})`)
  }

  console.log('✅ done')
  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
