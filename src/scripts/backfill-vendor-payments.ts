// Record real vendor payments for Kralik, transcribed from the actual bank/cash registers
// (Registru Bancă, Registru Casă — 01.07.2026 to 19.08.2026) at the user's request. Uses the
// official VendorInvoiceService.createVendorPayment flow (same as the PayBillModal UI path), so
// it also posts the fund ledger entry and the matching CashTx row — not a raw DB write.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { VendorInvoiceService } from '../modules/billing/vendor-invoice.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const BANK_ACCOUNT = 'cmt0672bk0039jzgshsnrxdg9' // Libra - RON
const PETTY_ACCOUNT = 'cmt0672bo003bjzgsozrct0sq' // Casă numerar RON

const PAYMENTS: Array<{ invoiceId: string; number: string; amount: number; ts: string; accountId: string; account: string }> = [
  // Registru Bancă, rând 63: "Plată Retim Ecologic Service S.A." 14.08.2026, 686.32 lei — exact match TM 19690906.
  { invoiceId: 'cmt1ekays001hu00hy7kjnjrb', number: 'TM 19690906', amount: 686.32, ts: '2026-08-14', accountId: BANK_ACCOUNT, account: 'Bancă' },
  // Registru Bancă, rând 61: "Plată servicii de curatenie ... SC RICH CLEAN SRL" 14.08.2026, 840.00 lei — exact match RC 0107 (June).
  { invoiceId: 'cmt08cakt004m11sdteb9xs1c', number: 'RC 0107', amount: 840.00, ts: '2026-08-14', accountId: BANK_ACCOUNT, account: 'Bancă' },
  // Registru Bancă, rând 24: "Plată PRES SERV CURATENIE ... FCT NR RC 0093/08.07.2026" 13.07.2026, 840.00 lei — exact match RC-0093 (May).
  { invoiceId: 'cmt067dyq00p412qy6iqdn1ej', number: 'RC-0093', amount: 840.00, ts: '2026-07-13', accountId: BANK_ACCOUNT, account: 'Bancă' },
  // Registru Casă, rând 2: "Plată Schmidt & Co S.R.L." 10.07.2026, 336.00 lei — exact match SCHMIDT-2026-05.
  { invoiceId: 'cmt067e0400tg12qylrpd43hm', number: 'SCHMIDT-2026-05', amount: 336.00, ts: '2026-07-10', accountId: PETTY_ACCOUNT, account: 'Casă' },
]

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const svc = app.get(VendorInvoiceService)
  for (const p of PAYMENTS) {
    const payment = await svc.createVendorPayment(COMM, p.invoiceId, { amount: p.amount, ts: p.ts, accountId: p.accountId })
    console.log(`${p.number}: ${p.amount} RON on ${p.ts} (${p.account}) -> payment ${payment.id}`)
  }
  await app.close()
}

main().catch((e) => { console.error(e?.message || e); process.exit(1) })
