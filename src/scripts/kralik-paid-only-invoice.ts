// Shared by the Kralik vendor-payment scripts (link-kralik-vendor-payments.ts,
// import-kralik-fund-register-payments.ts).
import { PrismaService } from '../modules/user/prisma.service'
import { VendorInvoiceService } from '../modules/billing/vendor-invoice.service'

// An invoice that exists only so a register payment has something to settle — no accrual. Uses
// createOpeningInvoice where the DB knows DocSource.OPENING; a DB still on the pre-OPENING schema
// (the avizier-aug dev stack) gets the same shape by hand: source IMPORT and NO fund link, since
// linkFund on a non-OPENING invoice would post FUND_SPEND and move the fund balances.
// Idempotent on openingKey.
export async function ensurePaidOnlyInvoice(
  prisma: PrismaService,
  svc: VendorInvoiceService,
  communityId: string,
  b: { vendorName: string; number: string | null; amount: number; fundCode: string; issueDate: string; openingKey: string; provenance: any },
) {
  const [{ ok }] = await prisma.$queryRaw<Array<{ ok: boolean }>>`select 'OPENING' = any(enum_range(null::"DocSource")::text[]) as ok`
  if (ok) return svc.createOpeningInvoice(communityId, b)
  const existing = await prisma.vendorInvoice.findFirst({ where: { communityId, provenance: { path: ['openingKey'], equals: b.openingKey } } })
  if (existing) return existing
  let vendor = await prisma.vendor.findFirst({ where: { communityId, name: b.vendorName }, select: { id: true } })
  if (!vendor) vendor = await prisma.vendor.create({ data: { communityId, name: b.vendorName }, select: { id: true } })
  const issue = new Date(b.issueDate)
  const label = b.vendorName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase().slice(0, 24)
  return prisma.vendorInvoice.create({
    data: {
      communityId, vendorId: vendor.id, number: b.number || `OPENING-${label}-${b.issueDate}`, issueDate: issue, dueDate: issue,
      currency: 'RON', gross: b.amount, source: 'IMPORT',
      provenance: { ...b.provenance, opening: true, openingKey: b.openingKey, fundCode: b.fundCode },
    },
  })
}
