import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const rows: Array<{
    id: string
    amount: any
    kind: string
    fund_id: string | null
    community_id: string
    period_id: string
    billing_entity_id: string
    currency: string
    ref_type: string | null
    ref_id: string | null
  }> = await prisma.$queryRawUnsafe(
    `
    SELECT le.id,
           le.amount,
           le.kind,
           le.fund_id,
           le.community_id,
           le.period_id,
           le.billing_entity_id,
           le.currency,
           le.ref_type,
           le.ref_id
    FROM be_ledger_entry le
    LEFT JOIN be_ledger_entry_detail d ON d.ledger_entry_id = le.id
    WHERE d.id IS NULL
    `,
  )

  if (!rows.length) {
    console.log('No ledger entries missing details.')
    return
  }

  const data = rows.map((r) => ({
    ledgerEntryId: r.id,
    communityId: r.community_id,
    periodId: r.period_id,
    billingEntityId: r.billing_entity_id,
    kind: r.kind,
    fundId: r.fund_id,
    currency: r.currency || 'RON',
    refType: r.ref_type,
    refId: r.ref_id,
    amount: r.amount,
    meta: { synthetic: true, reason: 'backfill', kind: r.kind, fundId: r.fund_id },
  }))

  const chunkSize = 500
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize)
    await prisma.beLedgerEntryDetail.createMany({ data: chunk, skipDuplicates: true })
  }

  console.log(`Backfilled ${data.length} ledger entry detail rows.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
