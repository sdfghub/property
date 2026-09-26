// Kralik: every supplier payment made out of the association's funds since each fund was created
// (data/Kralik/fund-register-payments.json, transcribed from the six "Registru Fond ..." PDFs), so
// Plăți / Furnizori show the full history, not just what the cash book has held since June 2026.
//
// A payment dated before the app's cash book starts (its first CashTx) is history the books never
// carried: it becomes an accrual-free invoice (ensurePaidOnlyInvoice) settled by a VendorPayment
// with method OPENING, no account, no cash row and no ledger legs — fund balances don't move.
// A payment on/after that date is already in the cash book (and linked by
// link-kralik-vendor-payments.ts), so here it's only checked to exist, never recreated.
// Idempotent: refId fund-register:<fund>:<register row>.
//
//   npm run import:kralik-fund-register-payments            (dry run)
//   npm run import:kralik-fund-register-payments -- --apply
import fs from 'fs'
import path from 'path'
import { PrismaService } from '../modules/user/prisma.service'
import { VendorInvoiceService } from '../modules/billing/vendor-invoice.service'
import { ensurePaidOnlyInvoice } from './kralik-paid-only-invoice'

const COMM = 'Kralik'
const APPLY = process.argv.includes('--apply')

type Row = { fund: string; n: number; date: string; amount: number; account: 'BANK' | 'CASH'; doc: string | null; vendor: string; invoiceNumber: string | null; invoiceDate: string | null; note: string | null; text: string }

async function main() {
  const prisma = new PrismaService()
  await prisma.$connect()
  const svc = new VendorInvoiceService(prisma)
  try {
    const rows: Row[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'fund-register-payments.json'), 'utf8')).payments
    const first = await prisma.cashTx.findFirst({ where: { communityId: COMM, refType: { not: 'OPENING_BALANCE' } }, orderBy: { ts: 'asc' }, select: { ts: true } })
    if (!first) throw new Error('no cash book for Kralik')
    const cutover = first.ts.toISOString().slice(0, 10)
    const existing = await prisma.vendorPayment.findMany({ where: { communityId: COMM }, select: { id: true, invoiceId: true, ts: true, amount: true, refId: true, vendor: { select: { name: true } } } })
    console.log(`${APPLY ? '== APPLY ==' : '== DRY RUN (pass --apply to write) =='}  cash book starts ${cutover}; ${rows.length} fund-register payments`)

    let created = 0, present = 0, renamed = 0
    const missing: Row[] = []
    for (const r of rows) {
      if (r.date >= cutover) {
        const hit = existing.some((p) => p.ts.toISOString().slice(0, 10) === r.date && Math.abs(Number(p.amount) - r.amount) < 0.005)
        if (hit) present++
        else missing.push(r)
        continue
      }
      const refId = `fund-register:${r.fund}:${r.n}`
      const prior = existing.find((p) => p.refId === refId)
      if (prior) {
        present++
        // The data file's supplier was corrected since the import (e.g. an unnamed register row
        // identified later): move the invoice + payment to it.
        if (prior.vendor?.name !== r.vendor) {
          console.log(`   ↻ ${r.date} ${r.amount.toFixed(2).padStart(11)}  ${prior.vendor?.name ?? '—'} → ${r.vendor}`)
          if (APPLY) {
            const vendor = (await prisma.vendor.findFirst({ where: { communityId: COMM, name: r.vendor }, select: { id: true } }))
              ?? (await prisma.vendor.create({ data: { communityId: COMM, name: r.vendor }, select: { id: true } }))
            await prisma.$transaction([
              prisma.vendorInvoice.update({ where: { id: prior.invoiceId }, data: { vendorId: vendor.id } }),
              prisma.vendorPayment.update({ where: { id: prior.id }, data: { vendorId: vendor.id } }),
            ])
          }
          renamed++
        }
        continue
      }
      console.log(`   ${r.date} ${r.amount.toFixed(2).padStart(11)}  ${r.fund.padEnd(13)} ${r.vendor.padEnd(30)} ${r.invoiceNumber ?? ''}`)
      if (APPLY) {
        const inv = await ensurePaidOnlyInvoice(prisma, svc, COMM, {
          vendorName: r.vendor, number: r.invoiceNumber, amount: r.amount, fundCode: r.fund,
          issueDate: r.invoiceDate ?? r.date, openingKey: refId,
          provenance: { source: 'fund-register', fund: r.fund, row: r.n, account: r.account, doc: r.doc, text: r.text, note: r.note },
        })
        await svc.recordRegisterPayment(COMM, {
          accountId: null, amount: r.amount, ts: r.date, method: 'OPENING', refId,
          applications: [{ invoiceId: inv.id, amount: r.amount }], spec: { fundRegister: r.fund, row: r.n, account: r.account },
        })
      }
      created++
    }
    console.log(`${APPLY ? 'created' : 'would create'} ${created}; already present ${present}; supplier corrected ${renamed}`)
    for (const r of missing) console.log(`   ⚠ ${r.date} ${r.amount.toFixed(2)} ${r.vendor} (${r.fund} #${r.n}) is after ${cutover} but has no vendor payment in the app`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
