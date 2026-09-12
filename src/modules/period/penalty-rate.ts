export type PenaltyRateHistoryEntry = { from: string; ratePerDayPct: number }

/**
 * Resolves the penalty rate (%/day) in force on `date`, from a fund's `allocation.penaltyRateHistory`
 * (an admin-configured list of {from, ratePerDayPct}; the most recent entry with `from <= date` wins).
 * A fund with no history configured — the common case — is untouched: this returns `fallbackPct`
 * unchanged, so only funds that opt into a schedule (via the Fund editor) are affected.
 *
 * `date` should be the DEBT's own origin day (a penalty_bucket's `firstPenalDay`), not the period being
 * processed — a debt keeps the rate that was in force when it originated, the same way the Kralik
 * "Fișă calcul penalizări" export shows each overdue month at its own era's rate rather than
 * retroactively re-rating old debts whenever the association's current rate changes.
 */
export function rateForDate(alloc: any, date: Date, fallbackPct: number): number {
  const history: PenaltyRateHistoryEntry[] = Array.isArray(alloc?.penaltyRateHistory) ? alloc.penaltyRateHistory : []
  if (!history.length) return fallbackPct
  const applicable = history
    .filter((h) => h?.from && new Date(h.from).getTime() <= date.getTime())
    .sort((a, b) => new Date(b.from).getTime() - new Date(a.from).getTime())[0]
  return applicable ? Number(applicable.ratePerDayPct) : fallbackPct
}
