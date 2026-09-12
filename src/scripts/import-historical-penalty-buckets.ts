import { PrismaClient } from '@prisma/client'
import { rateForDate, originAnchorDate } from '../modules/period/penalty-rate'

/**
 * Backfills per-UNIT historical penalty buckets on one fund (default EXPENSES = Cheltuieli
 * Întreținere), reconstructed from the live ledger instead of the old homefile.ro exports — the
 * association flagged those as wrong for at least Ap 11 (a shared billing entity across two units,
 * Ap 11 + Ap 11A — exactly the kind of case a per-BE reading would misattribute) and for the
 * penalty math on Ap 1B.
 *
 * Method (per unit, oldest-debts-paid-first):
 *   1. R = the unit's share of its billing entity's current EXPENSES restanță (be_statement's
 *      due_start − payments, split across the BE's units by each unit's share of the CHARGE history
 *      below — units aren't billed individually, so this is the best available split).
 *   2. Walk the unit's own monthly CHARGE history backward from the newest month NOT already covered
 *      by an existing penalty_bucket for this (BE, fund) — skip whatever ensureBuckets() already
 *      created for recent periods, so nothing double-counts.
 *   3. Subtract each month's charge from R in turn: while R stays ≥ the month's charge, that month
 *      is fully unpaid (bucket = full charge); the one month where R runs out is partially unpaid
 *      (bucket = whatever's left); every older month is then assumed fully paid (FIFO) and gets no
 *      bucket at all.
 *   4. If R is still > 0 after the oldest tracked month (this system's ledger only goes back to
 *      2021-11 for Kralik), the remainder predates tracking — one final "Restanță reportată" bucket,
 *      dated at PRE_TRACKING_DUE_DATE (the April 2021 due date the old Ap 1B export shows for its
 *      January 2021 origin debt — the same cutover point applies community-wide).
 *
 * Each bucket's due date gives it its own firstPenalDay (dueDate + grace) and, via the fund's
 * penaltyRateHistory (see penalty-rate.ts / set-penalty-rate-history.ts), its own era's rate — the
 * accrual math (advance()) and the drilldown (explainPenalty) both already read buckets this way.
 *
 * Idempotent: originKey = 'hist:<unitId>:<periodCode|opening>'. Dry-run by default — pass --apply
 * to actually write.
 *
 *   npm run import:historical-penalties -- Kralik [--apply] [--fund=EXPENSES]
 */
const prisma = new PrismaClient()
const DAY = 24 * 60 * 60 * 1000
const PRE_TRACKING_DUE_DATE = new Date('2021-04-18') // see Ap 1B: "Ian, 2021 | 18.04.2021 - ..."
const round2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  const args = process.argv.slice(2)
  const communityId = args.find((a) => !a.startsWith('--'))
  const apply = args.includes('--apply')
  const fundArg = args.find((a) => a.startsWith('--fund='))
  const fundCode = fundArg ? fundArg.slice('--fund='.length) : 'EXPENSES'
  // Staged rollout: scope a run to specific BE codes (comma-separated) instead of the whole
  // community — e.g. re-running after the existingRemaining fix above one BE at a time to check
  // its output before trusting it community-wide.
  const beArg = args.find((a) => a.startsWith('--be='))
  const beCodes = beArg ? new Set(beArg.slice('--be='.length).split(',')) : null
  if (!communityId) throw new Error('usage: import-historical-penalty-buckets <COMMUNITY_ID> [--apply] [--fund=EXPENSES] [--be=CODE1,CODE2]')

  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { penaltyGraceDays: true } })
  const graceDays = Number((community as any)?.penaltyGraceDays ?? 30)
  const fund = await prisma.fund.findFirst({ where: { communityId, code: fundCode } })
  if (!fund) throw new Error(`fund ${fundCode} not found`)
  const targetFundCode = ((fund.allocation as any)?.penaltyFundCode) || 'PENALIZARI'
  const targetFund = await prisma.fund.findFirst({ where: { communityId, code: targetFundCode } })
  if (!targetFund) throw new Error(`target fund ${targetFundCode} not found`)

  const latestPeriod = await prisma.period.findFirst({
    where: { communityId }, orderBy: { seq: 'desc' },
    select: { id: true, seq: true, startDate: true, afisareDate: true },
  })
  if (!latestPeriod) throw new Error('no periods')

  // These buckets are brand new — advance() has never run for them, so they carry no
  // penalty_bucket_period history yet. Seed their accrual up through the day BEFORE the current
  // open period's own accrual window starts (the same afisare-to-afisare boundary advance() uses),
  // so the next prepare/recompute adds exactly that period's own days on top with no gap or overlap.
  let seedThroughDate = new Date(latestPeriod.startDate.getTime() - DAY)
  if (latestPeriod.afisareDate) {
    const prevPeriod = await prisma.period.findFirst({
      where: { communityId, seq: { lt: latestPeriod.seq } }, orderBy: { seq: 'desc' }, select: { afisareDate: true },
    })
    if (prevPeriod?.afisareDate) seedThroughDate = new Date(prevPeriod.afisareDate)
  }
  const countDays = (from: Date, to: Date) => (from > to ? 0 : Math.floor((to.getTime() - from.getTime()) / DAY) + 1)
  const fundAlloc = fund.allocation as any
  const fallbackRatePct = Number(fundAlloc?.penaltyPerDayPct ?? 0)

  const bes = (await prisma.billingEntity.findMany({ where: { communityId }, select: { id: true, code: true, name: true } }))
    .filter((be) => !beCodes || beCodes.has(be.code))

  let totalCreated = 0
  let totalAmount = 0
  const report: any[] = []

  for (const be of bes) {
    const beDebtRows: any[] = await prisma.$queryRawUnsafe(
      `select coalesce(sum(bs.due_start - bs.payments),0)::float8 as debt
         from be_statement bs
        where bs.community_id = $1 and bs.billing_entity_id = $2 and bs.fund_id = $3 and bs.period_id = $4`,
      communityId, be.id, fund.id, latestPeriod.id,
    )
    const beDebt = round2(Number(beDebtRows[0]?.debt ?? 0))
    if (beDebt <= 0.005) continue

    // Only buckets the LIVE engine (ensureBuckets) created — origin_key 'period:<id>' — count as
    // "already covered". Excluding our own 'hist:*' buckets here is what makes this script safe to
    // re-run: without it, a second pass would see last run's historical buckets as pre-existing
    // coverage, push earliestExistingDue back to the dawn of the ledger, and collapse everything into
    // one lump "opening" bucket instead of the real per-month breakdown.
    //
    // Also excludes the ANCHOR period's own bucket (period:<latestPeriod.id>) — a real bug found
    // 2026-09-12 (see BOITI/JARDA session notes): `be_statement.due_start` for period X is the
    // balance carried INTO X, i.e. through period (X-1)'s own charge — it does NOT yet include X's
    // own new charge (confirmed: due_start(Jul) - due_start(Jun) = Jun's own charge, not Jul's).
    // Netting the anchor period's own live bucket out of `beDebt` therefore over-subtracts by
    // exactly that period's charge, silently shrinking `beBackfill` and truncating however many of
    // the oldest historical months it should have covered — reproduced exactly on BOITI, where this
    // one bug alone was the difference between March correctly showing its real 87.21 charge and
    // wrongly showing a leftover 13.70.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `select pb.id, pb.due_date as "dueDate",
              (select pbp.principal_remaining::float8 from penalty_bucket_period pbp
                where pbp.bucket_id = pb.id order by pbp.period_seq desc limit 1) as "lastRemaining"
         from penalty_bucket pb
        where pb.community_id = $1 and pb.billing_entity_id = $2 and pb.fund_id = $3
          and pb.origin_key like 'period:%' and pb.origin_key <> ('period:' || $4)`,
      communityId, be.id, fund.id, latestPeriod.id,
    )
    const existingRemaining = round2(existing.reduce((s, r) => s + (r.lastRemaining != null ? Number(r.lastRemaining) : Number(0)), 0))
    const earliestExistingDue = existing.reduce((min: Date | null, r) => {
      if (!r.dueDate) return min
      const d = new Date(r.dueDate)
      return !min || d < min ? d : min
    }, null as Date | null)

    let beBackfill = round2(beDebt - existingRemaining)
    if (beBackfill <= 0.005) continue

    const units: any[] = await prisma.$queryRawUnsafe(
      `select distinct u.id, u.code
         from billing_entity_member bem join unit u on u.id = bem.unit_id
        where bem.billing_entity_id = $1 and bem.end_period_id is null`,
      be.id,
    )
    if (!units.length) { report.push({ be: be.code, skipped: 'no units', beBackfill }); continue }

    // Per-unit monthly charge history on this fund, oldest→newest, excluding periods already
    // covered by an existing bucket for this (BE, fund).
    const perUnitHistory = new Map<string, Array<{ code: string; due: Date; amt: number }>>()
    const perUnitWeight = new Map<string, number>()
    for (const u of units) {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `select pr.code, pr.due_date as due, sum(led.amount)::float8 as amt
           from be_ledger_entry_detail led join period pr on pr.id = led.period_id
          where led.community_id = $1 and led.billing_entity_id = $2 and led.fund_id = $3
            and led.kind = 'CHARGE' and led.unit_id = $4
          group by pr.code, pr.seq, pr.due_date
          order by pr.seq asc`,
        communityId, be.id, fund.id, u.id,
      )
      const filtered = rows
        .filter((r) => !earliestExistingDue || new Date(r.due) < earliestExistingDue)
        .map((r) => ({ code: r.code, due: new Date(r.due), amt: Number(r.amt) }))
      perUnitHistory.set(u.id, filtered)
      perUnitWeight.set(u.id, filtered.reduce((s, r) => s + Math.max(0, r.amt), 0))
    }
    const totalWeight = Array.from(perUnitWeight.values()).reduce((s, v) => s + v, 0)

    for (const u of units) {
      const weight = perUnitWeight.get(u.id) ?? 0
      const share = totalWeight > 0 ? weight / totalWeight : 1 / units.length
      let remaining = round2(beBackfill * share)
      const history = (perUnitHistory.get(u.id) ?? []).slice().reverse() // newest → oldest
      const createdForUnit: any[] = []

      for (const m of history) {
        if (remaining <= 0.005) break
        const charge = Math.max(0, m.amt)
        if (charge <= 0.005) continue
        const take = round2(Math.min(remaining, charge))
        remaining = round2(remaining - take)
        const firstPenalDay = new Date(m.due.getTime() + (graceDays + 1) * DAY)
        createdForUnit.push({ originKey: `hist:${u.id}:${m.code}`, dueDate: m.due, firstPenalDay, principal: take })
      }
      if (remaining > 0.005) {
        const firstPenalDay = new Date(PRE_TRACKING_DUE_DATE.getTime() + (graceDays + 1) * DAY)
        createdForUnit.push({ originKey: `hist:${u.id}:opening`, dueDate: PRE_TRACKING_DUE_DATE, firstPenalDay, principal: remaining })
        remaining = 0
      }
      // Seed each bucket's own accrual up through seedThroughDate at the rate in force when its
      // charge actually originated (originAnchorDate — the debt's own calendar month, embedded in
      // its originKey — NOT firstPenalDay, which is 2-4 months later once this association's
      // billing lag + grace period are added on top and can push a charge into a later rate era
      // than the one genuinely in force when it was billed), capped at its principal — the
      // catch-up advance() itself never gets to run.
      for (const c of createdForUnit) {
        const ratePct = rateForDate(fundAlloc, originAnchorDate(c.originKey, c.dueDate), fallbackRatePct)
        const days = countDays(c.firstPenalDay, seedThroughDate)
        c.seedPenaltyAccrued = round2(Math.min(c.principal * (ratePct / 100) * days, c.principal))
      }

      // A prior run of this script (with a different total to backfill — e.g. before the
      // existingRemaining fix above, or simply because more debt has since been paid down) may have
      // left 'hist:' buckets for months THIS run no longer covers (its backward walk now runs out
      // sooner, or later, than last time). Those are stale — bug found 2026-09-12 on BOITI, where
      // two runs 3 minutes apart left January's bucket (from the first, buggy run) sitting alongside
      // February/March's corrected ones (from the second), none of them consistent with each other.
      // Only ever remove a stale bucket that's still fully provisional (no COMMITTED period row) —
      // one with real committed history represents penalty already posted in a closed period, and
      // must never be silently deleted; flag it instead for manual review.
      const newKeys = new Set(createdForUnit.map((c) => c.originKey))
      const staleRows: any[] = await prisma.$queryRawUnsafe(
        `select pb.id, pb.origin_key as "originKey",
                exists(select 1 from penalty_bucket_period pbp where pbp.bucket_id = pb.id and pbp.status = 'COMMITTED') as "hasCommitted"
           from penalty_bucket pb
          where pb.community_id = $1 and pb.billing_entity_id = $2 and pb.fund_id = $3
            and pb.origin_key like $4`,
        communityId, be.id, fund.id, `hist:${u.id}:%`,
      )
      const stale = staleRows.filter((r) => !newKeys.has(r.originKey))
      const staleRemovable = stale.filter((r) => !r.hasCommitted)
      const staleBlocked = stale.filter((r) => r.hasCommitted)

      report.push({
        be: be.code, unit: u.code, share: round2(share * 100) + '%',
        backfilled: round2(createdForUnit.reduce((s, c) => s + c.principal, 0)),
        seededPenalty: round2(createdForUnit.reduce((s, c) => s + c.seedPenaltyAccrued, 0)),
        buckets: createdForUnit.length,
        staleRemoved: staleRemovable.map((r) => r.originKey),
        staleNeedsReview: staleBlocked.map((r) => r.originKey),
      })

      if (apply) {
        if (staleRemovable.length) {
          await prisma.penaltyBucket.deleteMany({ where: { id: { in: staleRemovable.map((r) => r.id) } } })
        }
        for (const c of createdForUnit) {
          await prisma.penaltyBucket.upsert({
            where: { communityId_billingEntityId_fundId_originKey: { communityId, billingEntityId: be.id, fundId: fund.id, originKey: c.originKey } },
            update: {
              unitId: u.id, targetFundId: targetFund.id, dueDate: c.dueDate, firstPenalDay: c.firstPenalDay,
              principalOriginal: c.principal, seedPenaltyAccrued: c.seedPenaltyAccrued,
            },
            create: {
              communityId, billingEntityId: be.id, unitId: u.id, fundId: fund.id, targetFundId: targetFund.id,
              originKey: c.originKey, dueDate: c.dueDate, firstPenalDay: c.firstPenalDay, principalOriginal: c.principal,
              seedPenaltyAccrued: c.seedPenaltyAccrued, status: 'OPEN',
            } as any,
          })
          totalCreated++
          totalAmount += c.principal
        }
      } else {
        totalCreated += createdForUnit.length
        totalAmount += createdForUnit.reduce((s, c) => s + c.principal, 0)
      }
    }
  }

  console.log(`${apply ? 'APPLIED' : 'DRY RUN (pass --apply to write)'} — fund ${fundCode}`)
  console.log(`buckets: ${totalCreated}, total principal: ${round2(totalAmount)}`)
  console.log('\nper unit:')
  for (const r of report) console.log(' ', JSON.stringify(r))
}

main().catch((e) => { console.error(e?.message || e); process.exit(1) }).finally(() => prisma.$disconnect())
