import { PrismaClient } from '@prisma/client'

/**
 * Seeds the EXPENSES fund's penalty rate schedule for one community, from the historical rates
 * visible on the old homefile.ro exports (e.g. "Iulie - Fișă penalizări apartament AP MATEI"):
 * 0.02%/day through mid-2023, a gap at 0%, then 0.2%/day from May 2026 — the rate the association
 * currently charges. This is a best-effort reconstruction of the REGIME changes, not a reproduction
 * of every row: a few individual months in the old export show a rate that doesn't match the regime
 * around them (e.g. Jul–Sep 2021 read 0% inside what is otherwise the 0.02% era) — those read like
 * one-off exceptions in the old system (payment plans, disputes), not a real schedule change, so they
 * are not encoded here. Adjust the dates/rates below — or edit them afterwards from the Fund editor's
 * "Istoric rată penalizare" — before relying on this for real charges.
 *
 *   npm run set:penalty-rate-history -- <COMMUNITY_ID> [FUND_CODE]
 */
const prisma = new PrismaClient()

const DEFAULT_HISTORY = [
  { from: '2021-01-01', ratePerDayPct: 0.02 },
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
