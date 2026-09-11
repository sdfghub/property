// Reset Kralik June (2026-06) expense/meter data back to a blank OPEN period, so the new
// close wizard can be walked through end-to-end in the UI — WITHOUT touching the cash
// register (CashTx/Payment for cycle 2026-06 stay exactly as imported/corrected).
//
// Removes: vendor-invoice-sourced community_charge (+ their VendorInvoice/InvoiceSplit/
// VendorInvoiceDoc/FundInvoice rows), bill/meter template instance state, per-unit
// PeriodMeasure (SQM/RESIDENTS/WATER_COLD — safe: getUnitAttributes() falls back to the
// latest prior period's SQM/RESIDENTS when June's own rows are gone, so the wizard's
// "confirm residents & share" step still shows real values to re-confirm, not a blank form),
// the branch MeterReading, and clears dueDate + checklist. Leaves the 3 FUND-sourced
// community_charge rows alone — those are recomputed automatically by prepare(), not entered
// through the wizard.
//
// Uses PeriodService.reject() first (the sanctioned PREPARED→OPEN path — cleans
// be_statement/be_unit_statement/CLOSE_PREP ledger legs the proper way) before deleting the
// rest directly.
//   npx ts-node --transpile-only src/scripts/reset-kralik-june-expenses.ts
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PeriodService } from '../modules/period/period.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const CODE = '2026-06'

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService) as any

  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: CODE } } })
  if (!period) throw new Error(`${CODE} not found`)

  if (period.status === 'PREPARED') {
    console.log(`Rejecting ${CODE} (PREPARED → OPEN, cleans be_statement/CLOSE_PREP ledger)...`)
    await periods.reject(COMM, CODE)
  } else if (period.status !== 'OPEN') {
    throw new Error(`${CODE} is ${period.status} — expected OPEN or PREPARED`)
  }

  const charges = await prisma.communityCharge.findMany({
    where: { communityId: COMM, periodId: period.id, sourceType: 'VENDOR_INVOICE' },
    select: { id: true, sourceKey: true },
  })
  console.log(`Removing ${charges.length} vendor-invoice charge(s): ${charges.map((c: any) => c.sourceKey).join(', ')}`)

  const instances = await prisma.billTemplateInstance.findMany({
    where: { communityId: COMM, periodId: period.id },
    select: { id: true },
  })
  const instanceIds = instances.map((i: any) => i.id)
  const invoices = instanceIds.length
    ? await prisma.vendorInvoice.findMany({ where: { communityId: COMM, templateInstanceId: { in: instanceIds } }, select: { id: true } })
    : []
  const invoiceIds = invoices.map((v: any) => v.id)

  if (invoiceIds.length) {
    await prisma.invoiceSplit.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
    await prisma.vendorInvoiceDoc.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
    await prisma.fundInvoice.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
    await prisma.vendorInvoice.deleteMany({ where: { id: { in: invoiceIds } } })
  }
  // community_charge_line cascades on delete
  await prisma.communityCharge.deleteMany({ where: { communityId: COMM, periodId: period.id, sourceType: 'VENDOR_INVOICE' } })
  await prisma.billTemplateInstance.deleteMany({ where: { communityId: COMM, periodId: period.id } })
  const meterInstances = await prisma.meterEntryTemplateInstance.deleteMany({ where: { communityId: COMM, periodId: period.id } })
  const measures = await prisma.periodMeasure.deleteMany({ where: { communityId: COMM, periodId: period.id } })
  const readings = await prisma.meterReading.deleteMany({ where: { communityId: COMM, periodId: period.id } })

  await prisma.period.update({ where: { id: period.id }, data: { dueDate: null, checklist: {} } })

  const cashTx = await prisma.cashTx.count({ where: { communityId: COMM, refType: 'CASH_REGISTER_2026_06' } })
  const payments = await prisma.payment.count({ where: { communityId: COMM, provider: 'cash-register-2026-06' } })

  console.log(`✅ ${CODE} reset to a blank OPEN period.`)
  console.log(`  removed: ${charges.length} community_charge, ${invoiceIds.length} vendor invoices, ${instanceIds.length} bill-template instances, ${meterInstances.count} meter-template instances, ${measures.count} period measures, ${readings.count} meter readings`)
  console.log(`  kept untouched: ${cashTx} cash_tx, ${payments} payments (June register)`)

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
