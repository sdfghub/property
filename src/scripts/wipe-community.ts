import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

type WipeOptions = {
  keepExternalRefs?: boolean
  keepVendors?: boolean
  keepInvoices?: boolean
}

export async function wipeCommunity(communityId: string, opts: WipeOptions = {}) {
  const { keepExternalRefs = false, keepVendors = true, keepInvoices = true } = opts

  // Gather ids needed for FK-based deletes
  const [periods, units, groups, bes, sets, vectors, series, bills, invoices, ledgerEntries, payments] = await Promise.all([
    prisma.period.findMany({ where: { communityId }, select: { id: true } }),
    prisma.unit.findMany({ where: { communityId }, select: { id: true } }),
    prisma.unitGroup.findMany({ where: { communityId }, select: { id: true } }),
    prisma.billingEntity.findMany({ where: { communityId }, select: { id: true } }),
    prisma.expenseTargetSet.findMany({ where: { communityId }, select: { id: true } }),
    prisma.weightVector.findMany({ where: { communityId }, select: { id: true } }),
    prisma.measureSeries.findMany({ where: { communityId }, select: { id: true } }),
    prisma.bill.findMany({ where: { communityId }, select: { id: true } }),
    prisma.vendorInvoice.findMany({ where: { communityId }, select: { id: true } }),
    prisma.beLedgerEntry.findMany({ where: { communityId }, select: { id: true } }),
    prisma.payment.findMany({ where: { communityId }, select: { id: true } }),
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
  const ledgerEntryIds = ledgerEntries.map(x => x.id)
  const paymentIds = payments.map(x => x.id)

  const traceRepo = (prisma as any).allocationTrace
  const ops = [
    traceRepo?.deleteMany ? traceRepo.deleteMany({ where: { communityId } }) : null,
    prisma.allocationLog.deleteMany({ where: { communityId } }),

    // Allocation/billing outputs first
    prisma.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: { in: ledgerEntryIds } } }),
    prisma.paymentApplication.deleteMany({
      where: {
        OR: [
          { paymentId: { in: paymentIds } },
          { chargeId: { in: ledgerEntryIds } },
        ],
      },
    }),
    prisma.beLedgerEntry.deleteMany({ where: { id: { in: ledgerEntryIds } } }),
    prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }),
    prisma.beStatement.deleteMany({ where: { communityId } }),
    prisma.beOpeningBalance.deleteMany({ where: { communityId } }),
    prisma.billLine.deleteMany({ where: { billId: { in: billIds } } }),
    prisma.bill.deleteMany({ where: { id: { in: billIds } } }),
    prisma.invoiceSplit.deleteMany({ where: { invoiceId: { in: invIds } } }),
    prisma.allocationLine.deleteMany({ where: { communityId } }),

    // Expenses, weights, rules
    prisma.weightItem.deleteMany({ where: { vectorId: { in: vectorIds } } }),
    prisma.weightVector.deleteMany({ where: { id: { in: vectorIds } } }),
    prisma.expenseSplit.deleteMany({ where: { communityId } }),
    prisma.expense.deleteMany({ where: { communityId } }),
    prisma.expenseType.deleteMany({ where: { communityId } }),
    prisma.allocationRule.deleteMany({ where: { communityId } }),
    prisma.bucketRule.deleteMany({ where: { communityId } }),
    prisma.splitGroupMember.deleteMany({ where: { splitGroup: { communityId } } }),
    prisma.splitGroup.deleteMany({ where: { communityId } }),

    // Expense target sets
    prisma.expenseTargetMember.deleteMany({ where: { setId: { in: setIds } } }),
    prisma.expenseTargetSet.deleteMany({ where: { id: { in: setIds } } }),

    // Measures (period snapshots + raw series)
    prisma.periodMeasure.deleteMany({ where: { communityId } }),
    prisma.aggregationRule.deleteMany({ where: { communityId } }),
    prisma.derivedMeterRule.deleteMany({ where: { communityId } }),
    prisma.measurePeriodValue.deleteMany({ where: { seriesId: { in: seriesIds } } }),
    prisma.measureSample.deleteMany({ where: { seriesId: { in: seriesIds } } }),
    prisma.measureSeries.deleteMany({ where: { id: { in: seriesIds } } }),
    prisma.meterEntryTemplateInstance.deleteMany({ where: { communityId } }),
    prisma.meterEntryTemplate.deleteMany({ where: { communityId } }),
    prisma.billTemplateInstance.deleteMany({ where: { communityId } }),
    prisma.billTemplate.deleteMany({ where: { communityId } }),
    prisma.templateAttachment.deleteMany({ where: { communityId } }),

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
      prisma.vendorInvoice.deleteMany({ where: { id: { in: invIds } } }),
    ]),
    ...(keepVendors ? [] : [
      prisma.vendor.deleteMany({ where: { communityId } }),
    ]),

    // External refs (legacy ids)
    ...(keepExternalRefs ? [] : [
      prisma.externalRef.deleteMany({ where: { communityId } }),
    ]),
  ].filter(Boolean) as any[]
  await prisma.$transaction(ops)
}

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Wipe all data for a community (definitions + allocations). User tables are not touched.

Usage:
  npm run wipe:community -- <communityId> [--keep-external-refs] [--keep-vendors] [--keep-invoices]
`)
  process.exit(msg ? 1 : 0)
}

function parseArgs(argv: string[]) {
  const communityId = argv[2]
  if (!communityId) usage('Missing communityId')
  const opts: WipeOptions = {}
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--keep-external-refs') opts.keepExternalRefs = true
    else if (a === '--keep-vendors') opts.keepVendors = true
    else if (a === '--keep-invoices') opts.keepInvoices = true
    else usage(`Unknown arg: ${a}`)
  }
  return { communityId, opts }
}

if (require.main === module) {
  const { communityId, opts } = parseArgs(process.argv)
  wipeCommunity(communityId, opts)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`✅ community wiped: ${communityId}`)
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e)
      process.exit(1)
    })
}
