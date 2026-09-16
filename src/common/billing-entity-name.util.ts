// A billing entity's name/displayName can change over time (owner change, rename) — resolve
// the version that was true as of a given period's seq, falling back to the live BillingEntity
// fields when no BillingEntityNameHistory row covers that seq (the "live fields are current,
// unbounded" convention used throughout — see the rename endpoint in community-structure.controller.ts).
export type BillingEntityNameHistoryRow = { name: string; displayName: string | null; startSeq: number; endSeq: number | null }

export function resolveBeName(
  be: { id: string; name: string; displayName: string | null },
  seq: number,
  historyByBe: Map<string, BillingEntityNameHistoryRow[]>,
): { name: string; displayName: string | null } {
  const hist = historyByBe.get(be.id)
  const row = hist?.find((h) => h.startSeq <= seq && (h.endSeq == null || h.endSeq >= seq))
  return row ? { name: row.name, displayName: row.displayName } : { name: be.name, displayName: be.displayName }
}
