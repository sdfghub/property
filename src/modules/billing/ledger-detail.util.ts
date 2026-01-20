type TxClient = any

type LedgerEntryLike = {
  id: string
  communityId: string
  periodId: string
  billingEntityId: string
  kind: string
  bucket: string
  currency: string | null
  refType: string | null
  refId: string | null
}

export async function ensureLedgerEntryDetail(
  client: TxClient,
  entry: LedgerEntryLike,
  amount: number,
  meta?: Record<string, any>,
) {
  const count = await (client as any).beLedgerEntryDetail.count({
    where: { ledgerEntryId: entry.id },
  })
  if (count > 0) return
  await (client as any).beLedgerEntryDetail.create({
    data: {
      ledgerEntryId: entry.id,
      communityId: entry.communityId,
      periodId: entry.periodId,
      billingEntityId: entry.billingEntityId,
      kind: entry.kind,
      bucket: entry.bucket,
      currency: entry.currency || 'RON',
      refType: entry.refType,
      refId: entry.refId,
      amount,
      meta: meta ?? { synthetic: true },
    },
  })
}
