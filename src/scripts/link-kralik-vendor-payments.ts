// Kralik: make supplier payments visible under Plăți / Furnizori.
//
// The imported cash book (cash-2026-05/06.json + the later intake registers) booked every supplier
// payment only as an OUT CashTx — no VendorPayment, no link to an invoice — so every invoice showed
// as unpaid and the fund-paid suppliers (Profi Vent, Larisuk, Lala Antik, Adams, San Marco) didn't
// exist as vendors at all. Two passes, both idempotent:
//
// 1. Overlap dedup. cash-2026-05.json runs through 10.07 and cash-2026-06.json starts at 01.07, so the
//    01.07–10.07 lines were imported twice as CashTx (same account, fund, direction, amount and bank
//    reference). The owner Payment rows for those were already skipped (skipPayment), only the cash
//    rows doubled. The June-cycle copy is deleted (the source JSON now marks those lines `void`, so a
//    reseed doesn't bring them back).
//
// 2. Link each register OUT payment to its invoice through VendorInvoiceService.recordRegisterPayment
//    (no new cash row, no ledger legs — the register already moved the money). Payments with no
//    invoice in the app get an OPENING invoice (no accrual) via createOpeningInvoice, named after the
//    bank memo's invoice number where it has one.
//
//   npm run link:kralik-vendor-payments            (dry run)
//   npm run link:kralik-vendor-payments -- --apply
import { PrismaService } from '../modules/user/prisma.service'
import { VendorInvoiceService } from '../modules/billing/vendor-invoice.service'
import { bankLineKey } from '../modules/intake/intake-blockers'
import { ensurePaidOnlyInvoice } from './kralik-paid-only-invoice'

const COMM = 'Kralik'
const APPLY = process.argv.includes('--apply')

type Target =
  | { existing: Array<{ number: string; amount?: number }>; vendor: string }
  | { opening: { number?: string; issueDate?: string }; vendor: string }

// Keyed by the register line's bank reference + amount (the only stable identity a CashTx row has).
const LINKS: Array<{ ref: string; amount: number; target: Target; note?: string }> = [
  { ref: 'FT26162TF82Z', amount: 44374.33, target: { vendor: 'Profi Vent', opening: {} } },
  { ref: 'FT26166P03WJ', amount: 550, target: { vendor: 'RUSADMINISTRA', existing: [{ number: 'RUSAVIT-2026-05', amount: 550 }] }, note: 'partial: invoice is 800' },
  { ref: 'FT26166CC4DQ', amount: 840, target: { vendor: 'RICH CLEAN', opening: {} } },
  { ref: 'FT26166LSWVZ', amount: 1057.89, target: { vendor: 'Retim', opening: {} } },
  { ref: 'FT26166S6JDP', amount: 3000, target: { vendor: 'Aquatim', opening: {} } },
  { ref: 'FT26170LM8XK', amount: 4200, target: { vendor: 'Lala Antik Decor', opening: {} } },
  { ref: 'FT26177N6CY3', amount: 5000, target: { vendor: 'Lala Antik Decor', opening: {} } },
  { ref: 'FT261804MSCS', amount: 1000, target: { vendor: 'Aquatim', opening: {} } },
  { ref: 'FT26180SKRR8', amount: 6000, target: { vendor: 'Larisuk Construct', opening: {} } },
  { ref: 'FT26180LQQKM', amount: 10890, target: { vendor: 'Larisuk Construct', opening: {} } },
  { ref: 'FT261826W1B5', amount: 2500, target: { vendor: 'Lala Antik Decor', opening: { number: '0090', issueDate: '2026-07-01' } } },
  { ref: 'FT261841QM3Q', amount: 1840, target: { vendor: 'Lala Antik Decor', opening: { number: 'A0092', issueDate: '2026-07-02' } } },
  { ref: 'FT26190X930X', amount: 538.95, target: { vendor: 'Retim', opening: {} } },
  { ref: 'FT26190J1NGQ', amount: 1488.77, target: { vendor: 'Aquatim', opening: {} } },
  { ref: 'FT26190JR4C4', amount: 10444, target: { vendor: 'Lala Antik Decor', opening: { number: 'A0086', issueDate: '2026-06-19' } } },
  { ref: 'FT26190BLLNR', amount: 24200, target: { vendor: 'Larisuk Construct', opening: {} } },
  { ref: 'SCHA1129', amount: 336, target: { vendor: 'Schmidt', existing: [{ number: 'SCHMIDT-2026-05' }] } },
  { ref: 'OP53', amount: 840, target: { vendor: 'RICH CLEAN', existing: [{ number: 'RC-0093' }] } },
  { ref: 'FT2620577F0V', amount: 1875.5, target: { vendor: 'Retim', opening: {} } },
  { ref: 'FT26210QNQKQ', amount: 949.85, target: { vendor: 'Retim', opening: {} } },
  { ref: 'FT26222J5GZM', amount: 68.88, target: { vendor: 'PPC', existing: [{ number: '26EI09370543', amount: 68.88 }] }, note: 'partial: invoice is 72.83; bank memo says 26EI 09370643' },
  { ref: 'FT26222N386S', amount: 645.67, target: { vendor: 'Retim', existing: [{ number: 'TM19543339' }] } },
  { ref: 'FT26222VJN8V', amount: 1831.01, target: { vendor: 'Aquatim', opening: { number: '1015495562', issueDate: '2026-05-05' } } },
  { ref: 'op59', amount: 127023.38, target: { vendor: 'Profi Vent', opening: { number: 'PVT 0361', issueDate: '2026-08-06' } } },
  { ref: 'FT26226G60HM', amount: 686.32, target: { vendor: 'Retim', existing: [{ number: 'TM-19690906' }] } },
  { ref: 'FT26226PPPM7', amount: 840, target: { vendor: 'RICH CLEAN', existing: [{ number: 'RC-0107' }] } },
  { ref: 'FT26226FMBDS', amount: 1939.29, target: { vendor: 'Aquatim', existing: [{ number: 'TMA10/1015526960' }] }, note: '5.00 unapplied: invoice rows total 1934.29' },
  { ref: 'op64', amount: 4235, target: { vendor: 'Adams Construct', opening: { number: 'ADMRO 0359', issueDate: '2026-08-04' } } },
  { ref: 'op63', amount: 98010, target: { vendor: 'Larisuk Construct', opening: { number: 'SM 54', issueDate: '2026-08-10' } } },
  { ref: 'FT2625777G97', amount: 227.54, target: { vendor: 'San Marco Arte', opening: { number: 'SAN 1648', issueDate: '2026-07-06' } } },
  { ref: 'FT26257CT3BZ', amount: 840, target: { vendor: 'RICH CLEAN', existing: [{ number: 'RC 0121' }] } },
  { ref: 'FT26261WHXKZ', amount: 129684.12, target: { vendor: 'Larisuk Construct', opening: { number: 'SM 55', issueDate: '2026-09-15' } } },
]

// Libra's statement-period fee invoice is paid by the individual commission debits (kind OTHER).
const LIBRA_FEES = { number: '2026.08.10-09.10', from: '2026-08-10', toExcl: '2026-09-11', amount: 82 }

const r2 = (n: number) => Math.round(n * 100) / 100

async function dedupOverlap(prisma: PrismaService) {
  const rows = await prisma.cashTx.findMany({
    where: { communityId: COMM, refType: { in: ['CASH_REGISTER', 'CASH_REGISTER_2026_06'] } },
    select: { id: true, refType: true, accountId: true, fundId: true, direction: true, amount: true, meta: true, ts: true, memo: true },
  })
  const key = (r: any) => [r.accountId, r.fundId, r.direction, Number(r.amount).toFixed(4), (r.meta as any)?.ref ?? ''].join('|')
  const may = new Set(rows.filter((r) => r.refType === 'CASH_REGISTER' && (r.meta as any)?.ref).map(key))
  const dups = rows.filter((r) => r.refType === 'CASH_REGISTER_2026_06' && (r.meta as any)?.ref && may.has(key(r)))
  console.log(`1. overlap duplicates (June-cycle copies of lines already in the April/May register): ${dups.length}`)
  for (const d of dups) console.log(`   ${d.ts.toISOString().slice(0, 10)} ${d.direction} ${Number(d.amount).toFixed(2).padStart(10)}  ${(d.meta as any).ref}  ${d.memo ?? ''}`)
  if (APPLY && dups.length) await prisma.cashTx.deleteMany({ where: { id: { in: dups.map((d) => d.id) } } })
  return new Set(dups.map((d) => d.id))
}

async function main() {
  const prisma = new PrismaService()
  await prisma.$connect()
  const svc = new VendorInvoiceService(prisma)
  try {
    console.log(APPLY ? '== APPLY ==' : '== DRY RUN (pass --apply to write) ==')
    const dupIds = await dedupOverlap(prisma)

    const out = (await prisma.cashTx.findMany({
      where: { communityId: COMM, direction: 'OUT', kind: 'PAYMENT', refType: { startsWith: 'CASH_REGISTER' } },
      select: { id: true, accountId: true, ts: true, amount: true, meta: true, fund: { select: { code: true } }, account: { select: { type: true } } },
    })).filter((t) => !dupIds.has(t.id))
    const invoices = await prisma.vendorInvoice.findMany({ where: { communityId: COMM }, select: { id: true, number: true, gross: true, vendor: { select: { name: true } } } })

    console.log('2. register payments → invoices')
    let linked = 0
    for (const l of LINKS) {
      const tx = out.filter((t) => (t.meta as any)?.ref === l.ref && Math.abs(Number(t.amount) - l.amount) < 0.005)
      if (tx.length !== 1) { console.log(`   ⚠ ${l.ref} ${l.amount}: expected 1 register row, found ${tx.length} — skipped`); continue }
      const t = tx[0]
      const refId = `bank:${bankLineKey(l.ref, l.amount)}`
      let applications: Array<{ invoiceId: string; amount: number }>
      let label: string
      if ('existing' in l.target) {
        applications = []
        for (const e of l.target.existing) {
          const inv = invoices.filter((i) => i.vendor?.name === l.target.vendor && i.number === e.number)
          if (!inv.length) throw new Error(`invoice ${l.target.vendor} ${e.number} not found`)
          for (const i of inv) applications.push({ invoiceId: i.id, amount: e.amount ?? Number(i.gross ?? 0) })
        }
        label = l.target.existing.map((e) => e.number).join('+')
      } else {
        const o = l.target.opening
        label = `OPENING ${o.number ?? '(fără număr)'}`
        if (!APPLY) { applications = [] } else {
          const inv = await ensurePaidOnlyInvoice(prisma, svc, COMM, {
            vendorName: l.target.vendor, number: o.number ?? null, amount: l.amount, fundCode: t.fund.code,
            issueDate: o.issueDate ?? t.ts.toISOString().slice(0, 10), openingKey: `register:${l.ref}/${l.amount.toFixed(2)}`,
            provenance: { source: 'cash-register', cashTxId: t.id },
          })
          applications = [{ invoiceId: inv.id, amount: l.amount }]
        }
      }
      console.log(`   ${t.ts.toISOString().slice(0, 10)} ${l.amount.toFixed(2).padStart(10)}  ${l.target.vendor.padEnd(18)} ${label}${l.note ? `  (${l.note})` : ''}`)
      if (APPLY) {
        await svc.recordRegisterPayment(COMM, {
          accountId: t.accountId, amount: l.amount, ts: t.ts, method: t.account.type === 'PETTY' ? 'CASH' : 'BANK', refId,
          applications, spec: { cashTxId: t.id, ref: l.ref },
        })
      }
      linked++
    }
    const unmapped = out.filter((t) => !LINKS.some((l) => (t.meta as any)?.ref === l.ref && Math.abs(Number(t.amount) - l.amount) < 0.005))
    for (const t of unmapped) console.log(`   ⚠ unmapped register payment ${t.ts.toISOString().slice(0, 10)} ${Number(t.amount).toFixed(2)} ${(t.meta as any)?.ref}`)

    // Libra fees
    const fees = await prisma.cashTx.findMany({
      where: { communityId: COMM, direction: 'OUT', kind: 'OTHER', account: { code: 'BANK_LIBRA_RON' }, ts: { gte: new Date(LIBRA_FEES.from), lt: new Date(LIBRA_FEES.toExcl) } },
      select: { id: true, amount: true, accountId: true, ts: true },
    })
    const feeSum = r2(fees.reduce((s, f) => s + Number(f.amount), 0))
    const libra = invoices.find((i) => i.vendor?.name === 'Libra' && i.number === LIBRA_FEES.number)
    if (libra && feeSum === LIBRA_FEES.amount) {
      console.log(`   commissions ${LIBRA_FEES.from}..${LIBRA_FEES.toExcl}: ${fees.length} debits = ${feeSum.toFixed(2)} → Libra ${LIBRA_FEES.number}`)
      if (APPLY) {
        await svc.recordRegisterPayment(COMM, {
          accountId: fees[0].accountId, amount: feeSum, ts: fees.reduce((m, f) => (f.ts > m ? f.ts : m), fees[0].ts), method: 'BANK',
          refId: `register:libra-fees:${LIBRA_FEES.number}`, applications: [{ invoiceId: libra.id, amount: feeSum }], spec: { cashTxIds: fees.map((f) => f.id) },
        })
      }
      linked++
    } else console.log(`   ⚠ Libra fees ${LIBRA_FEES.number}: commissions sum ${feeSum.toFixed(2)} ≠ ${LIBRA_FEES.amount} — skipped`)
    console.log(`linked ${linked} payments${APPLY ? '' : ' (dry run)'}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
