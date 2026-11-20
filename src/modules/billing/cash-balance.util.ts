// Account balances anchored on real statements. CashTx only holds the movements the app imported,
// so a plain Σ(IN − OUT) starts from 0 and misses whatever was in the account before the first
// import. Each CashAccount may carry `notes.balanceCheckpoints` = [{ date: 'YYYY-MM-DD', balance,
// source }] (balance at the END of that day, from a bank statement or register — see
// data/<COMM>/cash-balances.json, `npm run seed:cash-balances`). The latest checkpoint anchors the
// account: offset = checkpoint − Σ movements up to that day, and every balance = offset + Σ movements.
// Earlier checkpoints are only checks (statement vs app at that date).
export type BalanceCheckpoint = { date: string; balance: number; source?: string }

const DAY = 86_400_000
/** First instant after the checkpoint day (balances are end-of-day). */
export const checkpointCutoff = (c: BalanceCheckpoint) => new Date(new Date(`${c.date}T00:00:00.000Z`).getTime() + DAY)

export function checkpointsOf(notes: unknown): BalanceCheckpoint[] {
  const list = notes && typeof notes === 'object' ? (notes as any).balanceCheckpoints : null
  if (!Array.isArray(list)) return []
  return list
    .filter((c) => c && typeof c.date === 'string' && Number.isFinite(Number(c.balance)))
    .map((c) => ({ date: c.date, balance: Number(c.balance), source: c.source }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Signed movements of one account (IN +, OUT −) with their timestamps. */
type Move = { ts: Date; signed: number }

/** Σ movements strictly before `cutoff`. */
const sumBefore = (moves: Move[], cutoff: Date) => moves.reduce((s, m) => (m.ts < cutoff ? s + m.signed : s), 0)

/** Offset to add to Σ movements so the balance matches the latest checkpoint (0 without one). */
export function anchorOffset(checkpoints: BalanceCheckpoint[], moves: Move[]): number {
  const anchor = checkpoints[checkpoints.length - 1]
  if (!anchor) return 0
  return anchor.balance - sumBefore(moves, checkpointCutoff(anchor))
}

/** Each checkpoint next to the app's balance at that date (after anchoring). */
export function checkpointChecks(checkpoints: BalanceCheckpoint[], moves: Move[], offset: number) {
  return checkpoints.map((c) => {
    const app = Math.round((offset + sumBefore(moves, checkpointCutoff(c))) * 100) / 100
    return { ...c, app, diff: Math.round((app - c.balance) * 100) / 100 }
  })
}

// Exchange rates for a non-RON account: `notes.fxRates` = [{ date: 'YYYY-MM-DD', rate (RON per 1 unit),
// source, bnr? }] — from the bank statement when it shows one, else the bank's published rate on that day
// (data/<COMM>/cash-balances.json → seed:cash-balances), as buy / sell. The rate valid on a date = the latest one on or
// before it; before the first recorded rate the earliest one is used (`estimated: true`).
export type FxRate = { date: string; rate: number; sell: number; source?: string; bnr?: number }

/** `rate` = buy (bank pays this many lei per unit: unit → lei), `sell` = lei per unit when buying it (lei → unit).
 *  Older entries with a single `rate` use it for both. */
export function fxRatesOf(notes: unknown): FxRate[] {
  const list = notes && typeof notes === 'object' ? (notes as any).fxRates : null
  if (!Array.isArray(list)) return []
  return list
    .map((r) => (r && typeof r === 'object' ? { ...r, buy: Number(r.buy ?? r.rate), sell: Number(r.sell ?? r.buy ?? r.rate) } : null))
    .filter((r): r is any => !!r && typeof r.date === 'string' && r.buy > 0 && r.sell > 0)
    .map((r) => ({ date: r.date, rate: r.buy, sell: r.sell, source: r.source, bnr: r.bnr != null ? Number(r.bnr) : undefined }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function rateAt(rates: FxRate[], date: string): (FxRate & { estimated: boolean }) | null {
  if (!rates.length) return null
  const d = date.slice(0, 10)
  const hit = [...rates].reverse().find((r) => r.date <= d)
  return hit ? { ...hit, estimated: false } : { ...rates[0], estimated: true }
}
