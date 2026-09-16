import { PrismaClient } from '@prisma/client'

/**
 * One-off migration companion to the `ensureBuckets()`/`seedFromOpenings()` rework that made the
 * live penalty engine unit-aware (see penalty-ledger.service.ts): before that change, every
 * `period:<id>`-origin bucket was created per (billingEntityId, fund) only, conflating a
 * multi-unit BE's units into one bucket. Going forward `ensureBuckets` creates fresh per-unit
 * buckets on the SAME (unitId, fund, originKey) key — leaving these old null-unitId buckets in
 * place would double-count (both age forward in parallel) for any BE holding more than one unit.
 *
 * For every OPEN, unitId-null, `period:*`-origin bucket belonging to a BE with >1 currently-active
 * unit membership:
 *   - No COMMITTED history yet (still-open period, provisional only) → just delete it; the next
 *     `prepare()` recreates correct per-unit buckets from scratch (ensureBuckets is idempotent).
 *   - Real COMMITTED history (closed periods) → split it into one bucket per unit, weighted by
 *     that unit's own share of the origin period's CHARGE lines on this fund (community_charge_line
 *     — the exact same source ensureBuckets() now reads via be_ledger_entry_detail). The SAME
 *     per-bucket weight is applied to every one of its PenaltyBucketPeriod rows (principalRemaining,
 *     penaltyAccrued, penaltyPosted) so the per-unit series stays internally consistent period over
 *     period; the last unit absorbs the rounding remainder so amounts foot to the cent. The old
 *     bucket is marked status='SPLIT' (excluded from advance()'s `status='OPEN'` scan) — never
 *     deleted, so its committed history stays in the audit trail.
 *
 * Dry-run by default; pass --apply to write. Idempotent: a bucket already SPLIT, or with no active
 * multi-unit BE, is left alone; re-running after --apply reports 0 candidates.
 *
 *   npm run split-penalty-buckets -- <COMMUNITY_ID> [--apply]
 */
const prisma = new PrismaClient()
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

async function main() {
  const args = process.argv.slice(2)
  const communityId = args.find((a) => !a.startsWith('--'))
  const apply = args.includes('--apply')
  if (!communityId) throw new Error('usage: split-penalty-buckets-per-unit <COMMUNITY_ID> [--apply]')

  const candidates = await prisma.penaltyBucket.findMany({
    where: { communityId, status: 'OPEN', unitId: null, originKey: { startsWith: 'period:' } },
    include: { periods: true },
  })
  if (!candidates.length) { console.log('No unitId-null OPEN period:* buckets — nothing to do.'); return }

  // BEs actually holding >1 currently-active unit — a single-unit BE's null-unit bucket is
  // already correct (per-BE == per-unit when there's only one) and is left untouched.
  const beIds = Array.from(new Set(candidates.map((b) => b.billingEntityId)))
  const members = await prisma.billingEntityMember.findMany({
    where: { billingEntityId: { in: beIds }, endPeriodId: null },
    select: { billingEntityId: true, unitId: true },
  })
  const unitsByBe = new Map<string, string[]>()
  for (const m of members) unitsByBe.set(m.billingEntityId, [...(unitsByBe.get(m.billingEntityId) ?? []), m.unitId])
  const multiUnitBuckets = candidates.filter((b) => (unitsByBe.get(b.billingEntityId)?.length ?? 0) > 1)
  if (!multiUnitBuckets.length) { console.log('No candidate bucket belongs to a currently multi-unit BE — nothing to do.'); return }

  const bes = await prisma.billingEntity.findMany({ where: { id: { in: beIds } }, select: { id: true, code: true, name: true } })
  const beById = new Map(bes.map((b) => [b.id, b]))
  const units = await prisma.unit.findMany({ where: { id: { in: Array.from(new Set(members.map((m) => m.unitId))) } }, select: { id: true, code: true } })
  const unitById = new Map(units.map((u) => [u.id, u]))

  let toDelete = 0
  let toSplit = 0
  const report: any[] = []

  for (const b of multiUnitBuckets) {
    const be = beById.get(b.billingEntityId)
    const beUnits = unitsByBe.get(b.billingEntityId) ?? []
    const hasCommitted = b.periods.some((p) => p.status === 'COMMITTED')

    if (!hasCommitted) {
      toDelete++
      report.push({ action: 'DELETE (provisional only)', be: be?.code, bucketId: b.id, originKey: b.originKey, principal: round2(Number(b.principalOriginal)) })
      if (apply) await prisma.penaltyBucket.delete({ where: { id: b.id } })
      continue
    }

    // Weight = each unit's share of THIS bucket's own origin-period CHARGE on this fund — the
    // exact source ensureBuckets() now reads, not a coarse/global approximation.
    const originPeriodId = b.originKey.replace(/^period:/, '')
    const lines = await prisma.communityChargeLine.findMany({
      where: { communityId, periodId: originPeriodId, billingEntityId: b.billingEntityId, charge: { fundId: b.fundId } },
      select: { unitId: true, amount: true },
    })
    const weightByUnit = new Map<string, number>()
    for (const l of lines) { if (l.unitId) weightByUnit.set(l.unitId, (weightByUnit.get(l.unitId) ?? 0) + Number(l.amount ?? 0)) }
    let totalW = Array.from(weightByUnit.values()).reduce((s, v) => s + v, 0)
    if (totalW <= 0) {
      // No tagged charge lines at all this origin period — fall back to an even split across the
      // BE's currently active units (mirrors ensureBuckets/seedFromOpenings' own no-signal fallback).
      for (const u of beUnits) weightByUnit.set(u, 1)
      totalW = beUnits.length
    }
    const unitIds = Array.from(weightByUnit.keys())

    toSplit++
    const splitReport: any = { action: 'SPLIT', be: be?.code, bucketId: b.id, originKey: b.originKey, principal: round2(Number(b.principalOriginal)), units: {} }

    if (apply) {
      await prisma.$transaction(async (tx) => {
        let principalAssigned = 0
        for (let i = 0; i < unitIds.length; i++) {
          const unitId = unitIds[i]
          const w = weightByUnit.get(unitId)! / totalW
          const isLast = i === unitIds.length - 1
          const principalOriginal = isLast ? round2(Number(b.principalOriginal) - principalAssigned) : round2(Number(b.principalOriginal) * w)
          principalAssigned = round2(principalAssigned + principalOriginal)
          splitReport.units[unitById.get(unitId)?.code ?? unitId] = principalOriginal

          const newBucket = await tx.penaltyBucket.create({
            data: {
              communityId, billingEntityId: b.billingEntityId, unitId, fundId: b.fundId, targetFundId: b.targetFundId,
              originKey: b.originKey, dueDate: b.dueDate, firstPenalDay: b.firstPenalDay, principalOriginal,
              seedPenaltyAccrued: round2(Number(b.seedPenaltyAccrued) * w), ratePerDayPct: b.ratePerDayPct, status: 'OPEN',
            },
          })
          for (const p of b.periods) {
            await tx.penaltyBucketPeriod.create({
              data: {
                bucketId: newBucket.id, periodId: p.periodId, periodSeq: p.periodSeq,
                principalRemaining: round2(Number(p.principalRemaining) * w),
                penaltyAccrued: round2(Number(p.penaltyAccrued) * w),
                penaltyPosted: round2(Number(p.penaltyPosted) * w),
                status: p.status,
              },
            })
          }
        }
        await tx.penaltyBucket.update({ where: { id: b.id }, data: { status: 'SPLIT' } })
      })
    } else {
      let principalAssigned = 0
      for (let i = 0; i < unitIds.length; i++) {
        const unitId = unitIds[i]
        const w = weightByUnit.get(unitId)! / totalW
        const isLast = i === unitIds.length - 1
        const principalOriginal = isLast ? round2(Number(b.principalOriginal) - principalAssigned) : round2(Number(b.principalOriginal) * w)
        principalAssigned = round2(principalAssigned + principalOriginal)
        splitReport.units[unitById.get(unitId)?.code ?? unitId] = principalOriginal
      }
    }
    report.push(splitReport)
  }

  console.log(JSON.stringify(report, null, 2))
  console.log(`\n${apply ? 'Applied' : 'Would apply'}: ${toSplit} bucket(s) split, ${toDelete} provisional bucket(s) ${apply ? 'deleted' : 'would be deleted'}.`)
  if (!apply) console.log('Dry run — pass --apply to write.')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
