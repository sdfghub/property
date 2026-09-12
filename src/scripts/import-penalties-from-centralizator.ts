import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import { originAnchorDate, rateForDate } from '../modules/period/penalty-rate'

/**
 * Replaces the backward-reconstructed 'hist:' penalty buckets with ones seeded directly from the
 * association's own official reference — "Centralizator restanțe / penalizări" (a PDF the admin
 * generates from a separate tool) — instead of algorithmically re-deriving each month's restanță
 * from the unit's current aggregate debt. That reconstruction (import-historical-penalty-buckets.ts)
 * is a best-effort approximation and was already known to misattribute months for units with a
 * non-trivial payment history (see that script's own docstring re: Ap 11/Ap 1B) — this script
 * instead takes the (unit, month, restanță) breakdown directly from the reference PDF (the source
 * of truth the association itself already trusts) and lets OUR OWN due-date/rate-schedule/day-count
 * logic (originAnchorDate, rateForDate, advance()) compute the actual penalty from that principal —
 * per the explicit instruction this was built to: "foloseste lunile si sumele din fisier,
 * restul logicii foloseste-l din DB nostru".
 *
 * Input is a JSON file (see build-import-data.py in the session's scratch dir for how it was
 * derived from the PDF) shaped as an array of:
 *   { beId, beCode, unitId, unitLabel, months: [{ code: "2026-02", restanta: 108.77 }, ...] }
 * — one entry per (billing entity, unit) pair, one month entry per row in the PDF with a nonzero
 * restanță (rows already fully paid off — restanță 0.00 but a small historical penalty already
 * locked in — are intentionally not included; replicating those tiny already-settled amounts to
 * the cent is a separate, much lower-stakes concern than getting the actual outstanding restanțe
 * right, which is what was reported wrong).
 *
 * For a month with a period already tracked in our own `period` table, dueDate is read from THERE
 * (not the PDF) — "restul logicii din DB". For the 2 pre-tracking rows this community's PDF shows
 * (Matei's Ian/Iul 2021 — our own tracking only starts at 2021-11), falls back to the PDF's own
 * stated "Perioadă calcul" start date, the best available anchor for those.
 *
 * Idempotent on originKey = 'cent:<unitId>:<periodCode>'. Sweeps away this (BE, unit)'s stale
 * 'hist:' buckets once new 'cent:' ones exist for it — but only ones with no COMMITTED period
 * history (real posted penalty is never silently deleted, only flagged for review).
 *
 * These buckets are brand new — advance() has never run for them, so they carry no
 * penalty_bucket_period history and would otherwise start accruing from scratch at the NEXT
 * prepare, ignoring every day already elapsed since firstPenalDay (advance() only accrues the
 * CURRENT period's own day-window on top of the prior COMMITTED row, which doesn't exist here).
 * So — exactly like import-historical-penalty-buckets.ts's own seed step — each bucket's
 * seedPenaltyAccrued is pre-computed here: firstPenalDay..seedThroughDate (the day before the
 * current open period's own accrual window starts) at the single flat rate its origin month
 * resolves to via originAnchorDate/rateForDate, capped at its own principal.
 *
 * Usage: npm run ts-node -- src/scripts/import-penalties-from-centralizator.ts <communityId> <dataFile.json> [--apply] [--fund=EXPENSES]
 */
const prisma = new PrismaClient()
const DAY = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

type MonthRow = { code: string; restanta: number }
type UnitEntry = { label: string; beId: string; beCode: string; unitId: string; unitLabel: string; months: MonthRow[] }

async function main() {
  const args = process.argv.slice(2)
  const communityId = args.find((a) => !a.startsWith('--'))
  const dataFile = args.filter((a) => !a.startsWith('--'))[1]
  const apply = args.includes('--apply')
  const fundArg = args.find((a) => a.startsWith('--fund='))
  const fundCode = fundArg ? fundArg.slice('--fund='.length) : 'EXPENSES'
  // Override for specific BE codes: import EVERY PDF month for these BEs even if a native
  // 'period:' bucket already covers it — the admin has reviewed the native figure for these units
  // specifically and wants the PDF's own restanță trusted instead. Never touches or removes the
  // native bucket itself (committed history stays exactly as posted); this only adds/keeps the
  // 'cent:' bucket alongside it, so the caller is knowingly accepting that the two may overlap.
  const forceArg = args.find((a) => a.startsWith('--force-be='))
  const forceBeCodes = forceArg ? new Set(forceArg.slice('--force-be='.length).split(',')) : new Set<string>()
  if (!communityId || !dataFile) {
    throw new Error('usage: import-penalties-from-centralizator <COMMUNITY_ID> <dataFile.json> [--apply] [--fund=EXPENSES] [--force-be=CODE1,CODE2]')
  }

  const entries: UnitEntry[] = JSON.parse(fs.readFileSync(dataFile, 'utf8'))

  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { penaltyGraceDays: true } })
  const graceDays = Number((community as any)?.penaltyGraceDays ?? 30)
  const fund = await prisma.fund.findFirst({ where: { communityId, code: fundCode } })
  if (!fund) throw new Error(`fund ${fundCode} not found`)
  const targetFundCode = ((fund.allocation as any)?.penaltyFundCode) || 'PENALIZARI'
  const targetFund = await prisma.fund.findFirst({ where: { communityId, code: targetFundCode } })
  if (!targetFund) throw new Error(`target fund ${targetFundCode} not found`)

  // All periods this community tracks, by code — covers the vast majority of PDF rows.
  const periods = await prisma.period.findMany({ where: { communityId }, select: { code: true, dueDate: true } })
  const periodByCode = new Map(periods.map((p) => [p.code, p]))

  const latestPeriod = await prisma.period.findFirst({
    where: { communityId }, orderBy: { seq: 'desc' }, select: { id: true, seq: true, startDate: true, afisareDate: true },
  })
  if (!latestPeriod) throw new Error('no periods')
  let seedThroughDate = new Date(latestPeriod.startDate.getTime() - DAY)
  if (latestPeriod.afisareDate) {
    const prevPeriod = await prisma.period.findFirst({
      where: { communityId, seq: { lt: latestPeriod.seq } }, orderBy: { seq: 'desc' }, select: { afisareDate: true },
    })
    if (prevPeriod?.afisareDate) seedThroughDate = new Date(prevPeriod.afisareDate)
  }
  const countDays = (from: Date, to: Date) => (from > to ? 0 : Math.floor((to.getTime() - from.getTime()) / DAY) + 1)
  const fallbackRatePct = Number((fund.allocation as any)?.penaltyPerDayPct ?? 0)

  // The live engine's own ensureBuckets() already creates a 'period:<periodId>' bucket (per BE, not
  // per unit — aggregate) for every period as it's processed, covering that period's own charge from
  // day one. A PDF month whose dueDate falls on/after the EARLIEST such native bucket for its BE is
  // therefore ALREADY tracked by our own DB — creating a 'cent:' bucket for it too would double-count
  // that charge's principal (and penalty). Mirrors import-historical-penalty-buckets.ts's identical
  // exclusion (down to excluding the anchor/latest period's own bucket, whose dueDate is usually the
  // newest anyway and would otherwise not affect the min — kept for exact parity with that script).
  const earliestNativeRows: any[] = await prisma.$queryRawUnsafe(
    `select pb.billing_entity_id as "beId", min(pb.due_date) as "earliestDue"
       from penalty_bucket pb
      where pb.community_id = $1 and pb.fund_id = $2
        and pb.origin_key like 'period:%' and pb.origin_key <> ('period:' || $3)
      group by pb.billing_entity_id`,
    communityId, fund.id, latestPeriod.id,
  )
  const earliestNativeDueByBe = new Map<string, Date>(
    earliestNativeRows.filter((r) => r.earliestDue).map((r) => [r.beId, new Date(r.earliestDue)]),
  )

  // Pre-tracking rows (a PDF month with no matching `period` row) fall back to this literal date,
  // parsed from the PDF's own "Perioadă calcul" column for that row (its start date = the real due
  // date the reference tool itself used) — passed in the data file as `dueDateOverride`.
  const report: any[] = []
  let totalCreated = 0
  let totalRemoved = 0
  let totalNeedsReview = 0

  for (const entry of entries) {
    const earliestNativeDue = earliestNativeDueByBe.get(entry.beId) ?? null
    const createdForUnit: Array<{ originKey: string; dueDate: Date; firstPenalDay: Date; principal: number; seed: number }> = []
    for (const m of entry.months) {
      const period = periodByCode.get(m.code)
      const dueDate = period
        ? new Date(period.dueDate as any)
        : (m as any).dueDateOverride
          ? new Date((m as any).dueDateOverride)
          : null
      if (!dueDate) {
        report.push({ unit: entry.unitLabel, be: entry.beCode, month: m.code, skipped: 'no period and no dueDateOverride' })
        continue
      }
      if (earliestNativeDue && dueDate >= earliestNativeDue && !forceBeCodes.has(entry.beCode)) {
        report.push({ unit: entry.unitLabel, be: entry.beCode, month: m.code, skipped: 'already tracked by a native period: bucket' })
        continue
      }
      const originKey = `cent:${entry.unitId}:${m.code}`
      const firstPenalDay = new Date(dueDate.getTime() + (graceDays + 1) * DAY)
      const principal = round2(m.restanta)
      const ratePct = rateForDate(fund.allocation, originAnchorDate(originKey, dueDate), fallbackRatePct)
      const days = countDays(firstPenalDay, seedThroughDate)
      const seed = round2(Math.min(principal * (ratePct / 100) * days, principal))
      createdForUnit.push({ originKey, dueDate, firstPenalDay, principal, seed })
    }

    // Sweep stale 'hist:' buckets for this exact (BE, unit) — the old backward-reconstruction's
    // guess, now superseded by the PDF-sourced figures above — AND any of this unit's own 'cent:'
    // buckets from an earlier run of THIS script that this run no longer wants (e.g. a month that
    // used to look historical but is now excluded as natively covered, per earliestNativeDue above —
    // found 2026-09-13 on the first apply, before that exclusion existed). Never touches 'period:'
    // (the live engine's own current-period buckets) or any bucket with real committed history.
    const newKeys = new Set(createdForUnit.map((c) => c.originKey))
    const staleRows: any[] = await prisma.$queryRawUnsafe(
      `select pb.id, pb.origin_key as "originKey",
              exists(select 1 from penalty_bucket_period pbp where pbp.bucket_id = pb.id and pbp.status = 'COMMITTED') as "hasCommitted"
         from penalty_bucket pb
        where pb.community_id = $1 and pb.billing_entity_id = $2 and pb.unit_id = $3 and pb.fund_id = $4
          and (pb.origin_key like 'hist:%' or pb.origin_key like 'cent:%')`,
      communityId, entry.beId, entry.unitId, fund.id,
    )
    const staleCandidates = staleRows.filter((r) => !newKeys.has(r.originKey))
    const staleRemovable = staleCandidates.filter((r) => !r.hasCommitted)
    const staleBlocked = staleCandidates.filter((r) => r.hasCommitted)

    report.push({
      be: entry.beCode, unit: entry.unitLabel,
      months: createdForUnit.length, total: round2(createdForUnit.reduce((s, c) => s + c.principal, 0)),
      seedTotal: round2(createdForUnit.reduce((s, c) => s + c.seed, 0)),
      staleRemoved: staleRemovable.map((r) => r.originKey), staleNeedsReview: staleBlocked.map((r) => r.originKey),
    })
    totalCreated += createdForUnit.length
    totalRemoved += staleRemovable.length
    totalNeedsReview += staleBlocked.length

    if (apply) {
      if (staleRemovable.length) {
        await prisma.penaltyBucket.deleteMany({ where: { id: { in: staleRemovable.map((r) => r.id) } } })
      }
      for (const c of createdForUnit) {
        await prisma.penaltyBucket.upsert({
          where: {
            communityId_billingEntityId_fundId_originKey: {
              communityId, billingEntityId: entry.beId, fundId: fund.id, originKey: c.originKey,
            },
          },
          update: { unitId: entry.unitId, targetFundId: targetFund.id, dueDate: c.dueDate, firstPenalDay: c.firstPenalDay, principalOriginal: c.principal, seedPenaltyAccrued: c.seed },
          create: {
            communityId, billingEntityId: entry.beId, unitId: entry.unitId, fundId: fund.id, targetFundId: targetFund.id,
            originKey: c.originKey, dueDate: c.dueDate, firstPenalDay: c.firstPenalDay, principalOriginal: c.principal,
            seedPenaltyAccrued: c.seed, status: 'OPEN',
          } as any,
        })
      }
    }
  }

  console.log(`${apply ? 'APPLIED' : 'DRY RUN (pass --apply to write)'} — fund ${fundCode}`)
  console.log(`units: ${entries.length}, month-buckets: ${totalCreated}, stale removed: ${totalRemoved}, needs review: ${totalNeedsReview}`)
  console.log('\nper unit:')
  for (const r of report) console.log(' ', JSON.stringify(r))
}

main().catch((e) => { console.error(e?.message || e); process.exit(1) }).finally(() => prisma.$disconnect())
