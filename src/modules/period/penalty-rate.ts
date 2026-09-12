export type PenaltyRateHistoryEntry = { from: string; ratePerDayPct: number }

/**
 * Resolves the penalty rate (%/day) in force on `date`, from a fund's `allocation.penaltyRateHistory`
 * (an admin-configured list of {from, ratePerDayPct}; the most recent entry with `from <= date` wins).
 * A fund with no history configured — the common case — is untouched: this returns `fallbackPct`
 * unchanged, so only funds that opt into a schedule (via the Fund editor) are affected.
 *
 * `date` should be the debt's ORIGIN ANCHOR DATE from `originAnchorDate()` below — the calendar
 * month the charge itself was incurred in — not `dueDate`/`firstPenalDay` (see that function's own
 * doc for why those are the wrong anchor).
 */
export function rateForDate(alloc: any, date: Date, fallbackPct: number): number {
  const history: PenaltyRateHistoryEntry[] = Array.isArray(alloc?.penaltyRateHistory) ? alloc.penaltyRateHistory : []
  if (!history.length) return fallbackPct
  const applicable = history
    .filter((h) => h?.from && new Date(h.from).getTime() <= date.getTime())
    .sort((a, b) => new Date(b.from).getTime() - new Date(a.from).getTime())[0]
  return applicable ? Number(applicable.ratePerDayPct) : fallbackPct
}

/**
 * The calendar date a debt's charge actually belongs to — the anchor `rateForDate` above should
 * resolve its rate from. NOT `dueDate`/`firstPenalDay`: those are billing-cycle artifacts, shifted
 * 2-4 months forward from the month the charge was actually incurred (this association bills a
 * month's expenses roughly 2-3 months later, then adds a 30+1 day grace on top of THAT) —
 * anchoring on them can push a charge into a LATER rate era than the one genuinely in force when it
 * was billed. Found 2026-09: BOITI/JARDA's Feb-Apr 2026 charges (billed with due dates in
 * May-Jul 2026, firstPenalDay in Jun-Aug 2026) were resolving to the fund's current 0.2%/day (in
 * force only from 2026-05-01) instead of the 0%/day actually in force for Feb-Apr 2026
 * (2023-07-01 – 2026-04-30) — an old comment on `rateForDate` claimed firstPenalDay-anchoring was
 * equivalent to the community's own "Fișă calcul penalizări" reference export; it wasn't, this is
 * the case that disproves it.
 *
 * `originKey` is one of:
 * - 'period:<periodId>' — the live engine's own per-period buckets (ensureBuckets); the caller must
 *   resolve that period's own `startDate` and pass it as `originPeriodStart` (this function has no
 *   DB access to do that lookup itself).
 * - 'hist:<unitId>:<periodCode>' — the historical backfill's per-month buckets; the origin month is
 *   already embedded in the key, parsed here directly.
 * - 'opening' / 'hist:<unitId>:opening' — pre-tracking cutover debt with no identifiable single
 *   origin month; falls back to `dueDate`, the best anchor available for those.
 */
export function originAnchorDate(originKey: string | null | undefined, dueDate: Date | string | null, originPeriodStart?: Date | null): Date {
  if (originPeriodStart) return originPeriodStart
  // Matches both 'hist:<unitId>:<YYYY-MM>' (the backward-reconstruction script) and
  // 'cent:<unitId>:<YYYY-MM>' (the centralizator-PDF import) — any non-'period:' bucket whose key
  // embeds its own origin month directly, so a new import source doesn't need a matching regex here.
  const monthMatch = /^[a-z]+:[^:]+:(\d{4}-\d{2})$/.exec(originKey || '')
  if (monthMatch) return new Date(`${monthMatch[1]}-01T00:00:00.000Z`)
  return dueDate ? new Date(dueDate) : new Date(0)
}
