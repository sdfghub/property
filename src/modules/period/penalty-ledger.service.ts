import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import type { Prisma, PrismaClient } from '@prisma/client'

type TxOrClient = PrismaClient | Prisma.TransactionClient
const DAY = 24 * 60 * 60 * 1000

type PenalFund = { id: string; code: string; rate: number; targetId: string; targetCode: string }

/**
 * Stateful per-bucket penalty aging ledger. Replaces the old stateless recompute
 * (`postPenaltiesForStage`). Each period ADVANCES every open bucket from its last committed
 * state — never re-deriving from aggregates — so history is append-only and the cap is per bucket.
 *
 * Semantics (see plan): one bucket per penalizable due; exact due-date-anchored day counts;
 * a period's Stream-A (principal) payment is applied FIFO oldest-first BEFORE accrual (payer-favored,
 * paid-in-period escapes that period); cumulative penalty per bucket ≤ its own principal.
 */
@Injectable()
export class PenaltyLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private countDays(from: Date, to: Date): number {
    if (from > to) return 0
    return Math.floor((to.getTime() - from.getTime()) / DAY) + 1
  }

  /** Penalty-source funds (penaltyPerDayPct configured) with a resolvable target (earmark) fund.
   *  Rate may be 0 today: existing buckets carry their own stamped rate, so we must still advance them. */
  private async penalFunds(tx: TxOrClient, communityId: string): Promise<PenalFund[]> {
    const funds = await tx.fund.findMany({ where: { communityId }, select: { id: true, code: true, allocation: true } })
    const byCode = new Map(funds.map((f) => [f.code, f]))
    return funds
      .map((f) => {
        const alloc = (f.allocation as any) || {}
        const configured = alloc.penaltyPerDayPct != null // a penalty source (its current rate may be 0)
        const rate = Number(alloc.penaltyPerDayPct ?? 0) / 100
        const targetCode = alloc.penaltyFundCode || 'PENALIZARI'
        const target = byCode.get(targetCode)
        return { id: f.id, code: f.code, rate, targetId: target?.id as string, targetCode, configured }
      })
      .filter((f) => (f as any).configured && f.targetId)
  }

  /** Per-unit weights within a BE = the unit's share of principal (opening + charges) in a fund. */
  private async penaltyUnitShares(tx: TxOrClient, communityId: string, beId: string, fundId: string) {
    const shares = new Map<string, number>()
    const op = await tx.beOpeningBalance.findMany({
      where: { communityId, billingEntityId: beId, fundId },
      select: { unitId: true, amount: true },
    })
    op.forEach((r) => { if (r.unitId) shares.set(r.unitId, (shares.get(r.unitId) ?? 0) + Number(r.amount ?? 0)) })
    const det = await (tx as any).beLedgerEntryDetail.findMany({
      where: { communityId, billingEntityId: beId, fundId, kind: 'CHARGE', unitId: { not: null } },
      select: { unitId: true, amount: true },
    })
    det.forEach((r: any) => { if (r.unitId) shares.set(r.unitId, (shares.get(r.unitId) ?? 0) + Number(r.amount ?? 0)) })
    for (const [k, v] of Array.from(shares.entries())) if (v <= 0) shares.delete(k)
    return shares
  }

  /** Principal paid to (BE, sourceFund) in this period — the coarse, payer-favored Stream-A amount.
   * Reads the underlying PAYMENT ledger rows (kind=PAYMENT, lane=CASH) — the same source
   * computeStatements aggregates into be_statement.payments — rather than the derived be_statement
   * field. That field is empty when advance() runs (it executes before computeStatements, and reopen
   * deletes be_statement outright), so reading it would drop this period's payments and skip the
   * payer-favored paydown. */
  private async streamAPayment(tx: TxOrClient, communityId: string, periodId: string, beId: string, fundId: string) {
    const agg = await tx.beLedgerEntry.aggregate({
      _sum: { amount: true },
      where: { communityId, periodId, billingEntityId: beId, fundId, kind: 'PAYMENT', lane: 'CASH' },
    })
    // NOTE: for a self-targeted fund (source==target) this includes penalty payments too — a v1
    // simplification that over-favors the payer; net-out is a documented follow-up.
    return Number(agg._sum.amount ?? 0)
  }

  /**
   * Create one bucket per (BE × source-fund) principal charge staged THIS period, for funds that
   * bear penalties. Idempotent on originKey='period:<periodId>' — safe to re-run on re-prepare.
   */
  async ensureBuckets(tx: TxOrClient, communityId: string, periodId: string) {
    const period = await tx.period.findUnique({ where: { id: periodId }, select: { dueDate: true } })
    const community = await tx.community.findUnique({ where: { id: communityId }, select: { penaltyGraceDays: true } })
    const graceDays = Number((community as any)?.penaltyGraceDays ?? 30)
    const funds = await this.penalFunds(tx, communityId)
    if (!funds.length) return
    const firstPenalDay = period?.dueDate
      ? new Date(new Date(period.dueDate).getTime() + (graceDays + 1) * DAY)
      : new Date(0)

    for (const f of funds) {
      // this period's NEW principal contribution per BE (staged charge, refType CLOSE_PREP), fund f
      const rows: Array<{ beId: string; amt: any }> = await (tx as any).$queryRawUnsafe(
        `select billing_entity_id as "beId", coalesce(sum(amount),0)::float8 as amt
           from be_ledger_entry
          where community_id = $1 and period_id = $2 and fund_id = $3
            and kind = 'CHARGE' and ref_type = 'CLOSE_PREP'
          group by billing_entity_id`,
        communityId, periodId, f.id,
      )
      for (const r of rows) {
        const principal = Number(r.amt ?? 0)
        if (principal <= 0) continue
        await tx.penaltyBucket.upsert({
          where: {
            communityId_billingEntityId_fundId_originKey: {
              communityId, billingEntityId: r.beId, fundId: f.id, originKey: `period:${periodId}`,
            },
          },
          update: { principalOriginal: principal, targetFundId: f.targetId, dueDate: period?.dueDate ?? null, firstPenalDay },
          create: {
            communityId, billingEntityId: r.beId, fundId: f.id, targetFundId: f.targetId,
            originKey: `period:${periodId}`, dueDate: period?.dueDate ?? null, firstPenalDay,
            principalOriginal: principal, status: 'OPEN',
            ratePerDayPct: f.rate * 100, // stamp the rate in effect when this debt's bucket is created
          } as any,
        })
      }
    }
  }

  /**
   * Advance every open bucket to this period: apply the period's payment FIFO (before accrual),
   * accrue exact days on the remainder (per-bucket cap), record a PenaltyBucketPeriod row, and post
   * the per-source penalty charges (reusing the community_charge / be_ledger shape + unit split).
   */
  async advance(tx: TxOrClient, communityId: string, periodId: string, opts: { commit: boolean }) {
    const period = await tx.period.findUnique({ where: { id: periodId }, select: { seq: true, startDate: true, endDate: true } })
    if (!period) return
    const pStart = new Date(period.startDate)
    const pEnd = new Date(period.endDate)
    const funds = await this.penalFunds(tx, communityId)
    if (!funds.length) return
    const fundById = new Map(funds.map((f) => [f.id, f]))

    const buckets = await tx.penaltyBucket.findMany({
      where: { communityId, status: 'OPEN', fundId: { in: funds.map((f) => f.id) } },
      include: { periods: { where: { status: 'COMMITTED', periodSeq: { lt: period.seq } }, orderBy: { periodSeq: 'desc' }, take: 1 } },
    })

    // group buckets by (BE, source fund) so a period's payment settles that group's buckets FIFO
    const groups = new Map<string, { beId: string; fundId: string; f: PenalFund; buckets: typeof buckets }>()
    for (const b of buckets) {
      const f = fundById.get(b.fundId)!
      const k = `${b.billingEntityId}::${b.fundId}`
      const g = groups.get(k) ?? { beId: b.billingEntityId, fundId: b.fundId, f, buckets: [] as any }
      ;(g.buckets as any).push(b)
      groups.set(k, g)
    }

    // per (BE, source fund): { posted this period, outstanding after } → drives the posted charge
    const perBeFund = new Map<string, { beId: string; f: PenalFund; posted: number; outstanding: number; postedByUnit: Map<string, number> }>()

    for (const g of groups.values()) {
      let remainingPay = await this.streamAPayment(tx, communityId, periodId, g.beId, g.fundId)
      const ordered = (g.buckets as any[]).slice().sort((a, b) => new Date(a.firstPenalDay).getTime() - new Date(b.firstPenalDay).getTime())
      let groupPosted = 0
      let groupOutstanding = 0
      const groupPostedByUnit = new Map<string, number>() // per-unit buckets attribute posted straight to their unit
      for (const b of ordered) {
        const prev = b.periods[0]
        let principalRemaining = prev ? Number(prev.principalRemaining) : Number(b.principalOriginal)
        const penaltyAccrued = prev ? Number(prev.penaltyAccrued) : Number((b as any).seedPenaltyAccrued ?? 0)
        // apply payment FIFO oldest-first, BEFORE accrual (payer-favored)
        if (remainingPay > 0 && principalRemaining > 0) {
          const pay = Math.min(principalRemaining, remainingPay)
          principalRemaining -= pay
          remainingPay -= pay
        }
        // exact, due-date-anchored penalizable days within this period
        const lo = new Date(b.firstPenalDay) > pStart ? new Date(b.firstPenalDay) : pStart
        const days = this.countDays(lo, pEnd)
        // Each bucket accrues at the rate stamped when it was created (the schedule rate for its origin
        // month); fall back to the fund's current rate for buckets created before rate-stamping existed.
        const bucketRate = (b as any).ratePerDayPct != null ? Number((b as any).ratePerDayPct) / 100 : g.f.rate
        const penaltyN = principalRemaining * bucketRate * days
        const accrued = Math.min(penaltyAccrued + penaltyN, Number(b.principalOriginal)) // per-bucket cap
        const posted = Math.max(0, accrued - penaltyAccrued)

        await tx.penaltyBucketPeriod.upsert({
          where: { bucketId_periodId: { bucketId: b.id, periodId } },
          update: { principalRemaining, penaltyAccrued: accrued, penaltyPosted: posted, periodSeq: period.seq, status: opts.commit ? 'COMMITTED' : 'PROVISIONAL' },
          create: { bucketId: b.id, periodId, periodSeq: period.seq, principalRemaining, penaltyAccrued: accrued, penaltyPosted: posted, status: opts.commit ? 'COMMITTED' : 'PROVISIONAL' },
        })
        if (opts.commit && principalRemaining <= 0.0001) {
          await tx.penaltyBucket.update({ where: { id: b.id }, data: { status: 'SETTLED' } })
        }
        groupPosted += posted
        groupOutstanding += Math.max(0, principalRemaining)
        if (posted > 0 && (b as any).unitId) groupPostedByUnit.set((b as any).unitId, (groupPostedByUnit.get((b as any).unitId) ?? 0) + posted)
      }
      if (groupPosted > 0.0001) {
        perBeFund.set(`${g.fundId}::${g.beId}`, { beId: g.beId, f: g.f, posted: groupPosted, outstanding: groupOutstanding, postedByUnit: groupPostedByUnit })
      }
    }

    await this.postPenaltyCharges(tx, communityId, periodId, opts.commit, perBeFund)
  }

  /** Reuse of the legacy posting shape: community_charge (sourceKey penalty:<fund>) + lines, and be_ledger_entry. */
  private async postPenaltyCharges(
    tx: TxOrClient,
    communityId: string,
    periodId: string,
    commit: boolean,
    perBeFund: Map<string, { beId: string; f: PenalFund; posted: number; outstanding: number }>,
  ) {
    const penalRefType = `PENALTY_${commit ? 'CLOSE_FINAL' : 'CLOSE_PREP'}`
    // bySource: sourceCode → { targetId, lines }; beTarget: BE×target → total/detail
    const bySource = new Map<string, { targetId: string; lines: Array<{ unitId: string; beId: string; amount: number; calc: any }> }>()
    const beTargetTotal = new Map<string, { beId: string; targetId: string; amount: number }>()
    const beTargetDetail = new Map<string, Map<string, number>>()

    for (const { beId, f, posted, outstanding, postedByUnit } of perBeFund.values()) {
      // Per-unit buckets already know which unit owes what — attribute directly. Otherwise (legacy per-BE
      // buckets) fall back to splitting the group total across the BE's units by their weight share.
      let unitAmounts: Array<[string, number]>
      if (postedByUnit && postedByUnit.size) {
        unitAmounts = Array.from(postedByUnit.entries())
      } else {
        const shares = await this.penaltyUnitShares(tx, communityId, beId, f.id)
        const totalW = Array.from(shares.values()).reduce((s, v) => s + v, 0)
        if (totalW <= 0) continue
        unitAmounts = Array.from(shares.entries()).map(([u, w]) => [u, posted * (w / totalW)] as [string, number])
      }
      const entry = bySource.get(f.code) ?? { targetId: f.targetId, lines: [] }
      const k = `${beId}::${f.targetId}`
      for (const [unitId, amt] of unitAmounts) {
        entry.lines.push({ unitId, beId, amount: amt, calc: { w: amt, totalW: posted, accrued: posted, principal: outstanding, ratePerDayPct: f.rate * 100 } })
        const du = beTargetDetail.get(k) ?? new Map<string, number>()
        du.set(unitId, (du.get(unitId) ?? 0) + amt)
        beTargetDetail.set(k, du)
        const bt = beTargetTotal.get(k) ?? { beId, targetId: f.targetId, amount: 0 }
        bt.amount += amt
        beTargetTotal.set(k, bt)
      }
      bySource.set(f.code, entry)
    }

    // community_charge + community_charge_line, per source fund into its target fund
    for (const [sourceCode, { targetId, lines }] of bySource.entries()) {
      const total = lines.reduce((s, l) => s + l.amount, 0)
      const cc = await tx.communityCharge.upsert({
        where: {
          communityId_periodId_sourceType_sourceId_sourceKey_fundId: {
            communityId, periodId, sourceType: 'FUND', sourceId: targetId, sourceKey: `penalty:${sourceCode}`, fundId: targetId,
          },
        },
        update: { amount: total, currency: 'RON', allocationStrategy: 'PENALTY', status: 'ACTIVE', fundId: targetId, allocationSnapshot: { method: 'PENALTY', sourceFund: sourceCode }, meta: { source: 'PENALTY', sourceFund: sourceCode } },
        create: { communityId, periodId, fundId: targetId, sourceType: 'FUND', sourceId: targetId, sourceKey: `penalty:${sourceCode}`, amount: total, currency: 'RON', allocationStrategy: 'PENALTY', status: 'ACTIVE', allocationSnapshot: { method: 'PENALTY', sourceFund: sourceCode }, meta: { source: 'PENALTY', sourceFund: sourceCode } },
      })
      await tx.communityChargeLine.deleteMany({ where: { chargeId: cc.id } })
      await tx.communityChargeLine.createMany({
        data: lines.map((l) => ({
          chargeId: cc.id, communityId, periodId, billingEntityId: l.beId, unitId: l.unitId, amount: l.amount,
          meta: { source: 'PENALTY', sourceFund: sourceCode, allocation: { method: 'PENALTY', base: l.calc.accrued, unitMeasure: l.calc.w, totalMeasure: l.calc.totalW, principal: l.calc.principal, ratePerDayPct: l.calc.ratePerDayPct } },
        })),
        skipDuplicates: true,
      })
    }

    // be_ledger_entry (+detail) per (BE, target fund)
    for (const [k, { beId, targetId, amount }] of beTargetTotal.entries()) {
      if (amount <= 0) continue
      const le = await tx.beLedgerEntry.upsert({
        where: { communityId_periodId_billingEntityId_refType_refId_fundId: { communityId, periodId, billingEntityId: beId, refType: penalRefType, refId: periodId, fundId: targetId } },
        update: { amount, fundId: targetId },
        create: { communityId, periodId, billingEntityId: beId, kind: 'CHARGE', lane: 'ACCRUAL', amount, currency: 'RON', refType: penalRefType, refId: periodId, fundId: targetId },
      })
      await tx.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: le.id } })
      const du = beTargetDetail.get(k)
      if (du && du.size) {
        await tx.beLedgerEntryDetail.createMany({
          data: Array.from(du.entries()).map(([unitId, v]) => ({ ledgerEntryId: le.id, communityId, periodId, billingEntityId: beId, kind: 'CHARGE', fundId: targetId, currency: 'RON', refType: penalRefType, refId: periodId, unitId, amount: v, meta: { source: 'PENALTY' } })),
          skipDuplicates: true,
        })
      }
    }
  }

  /** Freeze this period's bucket rows at approve (PROVISIONAL → COMMITTED). */
  async commitPeriod(tx: TxOrClient, communityId: string, periodId: string) {
    await tx.penaltyBucketPeriod.updateMany({ where: { periodId, status: 'PROVISIONAL', bucket: { communityId } }, data: { status: 'COMMITTED' } })
    // settle buckets whose committed remaining hit zero
    const settled = await tx.penaltyBucketPeriod.findMany({ where: { periodId, status: 'COMMITTED', bucket: { communityId } }, select: { bucketId: true, principalRemaining: true } })
    for (const s of settled) {
      if (Number(s.principalRemaining) <= 0.0001) await tx.penaltyBucket.update({ where: { id: s.bucketId }, data: { status: 'SETTLED' } })
    }
  }

  /**
   * Cutover seed: build one bucket per (BE, penalty-bearing source fund) from the migrated arrears
   * (`beOpeningBalance` at the cutover period). PRINCIPAL openings → the bucket's principal; carried
   * PENALTY openings (fund=target, originKey `PEN:<srcCode>`) → the bucket's seeded `penaltyAccrued`
   * via a COMMITTED PenaltyBucketPeriod at cutoverSeq-1 so `advance` starts from the carried state.
   * Idempotent per (community, BE, fund) with originKey='opening'.
   */
  async seedFromOpenings(communityId: string, cutoverPeriodId: string) {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.period.findUnique({ where: { id: cutoverPeriodId }, select: { seq: true, dueDate: true } })
      if (!period) return { created: 0 }
      const community = await tx.community.findUnique({ where: { id: communityId }, select: { penaltyGraceDays: true } })
      const graceDays = Number((community as any)?.penaltyGraceDays ?? 30)
      const funds = await this.penalFunds(tx, communityId)
      if (!funds.length) return { created: 0 }
      const codeToFund = new Map(funds.map((f) => [f.code, f]))

      const openings = await tx.beOpeningBalance.findMany({
        where: { communityId, periodId: cutoverPeriodId },
        select: { billingEntityId: true, fundId: true, amount: true, dueDate: true, kind: true, originKey: true },
      })
      const fundIdToCode = new Map((await tx.fund.findMany({ where: { communityId }, select: { id: true, code: true } })).map((f) => [f.id, f.code]))

      // principal per (BE, sourceFund); carried penalty per (BE, sourceFund)
      const principal = new Map<string, { beId: string; f: PenalFund; amt: number; dueDate: Date | null }>()
      const carried = new Map<string, number>()
      for (const o of openings) {
        const amt = Number(o.amount ?? 0)
        const fcode = o.fundId ? fundIdToCode.get(o.fundId) : undefined
        if (o.kind === 'PENALTY') {
          // originKey 'PEN:<srcCode>' → attribute to that source fund's carried penalty
          const src = (o.originKey || '').startsWith('PEN:') ? o.originKey.slice(4) : null
          if (src && codeToFund.has(src)) carried.set(`${o.billingEntityId}::${src}`, (carried.get(`${o.billingEntityId}::${src}`) ?? 0) + amt)
          continue
        }
        // PRINCIPAL: only for penalty-bearing source funds
        if (!fcode || !codeToFund.has(fcode)) continue
        const k = `${o.billingEntityId}::${fcode}`
        const cur = principal.get(k) ?? { beId: o.billingEntityId, f: codeToFund.get(fcode)!, amt: 0, dueDate: o.dueDate ?? null }
        cur.amt += amt
        if (o.dueDate && !cur.dueDate) cur.dueDate = o.dueDate
        principal.set(k, cur)
      }

      let created = 0
      for (const [k, p] of principal.entries()) {
        if (p.amt <= 0) continue
        const firstPenalDay = p.dueDate
          ? new Date(new Date(p.dueDate).getTime() + (graceDays + 1) * DAY)
          : new Date(0)
        const carriedPen = carried.get(`${p.beId}::${p.f.code}`) ?? 0
        await tx.penaltyBucket.upsert({
          where: { communityId_billingEntityId_fundId_originKey: { communityId, billingEntityId: p.beId, fundId: p.f.id, originKey: 'opening' } },
          update: { principalOriginal: p.amt, targetFundId: p.f.targetId, dueDate: p.dueDate, firstPenalDay, seedPenaltyAccrued: carriedPen } as any,
          create: { communityId, billingEntityId: p.beId, fundId: p.f.id, targetFundId: p.f.targetId, originKey: 'opening', dueDate: p.dueDate, firstPenalDay, principalOriginal: p.amt, seedPenaltyAccrued: carriedPen, status: 'OPEN' } as any,
        })
        created++
      }
      return { created }
    })
  }

  /** Undo this period's bucket advance at reopen (drop its PenaltyBucketPeriod rows). */
  async revertPeriod(tx: TxOrClient, communityId: string, periodId: string) {
    await tx.penaltyBucketPeriod.deleteMany({ where: { periodId, bucket: { communityId } } })
    // any bucket marked SETTLED by this period may need reopening; recompute lazily on next advance
    await tx.penaltyBucket.updateMany({ where: { communityId, status: 'SETTLED' }, data: { status: 'OPEN' } })
  }
}
