import { PrismaClient } from '@prisma/client'

/**
 * Seeds the EXPENSES fund's penalty rate schedule for one community, from the historical rates
 * visible on the old homefile.ro exports (e.g. "Gh Lazar 4 - Penalitati - 1B-Jul", the detailed
 * per-month sheet for Ap 1/B): 0.02%/day from Jan 2021, a real 0% dip Jul–Sep 2021 (confirmed by
 * the association, 2026-09 — an earlier version of this script treated that dip as a one-off
 * export glitch and dropped it; it is a genuine regime change), back to 0.02%/day Oct 2021–Jun
 * 2023, 0% Jul 2023–Apr 2026, then 0.2%/day from May 2026 — the rate the association currently
 * charges. Adjust the dates/rates below — or edit them afterwards from the Fund editor's "Istoric
 * rată penalizare" — before relying on this for real charges.
 *
 *   npm run set:penalty-rate-history -- <COMMUNITY_ID> [FUND_CODE]
 */
const prisma = new PrismaClient()

const DEFAULT_HISTORY = [
  { from: '2021-01-01', ratePerDayPct: 0.02 },
  { from: '2021-07-01', ratePerDayPct: 0 },
  { from: '2021-10-01', ratePerDayPct: 0.02 },
  { from: '2023-07-01', ratePerDayPct: 0 },
  { from: '2026-05-01', ratePerDayPct: 0.2 },
]

async function main() {
  const communityId = process.argv[2]
  const fundCode = process.argv[3] || 'EXPENSES'
  if (!communityId) throw new Error('usage: set-penalty-rate-history <COMMUNITY_ID> [FUND_CODE]')

  const fund = await prisma.fund.findFirst({ where: { communityId, code: fundCode } })
  if (!fund) throw new Error(`fund ${fundCode} not found for community ${communityId}`)

  const allocation: any = { ...((fund.allocation as any) || {}), penaltyRateHistory: DEFAULT_HISTORY }
  await prisma.fund.update({ where: { id: fund.id }, data: { allocation } })

  console.log(`${communityId}/${fundCode}: penaltyRateHistory set to`)
  for (const h of DEFAULT_HISTORY) console.log(`  from ${h.from}: ${h.ratePerDayPct}%/day`)
  console.log('Existing flat penaltyPerDayPct (fallback for dates before the earliest entry):', allocation.penaltyPerDayPct ?? '(none)')
}

main().catch((e) => { console.error(e?.message || e); process.exit(1) }).finally(() => prisma.$disconnect())
