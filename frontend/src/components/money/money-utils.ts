export const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

export const num2 = (n: number | null | undefined) => Number(Number(n ?? 0).toFixed(2))

/** Client-side FIFO simulation over open-charge buckets (returned oldest-first). */
export function simulateFifo(
  items: Array<{ chargeId: string; fundId?: string; unitId?: string; available: number }>,
  amount: number,
): Array<{ chargeId: string; fundId?: string; unitId?: string; available: number; settled: number }> {
  let left = num2(amount)
  const out: Array<any> = []
  for (const it of items || []) {
    if (left <= 0) break
    const avail = num2(it.available)
    if (avail <= 0) continue
    const take = Math.min(avail, left)
    out.push({ ...it, settled: num2(take) })
    left = num2(left - take)
  }
  return out
}
