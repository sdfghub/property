import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import type { Prisma, PrismaClient } from '@prisma/client'
import { rateForDate, originAnchorDate } from './penalty-rate'
import { isUnitSplitTrusted } from '../finance/split-trusted'

type TxOrClient = PrismaClient | Prisma.TransactionClient
const DAY = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
// Same cutover anchor `import-historical-penalty-buckets.ts` uses for Kralik's pre-tracking
// remainder — see that script's own doc for where this date comes from. Not yet a per-community
// setting (see plan's "explicitly out of scope"); every community reconciled today is Kralik.
const PRE_TRACKING_DUE_DATE = new Date('2021-04-18')

export type AgingSlice = {
  originKey: string
  originPeriodCode: string | null
  dueDate: Date | null
  firstPenalDay: Date
  principal: number
  ageDays: number
  ratePerDayPct: number
  penaltyProjected: number
}
export type ReconciledAging = {
  unitId: string
  unitCode: string
  fundId: string
  fundCode: string
  liveTotal: number
  anchorTrusted: boolean
  hasRateSchedule: boolean
  bucketDrift: number // existing period:* buckets' own remaining minus liveTotal, pre-normalization; nonzero ⇒ the live engine itself has drifted (see reconcileUnitFund's doc)
  slices: AgingSlice[]
}

/**
 * Formalizes, for ANY fund (penalty-configured or not) and any unit, the reconstruction
 * methodology already coded one-off in `src/scripts/import-historical-penalty-buckets.ts`: take
 * the unit's CURRENT restanță for the analyzed period — `dueStart − payments`, the avizier's own
 * named "Restanțe" figure (see `finance.service.ts avizier()`'s `soldFundRows` comment:
 * "Restanțe_shown = dueStart − payments, NOT clamped at zero") — walk the unit's own CHARGE
 * history newest → oldest subtracting each month until exhausted, and let the oldest slice absorb
 * whatever remains past tracked history. The analyzed period's OWN fresh charge is deliberately
 * excluded throughout (it isn't due yet, so it isn't restanță) — both from the anchor and from
 * the existing-bucket read (`reconcileUnitFund` only reads `period:*` buckets strictly OLDER than
 * the asOf period). Because every call re-anchors to `dueStart − payments`, the sum of a unit's
 * slices for a fund always equals that fund's avizier restanță for the SAME period, by
 * construction — unlike `PenaltyBucket.principalRemaining`, which `advance()` updates
 * incrementally and can drift from the ledger until this service re-syncs it.
 * `ReportsService.riskExposureDetail` cross-checks this identity against `be_statement.due_start −
 * payments` per fund and surfaces any residual (`checks` in its response) — a nonzero residual
 * means this methodology has a bug, not a rounding footnote.
 *
 * Read-only by default (`reconcileUnitFund`/`reconcileCommunity`); `applyReconciliation` is the
 * only method that writes, and only ever creates/updates `opening`/`hist:`-keyed buckets to fill
 * the gap below whatever the live `ensureBuckets()`/`advance()` engine already tracks — it never
 * touches a `period:`-origin bucket, which stays that engine's sole responsibility.
 */
@Injectable()
export class PenaltyReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  private countDays(from: Date, to: Date): number {
    if (from > to) return 0
    return Math.floor((to.getTime() - from.getTime()) / DAY) + 1
  }

  /** The unit's live restanță for this fund, and whether its BE's per-unit split can be trusted. */
  private async resolveLiveTotal(
    tx: TxOrClient, communityId: string, unitId: string, fundId: string, periodId: string, periodSeq: number,
  ): Promise<{ liveTotal: number; anchorTrusted: boolean }> {
    const membership = await (tx as any).billingEntityMember.findFirst({
      where: { unitId, startSeq: { lte: periodSeq }, OR: [{ endSeq: null }, { endSeq: { gte: periodSeq } }] },
      select: { billingEntityId: true },
    })
    if (!membership) {
      // No BE membership at all (data-integrity edge case) — nothing more authoritative than the
      // unit's own BeUnitStatement to fall back to.
      const unitStmt = await (tx as any).beUnitStatement.findUnique({
        where: { communityId_periodId_unitId_fundId: { communityId, periodId, unitId, fundId } },
        select: { dueStart: true, payments: true },
      })
      return { liveTotal: round2(Number(unitStmt?.dueStart ?? 0) - Number(unitStmt?.payments ?? 0)), anchorTrusted: true }
    }

    // Anchored on dueStart − payments — the codebase's own named "Restanțe" figure (see
    // `avizier()`'s `soldFundRows` comment: "Restanțe_shown = dueStart − payments, NOT clamped at
    // zero" — literally what the avizier UI labels Restanțe and what the association means by the
    // word). NOT dueEnd (dueStart + charges − payments + adjustments): that additionally folds in
    // THIS period's own fresh charge, which isn't overdue yet and isn't what "restanță" means here
    // — tried dueEnd 2026-09-14, reverted the same day once cross-checked against avizier's real
    // per-unit output: every fund matched to the cent using dueStart−payments (avizier's
    // `soldByFund`) and was off by exactly that period's own charge under dueEnd. Confirmed
    // directly against Dascăl Adriana/AP32 EXPENSES too: dueStart 122.71 − payments 123.00 ≈ 0,
    // matching "no restanță for July, a receipt covered it" exactly — the case that started this.
    // BeStatement, not BeUnitStatement, is the authoritative total — BeUnitStatement's own
    // carried-forward chain can drift from it even for a SINGLE-unit BE (Petrean Delia/AP4(I)
    // showed a real drift 2026-09-13). Only ever use BeUnitStatement to decide the SPLIT across a
    // multi-unit BE's units, never as the total itself.
    const beStmt = await (tx as any).beStatement.findUnique({
      where: { communityId_periodId_billingEntityId_fundId: { communityId, periodId, billingEntityId: membership.billingEntityId, fundId } },
      select: { dueStart: true, payments: true },
    })
    const beLive = Number(beStmt?.dueStart ?? 0) - Number(beStmt?.payments ?? 0)

    const activeUnits = await (tx as any).billingEntityMember.findMany({
      where: { billingEntityId: membership.billingEntityId, startSeq: { lte: periodSeq }, OR: [{ endSeq: null }, { endSeq: { gte: periodSeq } }] },
      select: { unitId: true },
    })
    // Sole unit: 100% attribution is trivially correct regardless of BeUnitStatement's own chain.
    if (activeUnits.length <= 1) return { liveTotal: round2(beLive), anchorTrusted: true }

    const unitRows = await (tx as any).beUnitStatement.findMany({
      where: { communityId, periodId, fundId, unitId: { in: activeUnits.map((u: any) => u.unitId) } },
      select: { unitId: true, dueStart: true, payments: true },
    })
    // Trust gate: SAME grain `avizier()`'s own unitRows use — dueEnd summed across EVERY fund for
    // the whole BE, not just this one fund (see `finance.service.ts`'s `unitDueEndSumByBe`/`stmt`).
    // A per-fund-only trust check (tried 2026-09-16, reverted the same day) can disagree with
    // avizier's BE-wide decision — trusting a fund avizier doesn't (or the reverse) — which then
    // shows a real split here where avizier shows zero, or zero here where avizier shows a real
    // split: either way the two totals stop agreeing. Reusing the exact same aggregate keeps them
    // in lockstep by construction, not by approximation.
    const [beDueEnd, unitDueEndRows] = await Promise.all([
      (tx as any).beStatement.aggregate({
        where: { communityId, periodId, billingEntityId: membership.billingEntityId },
        _sum: { dueEnd: true },
      }),
      (tx as any).beUnitStatement.groupBy({
        by: ['unitId'],
        where: { communityId, periodId, unitId: { in: activeUnits.map((u: any) => u.unitId) } },
        _sum: { dueEnd: true },
      }),
    ])
    const beDueEndTotal = Number(beDueEnd._sum.dueEnd ?? 0)
    const unitDueEndSum = unitDueEndRows.reduce((s: number, r: any) => s + Number(r._sum.dueEnd ?? 0), 0)
    if (isUnitSplitTrusted(unitDueEndSum, beDueEndTotal)) {
      const thisUnit = unitRows.find((r: any) => r.unitId === unitId)
      const unitLive = thisUnit ? Number(thisUnit.dueStart) - Number(thisUnit.payments) : 0
      return { liveTotal: round2(unitLive), anchorTrusted: true }
    }
    // Untrusted split: no reliable per-unit signal. `avizier()`'s own unit-mode view faces the
    // exact same problem and resolves it by showing zero rather than fabricating a number (see
    // `finance.service.ts`'s unitRows: `trusted ? finByUnit(...) : zeroFinancials`) — mirror that
    // exactly, or a per-unit reconciliation could never agree with what the avizier itself shows
    // for these units (an even-share ESTIMATE was tried 2026-09-16 and reverted the same day: it
    // made the total agree with the BE-level be_statement sum, but disagreed with what `avizier()`
    // actually renders in unit mode, which is what an admin visually compares against). The real,
    // unambiguous BE-level total is never lost — it's what `reconcileBeFund`/`reconcileCommunityByOwner`
    // return for "Proprietar" mode, exactly mirroring how avizier's own entity/Proprietar view
    // always shows `finByBe()` regardless of per-unit split trust.
    return { liveTotal: 0, anchorTrusted: false }
  }

  /**
   * BE-grain counterpart to `reconcileUnitFund`, for "Proprietar" (owner) mode: sums every one of
   * the billing entity's units' own charge history together and walks it exactly the same way —
   * no per-unit split involved, so (unlike the per-unit path) it never has an "untrusted" case:
   * `dueStart − payments` at BE grain is always the real, unambiguous number (same one `avizier()`'s
   * own entity/Proprietar view shows via `finByBe()`). This is the only place a multi-unit BE's
   * real exposure is visible when its per-unit split can't be trusted for a given period.
   */
  async reconcileBeFund(tx: TxOrClient, communityId: string, beId: string, fundId: string, asOfPeriodId: string): Promise<ReconciledAging | null> {
    const [be, fund, period, community] = await Promise.all([
      (tx as any).billingEntity.findUnique({ where: { id: beId }, select: { code: true } }),
      (tx as any).fund.findUnique({ where: { id: fundId }, select: { code: true, allocation: true } }),
      (tx as any).period.findUnique({ where: { id: asOfPeriodId }, select: { seq: true, dueDate: true, afisareDate: true, endDate: true } }),
      (tx as any).community.findUnique({ where: { id: communityId }, select: { penaltyGraceDays: true } }),
    ])
    if (!be || !fund || !period) return null
    const alloc = (fund.allocation as any) || {}
    const hasRateSchedule = alloc.penaltyPerDayPct != null
    const graceDays = Number(community?.penaltyGraceDays ?? 30)
    const asOf = period.afisareDate ? new Date(period.afisareDate) : new Date(period.endDate)

    const beStmt = await (tx as any).beStatement.findUnique({
      where: { communityId_periodId_billingEntityId_fundId: { communityId, periodId: asOfPeriodId, billingEntityId: beId, fundId } },
      select: { dueStart: true, payments: true },
    })
    const liveTotal = round2(Number(beStmt?.dueStart ?? 0) - Number(beStmt?.payments ?? 0))

    const existing: any[] = await (tx as any).$queryRawUnsafe(
      `select pb.origin_key as "originKey", op.id as "periodId",
              (select pbp.principal_remaining::float8 from penalty_bucket_period pbp
                where pbp.bucket_id = pb.id order by pbp.period_seq desc limit 1) as "lastRemaining"
         from penalty_bucket pb
         join period op on op.id = split_part(pb.origin_key, ':', 2)
        where pb.community_id = $1 and pb.fund_id = $2 and pb.status = 'OPEN' and pb.origin_key like 'period:%'
          and op.seq < $4 and pb.billing_entity_id = $3`,
      communityId, fundId, beId, period.seq,
    )
    const trackedPeriodIds = new Set<string>(existing.map((r) => r.periodId))
    const existingRemaining = round2(existing.reduce((s, r) => s + (r.lastRemaining != null ? Number(r.lastRemaining) : 0), 0))
    const bucketDrift = round2(existingRemaining - liveTotal)

    // Every one of this BE's units' own CHARGE history, pooled by period (a multi-unit BE's own
    // months line up across its units since they're billed together) — same walk as
    // reconcileUnitFund, just summed across units first. For a unit this BE took over from a
    // previous owner, the unit's charges from BEFORE the takeover (billed to the predecessor) are
    // included too: a balance inherited with the unit (e.g. Ap 2/2, Gampe → Valean, 2026-06) must
    // age from the months it was really charged, exactly like reconcileUnitFund (which walks the
    // unit's history across owners) — not collapse into the pre-tracking "opening" catch-all
    // (PRE_TRACKING_DUE_DATE). When nothing was inherited, FIFO simply pays those older months
    // off first, so they add no slice.
    const rows: any[] = await (tx as any).$queryRawUnsafe(
      `select pr.id as "periodId", pr.code, pr.due_date as due, sum(led.amount)::float8 as amt
         from be_ledger_entry_detail led join period pr on pr.id = led.period_id
        where led.community_id = $1 and led.fund_id = $3
          and led.kind = 'CHARGE' and pr.seq < $4
          and (led.billing_entity_id = $2 or exists (
                select 1 from billing_entity_member bem
                 where bem.billing_entity_id = $2 and bem.unit_id = led.unit_id
                   and bem.start_seq <= $4 and (bem.end_seq is null or bem.end_seq >= $4)
                   and pr.seq < bem.start_seq))
        group by pr.id, pr.code, pr.seq, pr.due_date
        order by pr.seq asc`,
      communityId, beId, fundId, period.seq,
    )
    const months = rows
      .map((r) => ({ periodId: r.periodId as string, code: r.code as string, due: new Date(r.due), amt: Math.max(0, Number(r.amt)) }))
      .filter((m) => m.amt > 0.005)
    const totalCharges = round2(months.reduce((s, m) => s + m.amt, 0))

    const mkSlice = (m: { periodId: string; code: string; due: Date }, principal: number): AgingSlice => ({
      originKey: trackedPeriodIds.has(m.periodId) ? `period:${m.periodId}` : `hist:${beId}:${m.code}`,
      originPeriodCode: m.code, dueDate: m.due, firstPenalDay: new Date(m.due.getTime() + (graceDays + 1) * DAY),
      principal: round2(principal), ageDays: 0, ratePerDayPct: 0, penaltyProjected: 0,
    })

    const slices: AgingSlice[] = []
    let paidDown = round2(totalCharges - liveTotal)
    if (paidDown < -0.005) {
      for (const m of months) slices.push(mkSlice(m, m.amt))
      slices.push({
        originKey: `hist:${beId}:opening`, originPeriodCode: null, dueDate: PRE_TRACKING_DUE_DATE,
        firstPenalDay: new Date(PRE_TRACKING_DUE_DATE.getTime() + (graceDays + 1) * DAY),
        principal: round2(-paidDown), ageDays: 0, ratePerDayPct: 0, penaltyProjected: 0,
      })
    } else {
      for (const m of months) {
        if (paidDown >= m.amt - 0.005) { paidDown = round2(paidDown - m.amt); continue }
        const remaining = round2(m.amt - paidDown)
        paidDown = 0
        if (remaining > 0.005) slices.push(mkSlice(m, remaining))
      }
    }

    if (slices.length) {
      const rawTotal = round2(slices.reduce((s, x) => s + x.principal, 0))
      const residual = round2(liveTotal - rawTotal)
      if (Math.abs(residual) > 0.001) {
        const newest = slices.reduce((a, b) => (b.firstPenalDay > a.firstPenalDay ? b : a), slices[0])
        newest.principal = round2(newest.principal + residual)
      }
    }

    for (const s of slices) {
      const originDate = originAnchorDate(s.originKey, s.dueDate, null)
      s.ratePerDayPct = rateForDate(alloc, originDate, 0)
      s.ageDays = this.countDays(s.firstPenalDay, asOf)
      s.penaltyProjected = round2(Math.min(s.principal * (s.ratePerDayPct / 100) * Math.max(0, s.ageDays), s.principal))
    }

    return { unitId: beId, unitCode: be.code, fundId, fundCode: fund.code, liveTotal, anchorTrusted: true, hasRateSchedule, bucketDrift, slices }
  }

  /** Every fund × every billing entity with a nonzero live balance, as of `asOfPeriodId` — the
   * "Proprietar" counterpart to `reconcileCommunity`, via `reconcileBeFund`. */
  async reconcileCommunityByOwner(communityId: string, asOfPeriodId: string, opts?: { fundCode?: string; beId?: string }): Promise<ReconciledAging[]> {
    const beRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select bs.billing_entity_id as "beId", bs.fund_id as "fundId"
         from be_statement bs join fund f on f.id = bs.fund_id
        where bs.community_id = $1 and bs.period_id = $2 and abs(bs.due_start - bs.payments) > 0.005
          ${opts?.fundCode ? 'and f.code = $3' : ''}`,
      ...(opts?.fundCode ? [communityId, asOfPeriodId, opts.fundCode] : [communityId, asOfPeriodId]),
    )
    const out: ReconciledAging[] = []
    for (const r of beRows) {
      if (opts?.beId && r.beId !== opts.beId) continue
      const res = await this.reconcileBeFund(this.prisma as any, communityId, r.beId, r.fundId, asOfPeriodId)
      if (res && Math.abs(res.liveTotal) > 0.005) out.push(res)
    }
    return out
  }

  /**
   * Reconstruct one (unit, fund)'s full aging breakdown as of `asOfPeriodId`, anchored to the
   * unit's current live restanță. Pure read — no writes.
   *
   * A single, uniform FIFO walk over the unit's REAL, COMPLETE charge history — not "trust the
   * live bucket engine's own buckets, backfill only the gap below them" (the design until
   * 2026-09-15). That two-tier approach broke exactly the FIFO rule it was meant to honor: a
   * payment with no real `PaymentApplication` link (found 2026-09-15 on Ap 1/B: an 8.61 lei
   * "payment" ledger row citing a `Payment` id that doesn't exist — an orphaned reference, likely
   * from a one-off migration script) gets applied by the LIVE engine's `advance()` to whichever
   * bucket IT happens to track as oldest — but that engine only tracks buckets from whenever
   * `ensureBuckets()` started running for this fund forward, so a genuinely older, untracked month
   * (March, here) never gets a chance to absorb it; the reduction lands on May instead, purely
   * because May is the oldest bucket the LIVE system happens to know about, not the oldest debt
   * that actually exists. Anchoring the display on the live buckets' own `principalRemaining`
   * baked that narrow-window FIFO into the picture. Instead: total up every tracked month's own
   * CHARGE, take `paidDown = totalCharges − liveTotal` (however much has been paid off across the
   * WHOLE history, in aggregate), and walk oldest → newest consuming `paidDown` against each
   * month's own charge — the months it fully covers are shown as paid (no slice at all), the one
   * it partially covers gets the remainder, everything newer is untouched at full charge. This is
   * mathematically exact by construction (Σ slices ≡ liveTotal, no separate normalization needed)
   * and it is FIFO over the unit's real, full history, not just whatever the live engine tracks.
   *
   * A month that DOES have a real, currently OPEN `period:`-origin bucket is still labelled as
   * such (`originKey: 'period:<id>'`) rather than `hist:` — purely informational, so
   * `applyReconciliation` knows not to write over it (that stays `advance()`'s own responsibility)
   * — but its principal here always comes from this walk, never from the bucket's own
   * `principalRemaining`. `bucketDrift` (existingRemaining − liveTotal, still computed) is now a
   * pure diagnostic: how far the live engine's own tracking has drifted from the ledger truth,
   * useful for flagging that `advance()` itself may need attention, no longer load-bearing for
   * what this method displays.
   */
  async reconcileUnitFund(tx: TxOrClient, communityId: string, unitId: string, fundId: string, asOfPeriodId: string): Promise<ReconciledAging | null> {
    const [unit, fund, period, community] = await Promise.all([
      (tx as any).unit.findUnique({ where: { id: unitId }, select: { code: true } }),
      (tx as any).fund.findUnique({ where: { id: fundId }, select: { code: true, allocation: true } }),
      (tx as any).period.findUnique({ where: { id: asOfPeriodId }, select: { seq: true, dueDate: true, afisareDate: true, endDate: true } }),
      (tx as any).community.findUnique({ where: { id: communityId }, select: { penaltyGraceDays: true } }),
    ])
    if (!unit || !fund || !period) return null
    const alloc = (fund.allocation as any) || {}
    const hasRateSchedule = alloc.penaltyPerDayPct != null
    const graceDays = Number(community?.penaltyGraceDays ?? 30)
    const asOf = period.afisareDate ? new Date(period.afisareDate) : new Date(period.endDate)

    const { liveTotal, anchorTrusted } = await this.resolveLiveTotal(tx, communityId, unitId, fundId, asOfPeriodId, period.seq)

    // Whichever this unit's sole-owning BE is right now, for reading its already-tracked buckets
    // — a bucket's identity is unitId-keyed, so this is informational, not part of the lookup key.
    // A still-unmigrated legacy bucket (unitId=null) only ever belongs to a single-unit BE (see
    // penalty-ledger.service.ts's own note) — include those too when this unit has no siblings.
    const membership = await (tx as any).billingEntityMember.findFirst({
      where: { unitId, startSeq: { lte: period.seq }, OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }] },
      select: { billingEntityId: true },
    })
    const siblingCount = membership
      ? await (tx as any).billingEntityMember.count({
          where: { billingEntityId: membership.billingEntityId, startSeq: { lte: period.seq }, OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }] },
        })
      : 1
    const includeNullUnit = siblingCount <= 1

    // Real, currently-tracked buckets — used ONLY for labelling (period: vs hist:) and the
    // `bucketDrift` diagnostic below, never for a slice's principal amount (see method doc).
    const existing: any[] = await (tx as any).$queryRawUnsafe(
      `select pb.origin_key as "originKey", op.id as "periodId",
              (select pbp.principal_remaining::float8 from penalty_bucket_period pbp
                where pbp.bucket_id = pb.id order by pbp.period_seq desc limit 1) as "lastRemaining"
         from penalty_bucket pb
         join period op on op.id = split_part(pb.origin_key, ':', 2)
        where pb.community_id = $1 and pb.fund_id = $2 and pb.status = 'OPEN' and pb.origin_key like 'period:%'
          and op.seq < $6
          and (pb.unit_id = $3 or ($4 and pb.unit_id is null and pb.billing_entity_id = $5))`,
      communityId, fundId, unitId, includeNullUnit, membership?.billingEntityId ?? '', period.seq,
    )
    const existingRemaining = round2(existing.reduce((s, r) => s + (r.lastRemaining != null ? Number(r.lastRemaining) : 0), 0))
    const trackedPeriodIds = new Set<string>(existing.map((r) => r.periodId))
    const bucketDrift = round2(existingRemaining - liveTotal)

    // This unit's REAL, complete monthly CHARGE history on this fund — every tracked month,
    // oldest → newest, strictly before the asOf period (its own fresh charge isn't restanță yet).
    const rows: any[] = await (tx as any).$queryRawUnsafe(
      `select pr.id as "periodId", pr.code, pr.due_date as due, sum(led.amount)::float8 as amt
         from be_ledger_entry_detail led join period pr on pr.id = led.period_id
        where led.community_id = $1 and led.unit_id = $2 and led.fund_id = $3
          and led.kind = 'CHARGE' and pr.seq < $4
        group by pr.id, pr.code, pr.seq, pr.due_date
        order by pr.seq asc`,
      communityId, unitId, fundId, period.seq,
    )
    const months = rows
      .map((r) => ({ periodId: r.periodId as string, code: r.code as string, due: new Date(r.due), amt: Math.max(0, Number(r.amt)) }))
      .filter((m) => m.amt > 0.005)
    const totalCharges = round2(months.reduce((s, m) => s + m.amt, 0))

    const mkSlice = (m: { periodId: string; code: string; due: Date }, principal: number): AgingSlice => ({
      originKey: trackedPeriodIds.has(m.periodId) ? `period:${m.periodId}` : `hist:${unitId}:${m.code}`,
      originPeriodCode: m.code, dueDate: m.due, firstPenalDay: new Date(m.due.getTime() + (graceDays + 1) * DAY),
      principal: round2(principal), ageDays: 0, ratePerDayPct: 0, penaltyProjected: 0,
    })

    const slices: AgingSlice[] = []
    let paidDown = round2(totalCharges - liveTotal)
    if (paidDown < -0.005) {
      // liveTotal exceeds even the FULL tracked charge history — every tracked month is entirely
      // unpaid, plus a pre-tracking "opening" catch-all for whatever predates the ledger itself.
      for (const m of months) slices.push(mkSlice(m, m.amt))
      slices.push({
        originKey: `hist:${unitId}:opening`, originPeriodCode: null, dueDate: PRE_TRACKING_DUE_DATE,
        firstPenalDay: new Date(PRE_TRACKING_DUE_DATE.getTime() + (graceDays + 1) * DAY),
        principal: round2(-paidDown), ageDays: 0, ratePerDayPct: 0, penaltyProjected: 0,
      })
    } else {
      for (const m of months) {
        if (paidDown >= m.amt - 0.005) { paidDown = round2(paidDown - m.amt); continue } // fully paid off — no slice
        const remaining = round2(m.amt - paidDown)
        paidDown = 0
        if (remaining > 0.005) slices.push(mkSlice(m, remaining))
      }
    }

    // Sub-cent rounding leak from repeatedly round2()-ing intermediate month charges (a handful of
    // 0.0044-style tails don't survive being rounded away one month at a time) — fold the residual
    // into the newest slice so the identity holds to the cent, exactly, always.
    if (slices.length) {
      const rawTotal = round2(slices.reduce((s, x) => s + x.principal, 0))
      const residual = round2(liveTotal - rawTotal)
      if (Math.abs(residual) > 0.001) {
        const newest = slices.reduce((a, b) => (b.firstPenalDay > a.firstPenalDay ? b : a), slices[0])
        newest.principal = round2(newest.principal + residual)
      }
    }

    for (const s of slices) {
      const originDate = originAnchorDate(s.originKey, s.dueDate, null)
      s.ratePerDayPct = rateForDate(alloc, originDate, 0)
      s.ageDays = this.countDays(s.firstPenalDay, asOf)
      s.penaltyProjected = round2(Math.min(s.principal * (s.ratePerDayPct / 100) * Math.max(0, s.ageDays), s.principal))
    }

    return { unitId, unitCode: unit.code, fundId, fundCode: fund.code, liveTotal: round2(liveTotal), anchorTrusted, hasRateSchedule, bucketDrift, slices }
  }

  /**
   * Every fund × every unit with a nonzero live balance on it, as of `asOfPeriodId` — INCLUDING
   * units in credit (a negative `liveTotal`), not just debtors. The avizier's own grand total
   * ("Restanțe", see `avizier()`'s `soldByFund` — summed unclamped across every row) nets credits
   * against debts, so a report that only ever listed positive balances could never sum to that
   * total and would silently drop any unit that happens to be paid ahead (found 2026-09-16: Ap 3
   * is ~1600 lei ahead on REABILITARE_3 and simply never appeared). A credit unit's slices are
   * always empty (nothing to age — see reconcileUnitFund) so it renders as blank cells; only its
   * net total contributes, exactly mirroring how the avizier displays it.
   */
  async reconcileCommunity(communityId: string, asOfPeriodId: string, opts?: { fundCode?: string; unitId?: string }): Promise<ReconciledAging[]> {
    const period = await this.prisma.period.findUnique({ where: { id: asOfPeriodId }, select: { seq: true } })
    if (!period) return []
    // Candidate (BE, fund) pairs from BeStatement — the authoritative total (see resolveLiveTotal's
    // own note on BeUnitStatement drift) — then expand each BE to its currently active units.
    // abs(...) rather than a positive-only threshold: a real credit balance is as much a candidate
    // as a real debt (see method doc) — only an exact/near-zero balance (no activity) is skipped.
    const beRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select bs.billing_entity_id as "beId", bs.fund_id as "fundId"
         from be_statement bs join fund f on f.id = bs.fund_id
        where bs.community_id = $1 and bs.period_id = $2 and abs(bs.due_start - bs.payments) > 0.005
          ${opts?.fundCode ? 'and f.code = $3' : ''}`,
      ...(opts?.fundCode ? [communityId, asOfPeriodId, opts.fundCode] : [communityId, asOfPeriodId]),
    )
    if (!beRows.length) return []
    const beIds = Array.from(new Set(beRows.map((r) => r.beId)))
    const members = await this.prisma.billingEntityMember.findMany({
      where: { billingEntityId: { in: beIds }, startSeq: { lte: period.seq }, OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }] },
      select: { billingEntityId: true, unitId: true },
    })
    const unitsByBe = new Map<string, string[]>()
    for (const m of members) unitsByBe.set(m.billingEntityId, [...(unitsByBe.get(m.billingEntityId) ?? []), m.unitId])

    const pairs: Array<{ unitId: string; fundId: string }> = []
    const seen = new Set<string>()
    for (const r of beRows) {
      for (const unitId of unitsByBe.get(r.beId) ?? []) {
        if (opts?.unitId && unitId !== opts.unitId) continue
        const key = `${unitId}::${r.fundId}`
        if (seen.has(key)) continue
        seen.add(key)
        pairs.push({ unitId, fundId: r.fundId })
      }
    }

    const out: ReconciledAging[] = []
    for (const p of pairs) {
      const r = await this.reconcileUnitFund(this.prisma as any, communityId, p.unitId, p.fundId, asOfPeriodId)
      if (r && Math.abs(r.liveTotal) > 0.005) out.push(r)
    }
    return out
  }

  /**
   * Persist a reconciliation: upsert every slice as a real `PenaltyBucket` (idempotent on its own
   * `originKey`, same convention `import-historical-penalty-buckets.ts` uses), seeding retroactive
   * penalty via `seedPenaltyAccrued` for slices the live engine has never advanced. Written buckets
   * are ordinary `status='OPEN'` rows — the next `ensureBuckets()`/`advance()` cycle ages them
   * forward automatically, no special-casing needed elsewhere. Never touches a `period:`-origin
   * bucket (that stays the live engine's own).
   */
  async applyReconciliation(communityId: string, asOfPeriodId: string, opts?: { fundCode?: string; unitId?: string }) {
    const results = await this.reconcileCommunity(communityId, asOfPeriodId, opts)
    let written = 0
    await this.prisma.$transaction(async (tx) => {
      for (const r of results) {
        const fund = await (tx as any).fund.findUnique({ where: { id: r.fundId }, select: { allocation: true } })
        const targetCode = ((fund?.allocation as any)?.penaltyFundCode) || 'PENALIZARI'
        const targetFund = await (tx as any).fund.findFirst({ where: { communityId, code: targetCode }, select: { id: true } })
        const membership = await (tx as any).billingEntityMember.findFirst({
          where: { unitId: r.unitId, endPeriodId: null },
          select: { billingEntityId: true },
        })
        if (!membership) continue
        for (const s of r.slices) {
          if (!s.originKey.startsWith('hist:') || s.principal <= 0.005) continue
          await (tx as any).penaltyBucket.upsert({
            where: { communityId_unitId_fundId_originKey: { communityId, unitId: r.unitId, fundId: r.fundId, originKey: s.originKey } },
            update: { principalOriginal: s.principal, targetFundId: targetFund?.id, dueDate: s.dueDate, firstPenalDay: s.firstPenalDay, seedPenaltyAccrued: s.penaltyProjected },
            create: {
              communityId, billingEntityId: membership.billingEntityId, unitId: r.unitId, fundId: r.fundId,
              targetFundId: targetFund?.id, originKey: s.originKey, dueDate: s.dueDate, firstPenalDay: s.firstPenalDay,
              principalOriginal: s.principal, seedPenaltyAccrued: s.penaltyProjected, status: 'OPEN',
            },
          })
          written++
        }
      }
    })
    return { unitsReconciled: results.length, bucketsWritten: written }
  }
}
