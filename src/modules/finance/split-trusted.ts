const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Trust a multi-unit BE's per-unit split only when its units' figures sum back to the BE's own
 * total within half a cent — i.e. every payment/adjustment/charge that moved the BE-level number
 * was also unit-tagged. A partial/incomplete split would understate what's actually attributed
 * and make arrears look worse (or better) than they are for some units, which is worse than an
 * honest "can't split this BE yet" fallback. Shared by `finance.service.ts` (`avizier()`'s
 * `splitTrustedForBe`, `debtorsByFund()`) and `penalty-reconciliation.service.ts`.
 */
export function isUnitSplitTrusted(unitSum: number, beTotal: number): boolean {
  return Math.abs(round2(unitSum) - round2(beTotal)) < 0.015
}
