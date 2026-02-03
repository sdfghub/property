type TxClient = any

type FundLedgerEntryLike = {
  id: string
  communityId: string
  fundId: string
  periodId: string
  kind: string
  lane?: string
  currency: string | null
  refType: string | null
  refId: string | null
}

export async function ensureFundLedgerEntryDetail(
  client: TxClient,
  entry: FundLedgerEntryLike,
  amount: number,
  meta?: Record<string, any>,
) {
  const count = await (client as any).fundLedgerEntryDetail.count({
    where: { ledgerEntryId: entry.id },
  })
  if (count > 0) return
  await (client as any).fundLedgerEntryDetail.create({
    data: {
      ledgerEntryId: entry.id,
      communityId: entry.communityId,
      fundId: entry.fundId,
      periodId: entry.periodId,
      kind: entry.kind,
      lane: (entry as any).lane ?? 'ACCRUAL',
      currency: entry.currency || 'RON',
      refType: entry.refType,
      refId: entry.refId,
      amount,
      meta: meta ?? { synthetic: true },
    },
  })
}
