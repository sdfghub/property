type TxClient = any

type CommunityLedgerEntryLike = {
  id: string
  communityId: string
  periodId: string
  kind: string
  lane?: string
  fundId: string
  currency: string | null
  refType: string | null
  refId: string | null
}

export async function ensureCommunityLedgerEntryDetail(
  client: TxClient,
  entry: CommunityLedgerEntryLike,
  amount: number,
  meta?: Record<string, any>,
) {
  const count = await (client as any).communityLedgerEntryDetail.count({
    where: { ledgerEntryId: entry.id },
  })
  if (count > 0) return
  await (client as any).communityLedgerEntryDetail.create({
    data: {
      ledgerEntryId: entry.id,
      communityId: entry.communityId,
      periodId: entry.periodId,
      kind: entry.kind,
      fundId: entry.fundId,
      currency: entry.currency || 'RON',
      refType: entry.refType,
      refId: entry.refId,
      amount,
      meta: meta ?? { synthetic: true },
    },
  })
}
