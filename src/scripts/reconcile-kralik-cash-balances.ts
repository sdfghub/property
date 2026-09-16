// Reconcile Kralik's 3 cash/bank accounts against the association's real registers
// (Registru Bancă, Registru Bancă cont Euro Libra, Registru Casă — 01.07.2026 to 19.08.2026,
// found under Documents/_Vicusia/Kralik/2026-06/) at the user's request.
//
// Two distinct problems, both stemming from CashTx having no stored opening balance and the
// imported history only covering activity from ~2026-06-11 onward:
//
// 1. RON bank + petty cash: the computed balance (sum IN − OUT) is simply missing whatever the
//    account held before the imported window. Fixed with one ADJUSTMENT CashTx per account for
//    the exact delta to the register's real final balance.
//
// 2. EUR bank: the register's PDF prints RON-equivalent amounts under an "Încasare"/"Sold" column
//    even though the account itself holds EUR — so the 11 CashTx rows imported for it got the RON
//    figure stored as if it were the EUR amount (and 52813.46 is the RON equivalent of the real
//    9960.28 EUR opening balance, not an EUR figure). The user supplied the real EUR amounts for
//    the three logical transactions (Catargiu 1668, Macri 3000, Florea 2000 EUR), which cross-check
//    exactly against a single implied rate of 5.175 RON/EUR across every sub-row (fund splits and
//    wash/correction pairs included) — so every row is corrected using that same rate, each one
//    tagged with `meta.fxRateEstimate` + `meta.ronEquivalent` for traceability (this is an
//    estimate, per the user's own framing — sub-cent rounding across split lines is expected).
import { PrismaClient } from '@prisma/client'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { CashService } from '../modules/billing/cash.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const prisma = new PrismaClient()

const COMM_ID = 'Kralik'
const EXPENSES_FUND = 'cmt0672vw000114i0qib9qazg' // Cheltuieli Intreținere — general operating fund
const EUR_ACCOUNT = 'cmt09ss750001duedimbi47nw' // Libra - EUR
const BANK_RON_ACCOUNT = 'cmt0672bk0039jzgshsnrxdg9' // Libra - RON
const CASH_RON_ACCOUNT = 'cmt0672bo003bjzgsozrct0sq' // Casă numerar RON
const EUR_RATE = 5.175 // implied by Catargiu (8631.76/1668), Macri (15525/3000), Florea (10350/2000)

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

async function fixEuroTransactions() {
  const rows = await prisma.cashTx.findMany({ where: { communityId: COMM_ID, accountId: EUR_ACCOUNT } })
  for (const r of rows) {
    if ((r.meta as any)?.fxRateEstimate) { console.log(`  tx ${r.id}: already fixed, skipping`); continue }
    const ronEquivalent = Number(r.amount)
    const realEur = round2(ronEquivalent / EUR_RATE)
    await prisma.cashTx.update({
      where: { id: r.id },
      data: {
        amount: realEur,
        meta: { ...(r.meta as any), fxRateEstimate: EUR_RATE, ronEquivalent },
      },
    })
    console.log(`  tx ${r.id}: ${ronEquivalent} (mislabeled RON) -> ${realEur} EUR`)
  }
  console.log(`Fixed ${rows.length} EUR transaction rows`)
}

async function main() {
  console.log('Correcting EUR account transaction amounts (RON-equivalent -> real EUR)...')
  await fixEuroTransactions()

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const cash = app.get(CashService)

  const bal = await cash.getBalances(COMM_ID)
  const balanceOf = (accountId: string) => bal.accounts.find((a) => a.id === accountId)?.balance ?? 0

  const RECONCILIATIONS = [
    { accountId: BANK_RON_ACCOUNT, label: 'Registru Bancă (RON)', after: 105860.85, currency: 'RON' },
    { accountId: EUR_ACCOUNT, label: 'Registru Bancă cont Euro Libra (sold inițial real, EUR)', after: 9960.28 + balanceOf(EUR_ACCOUNT), currency: 'EUR' },
    { accountId: CASH_RON_ACCOUNT, label: 'Registru Casă', after: 2047.83, currency: 'RON' },
  ]

  console.log('\nPosting opening-balance reconciliation adjustments...')
  for (const r of RECONCILIATIONS) {
    const before = balanceOf(r.accountId)
    const delta = round2(r.after - before)
    if (Math.abs(delta) < 0.005) { console.log(`${r.label}: already matches (${r.after}), skipping`); continue }
    const tx = await cash.createTx(COMM_ID, {
      accountId: r.accountId,
      fundId: EXPENSES_FUND,
      amount: Math.abs(delta),
      currency: r.currency,
      direction: delta > 0 ? 'IN' : 'OUT',
      kind: 'ADJUSTMENT',
      status: 'POSTED',
      ts: '2026-07-01',
      refType: 'OPENING_BALANCE_RECONCILE',
      refId: r.accountId,
      memo:
        `RO: Ajustare de reconciliere — soldul calculat din tranzacțiile importate (${before} ${r.currency}) nu ` +
        `includea soldul real existent înainte de fereastra importată. Adus la ${r.after} ${r.currency}, soldul real ` +
        `din ${r.label}. EN: Reconciliation adjustment — the balance computed from imported transactions ` +
        `(${before} ${r.currency}) didn't include the real balance carried in from before the imported window. ` +
        `Brought to ${r.after} ${r.currency}, the real balance per ${r.label}.`,
    })
    console.log(`${r.label}: ${before} -> ${r.after} ${r.currency} (${delta > 0 ? '+' : ''}${delta}) -> tx ${tx.id}`)
  }

  await app.close()
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e?.message || e); await prisma.$disconnect(); process.exit(1) })
