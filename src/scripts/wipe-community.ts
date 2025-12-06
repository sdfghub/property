import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

type WipeOptions = {
  keepExternalRefs?: boolean
  keepVendors?: boolean
  keepInvoices?: boolean
}

export async function wipeCommunity(communityId: string, opts: WipeOptions = {}) {
  const { keepExternalRefs = true, keepVendors = true, keepInvoices = true } = opts

  // Gather ids needed for FK-based deletes
  const [periods, units, groups, bes, sets, vectors, series, bills, invoices] = await Promise.all([
    prisma.period.findMany({ where: { communityId }, select: { id: true } }),
    prisma.unit.findMany({ where: { communityId }, select: { id: true } }),
    prisma.unitGroup.findMany({ where: { communityId }, select: { id: true } }),
    prisma.billingEntity.findMany({ where: { communityId }, select: { id: true } }),
    prisma.expenseTargetSet.findMany({ where: { communityId }, select: { id: true } }),
    prisma.weightVector.findMany({ where: { communityId }, select: { id: true } }),
    prisma.measureSeries.findMany({ where: { communityId }, select: { id: true } }),
    prisma.bill.findMany({ where: { communityId }, select: { id: true } }),
    prisma.vendorInvoice.findMany({ where: { communityId }, select: { id: true } }),
  ])

  const periodIds = periods.map(x => x.id)
  const unitIds   = units.map(x => x.id)
  const groupIds  = groups.map(x => x.id)
  const beIds     = bes.map(x => x.id)
  const setIds    = sets.map(x => x.id)
  const vectorIds = vectors.map(x => x.id)
  const seriesIds = series.map(x => x.id)
  const billIds   = bills.map(x => x.id)
  const invIds    = invoices.map(x => x.id)

  await prisma.$transaction([
    // Allocation/billing outputs first
    prisma.billLine.deleteMany({ where: { billId: { in: billIds } } }),
    prisma.bill.deleteMany({ where: { id: { in: billIds } } }),
    prisma.allocationLine.deleteMany({ where: { communityId } }),

    // Expenses, weights, rules
    prisma.weightItem.deleteMany({ where: { vectorId: { in: vectorIds } } }),
    prisma.weightVector.deleteMany({ where: { id: { in: vectorIds } } }),
    prisma.expense.deleteMany({ where: { communityId } }),
    prisma.expenseType.deleteMany({ where: { communityId } }),
    prisma.allocationRule.deleteMany({ where: { communityId } }),

    // Expense target sets
    prisma.expenseTargetMember.deleteMany({ where: { setId: { in: setIds } } }),
    prisma.expenseTargetSet.deleteMany({ where: { id: { in: setIds } } }),

    // Measures (period snapshots + raw series)
    prisma.periodMeasure.deleteMany({ where: { communityId } }),
    prisma.measurePeriodValue.deleteMany({ where: { seriesId: { in: seriesIds } } }),
    prisma.measureSample.deleteMany({ where: { seriesId: { in: seriesIds } } }),
    prisma.measureSeries.deleteMany({ where: { id: { in: seriesIds } } }),

    // Memberships (groups, billing)
    prisma.unitGroupMember.deleteMany({
      where: { OR: [{ groupId: { in: groupIds } }, { unitId: { in: unitIds } }] },
    }),
    prisma.billingEntityMember.deleteMany({
      where: { OR: [{ billingEntityId: { in: beIds } }, { unitId: { in: unitIds } }] },
    }),

    // Topology
    prisma.unitGroup.deleteMany({ where: { id: { in: groupIds } } }),
    prisma.billingEntity.deleteMany({ where: { id: { in: beIds } } }),
    prisma.unit.deleteMany({ where: { id: { in: unitIds } } }),

    // Periods
    prisma.period.deleteMany({ where: { id: { in: periodIds } } }),

    // Optional documents & vendors
    ...(keepInvoices ? [] : [
      prisma.vendorInvoiceDoc.deleteMany({ where: { invoiceId: { in: invIds } } }),
      prisma.invoiceSplit.deleteMany({ where: { invoiceId: { in: invIds } } }),
      prisma.vendorInvoice.deleteMany({ where: { id: { in: invIds } } }),
    ]),
    ...(keepVendors ? [] : [
      prisma.vendor.deleteMany({ where: { communityId } }),
    ]),

    // External refs (legacy ids)
    ...(keepExternalRefs ? [] : [
      prisma.externalRef.deleteMany({ where: { communityId } }),
    ]),
  ])
}
