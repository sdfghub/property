// Per-community payment→charge allocation strategy.
//
// When a payment is spread automatically across a billing entity's open charges
// (i.e. no explicit allocationSpec), this decides the ORDER charges are settled in.
// The default is FIFO (oldest charge first) — the historical behavior. The other
// strategies encode the Romanian Civil Code imputația plății (art. 1506-1509):
// penalties/interest before principal, oldest scadență first — configurable because
// art. 1506 lets an association agree its own order.

export type AllocationStrategy =
  | 'FIFO' // oldest charge first (by created_at) — default, unchanged behavior
  | 'LEGAL_PER_PERIOD' // oldest period first; penalties before principal WITHIN each period
  | 'LEGAL_PENALTIES_FIRST' // all penalties (oldest period first) before any principal
  | 'FUND_PRIORITY' // configurable fund order (by fund code); oldest-first within a fund

export const ALLOCATION_STRATEGIES: AllocationStrategy[] = [
  'FIFO',
  'LEGAL_PER_PERIOD',
  'LEGAL_PENALTIES_FIRST',
  'FUND_PRIORITY',
]

export type PaymentAllocationConfig = {
  strategy: AllocationStrategy
  fundOrder?: string[] // fund codes, priority order; only used by FUND_PRIORITY
}

export const DEFAULT_ALLOCATION: PaymentAllocationConfig = { strategy: 'FIFO' }

/** Normalize whatever is stored in Community.paymentAllocation into a safe config (default FIFO). */
export function resolveAllocationConfig(raw: any): PaymentAllocationConfig {
  const strategy: AllocationStrategy = ALLOCATION_STRATEGIES.includes(raw?.strategy)
    ? raw.strategy
    : 'FIFO'
  const fundOrder = Array.isArray(raw?.fundOrder)
    ? (raw.fundOrder.filter((x: any) => typeof x === 'string' && x.length) as string[])
    : undefined
  return fundOrder && fundOrder.length ? { strategy, fundOrder } : { strategy }
}

export type ChargeOrderCtx = {
  /** Fund ids that represent penalties (the resolved penaltyFundCode targets). */
  penaltyFundIds: Set<string>
  /** fundId → priority index (lower = settled first). Absent funds sort last. */
  fundOrderIndex: Map<string, number>
}

/** Minimal shape the comparator needs from a grouped charge. */
export type OrderableCharge = {
  chargeCreatedAt: Date
  periodSeq: number | null
  chargeFundId: string | null
}

const MAX = Number.MAX_SAFE_INTEGER

/**
 * Build a comparator over grouped charges for the given strategy. Returns undefined for FIFO
 * so callers can keep the fast default path (no fund/penalty lookups needed).
 */
export function buildChargeComparator(
  strategy: AllocationStrategy,
  ctx: ChargeOrderCtx,
): ((a: OrderableCharge, b: OrderableCharge) => number) | undefined {
  const seq = (c: OrderableCharge) => (c.periodSeq == null ? MAX : c.periodSeq)
  const pen = (c: OrderableCharge) => (c.chargeFundId && ctx.penaltyFundIds.has(c.chargeFundId) ? 1 : 0)
  const created = (c: OrderableCharge) => c.chargeCreatedAt?.getTime?.() ?? 0
  const fidx = (c: OrderableCharge) =>
    c.chargeFundId && ctx.fundOrderIndex.has(c.chargeFundId) ? (ctx.fundOrderIndex.get(c.chargeFundId) as number) : MAX

  switch (strategy) {
    case 'LEGAL_PER_PERIOD':
      return (a, b) => seq(a) - seq(b) || pen(b) - pen(a) || created(a) - created(b)
    case 'LEGAL_PENALTIES_FIRST':
      return (a, b) => pen(b) - pen(a) || seq(a) - seq(b) || created(a) - created(b)
    case 'FUND_PRIORITY':
      return (a, b) => fidx(a) - fidx(b) || created(a) - created(b)
    case 'FIFO':
    default:
      return undefined
  }
}
