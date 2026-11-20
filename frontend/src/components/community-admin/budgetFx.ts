// RON → EUR for the budget payload, with a different rate for every year (version.fxRates, set by
// the budget import). Amounts of a known year use that year's rate: maps keyed by year
// ({ "2024": …, "2025": … }) convert key by key; everything else belongs to the fiscal year.
// Project totals are re-summed from their converted years so a project's EUR budget is the sum of
// its tranches at each year's rate.

export type FxRates = Record<string, { rate: number; basis: string }>

// Numeric fields that are not money.
const NOT_MONEY = new Set([
  'weight', 'paidPct', 'level', 'year', 'voteYear', 'durationYears', 'remainingShare', 'sortOrder', 'lineCount',
  'fiscalYear', 'seq', 'quantity', 'sharePct', 'budgetEur', 'sourceRow', 'rate',
])
const isYearMap = (o: Record<string, unknown>) => {
  const ks = Object.keys(o)
  return ks.length > 0 && ks.every((k) => /^\d{4}$/.test(k)) && ks.every((k) => typeof o[k] === 'number')
}
const r2 = (n: number) => Math.round(n * 100) / 100

export function rateOf(rates: FxRates, year: number | string): number {
  const r = rates[String(year)]?.rate
  if (r) return r
  const known = Object.keys(rates).sort()
  return known.length ? rates[known[known.length - 1]].rate : 1
}

function convert(v: any, rates: FxRates, fy: number, key?: string): any {
  if (typeof v === 'number') return key && NOT_MONEY.has(key) ? v : r2(v / rateOf(rates, fy))
  if (Array.isArray(v)) return v.map((x) => convert(x, rates, fy))
  if (v && typeof v === 'object') {
    if (isYearMap(v)) return Object.fromEntries(Object.entries(v).map(([y, a]) => [y, r2((a as number) / rateOf(rates, y))]))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, convert(x, rates, fy, k)]))
  }
  return v
}

export function budgetToEur<T extends Record<string, any>>(data: T, rates: FxRates, fy: number): T {
  const keep = { community: data.community, versions: data.versions, version: data.version, meta: data.meta, programs: data.programs }
  const out: any = { ...convert(data, rates, fy), ...keep }
  for (const pg of out.portfolio?.programs ?? []) {
    for (const p of pg.projects) {
      const sum = (m: Record<string, number>) => Object.values(m ?? {}).reduce((s, x) => s + x, 0)
      if (p.budget != null && Object.keys(p.yearPlan ?? {}).length) p.budget = r2(sum(p.yearPlan))
      p.paid = r2(sum(p.paidByYear) + (p.undatedPaid ?? 0))
      p.variance = p.budget != null ? r2(p.forecast - p.budget) : null
    }
    pg.totals.budget = r2(pg.projects.reduce((s: number, p: any) => s + (p.budget ?? 0), 0))
    pg.totals.paid = r2(pg.projects.reduce((s: number, p: any) => s + p.paid, 0))
  }
  return out
}
