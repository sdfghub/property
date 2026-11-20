import { PrismaClient } from '@prisma/client'

/**
 * Seeds the EXPENSES fund's penalty rate schedule for one community. Each entry carries a `note`
 * (shown in the Fund editor and "Informații asociație") documenting why that era exists.
 *
 * Current schedule (association decision, 2026-10-15): NO penalty on any debt that originated before
 * May 2026 — 0%/day from 2021-01-01 — then 0.2%/day from 2026-05-01, the rate the association charges
 * today. Until 2026-10-15 the schedule mirrored the old homefile.ro exports instead (e.g. "Gh Lazar 4 -
 * Penalitati - 1B-Jul"): 0.02%/day Jan–Jun 2021, 0% Jul–Sep 2021, 0.02%/day Oct 2021–Jun 2023,
 * 0% Jul 2023–Apr 2026. Adjust below — or afterwards from the Fund editor's "Istoric rată
 * penalizare" — before relying on this for real charges.
 *
 *   npm run set:penalty-rate-history -- <COMMUNITY_ID> [FUND_CODE]
 */
const prisma = new PrismaClient()

const DEFAULT_HISTORY = [
  {
    from: '2021-01-01',
    ratePerDayPct: 0,
    note: 'Decizie asociație (15.10.2026): fără penalizări pentru datorii apărute înainte de mai 2026. Înlocuiește istoricul HomeFile (0,02%/zi ian–iun 2021 și oct 2021–iun 2023, 0% în rest).',
  },
  {
    from: '2026-05-01',
    ratePerDayPct: 0.2,
    note: 'Rata curentă a asociației: 0,2%/zi pentru datorii apărute din mai 2026 încoace.',
  },
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
