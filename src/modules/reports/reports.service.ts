import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { FUND_DOMAIN_META, RISK_TIER_META } from '../../common/enums-meta'
import { PenaltyReconciliationService } from '../period/penalty-reconciliation.service'
import { FinanceService } from '../finance/finance.service'
import { isUnitSplitTrusted } from '../finance/split-trusted'

/**
 * Reports built on top of the already-computed statement snapshots.
 *
 * Collection rate ("grad de colectare"): of everything the association was owed cumulatively
 * up to period P, how much has actually been collected — broken down by fund domain, fund and
 * billing entity.
 *
 * The whole report rests on the invariant `computeStatements` maintains:
 *
 *     due_end = due_start + charges − payments + adjustments
 *
 * so for one (billing entity, fund) over all periods p ≤ P:
 *
 *     owed        = due_start(first period) + Σ charges + Σ adjustments
 *     paid        = Σ payments
 *     outstanding = due_end(P)                    ← read directly, never recomputed
 *     rate%       = paid / Σ charges × 100        ← "grad de colectare": paid over INVOICED
 *                                                   (charges only — not owed, which also carries
 *                                                   opening arrears + adjustments/re-basings)
 *
 * `owed − paid == outstanding` therefore holds exactly. It is derived independently here
 * (rather than defining owed as outstanding + paid) precisely so the identity is a real check;
 * `checks.identityOk` in the payload reports it.
 *
 * Adjustments belong in `owed`: a `scutire-penalizari` write-off genuinely reduces what is owed.
 * The opening due_start matters because it carries migrated arrears from before the first
 * computed period.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: PenaltyReconciliationService,
    private readonly finance: FinanceService,
  ) {}

  /** Latest period that has computed be_statement rows (prefers CLOSED, else the newest). */
  private async latestStatementPeriod(communityId: string) {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select p.id, p.code, p.seq, p.status, p.afisare_date, p.due_date
         from period p
        where p.community_id = $1
          and exists (select 1 from be_statement bs where bs.period_id = p.id)
        order by (p.status = 'CLOSED') desc, p.seq desc
        limit 1`,
      communityId,
    )
    return rows?.[0] ?? null
  }

  private async resolvePeriod(communityId: string, periodCode?: string) {
    if (periodCode) {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `select id, code, seq, status, afisare_date, due_date
           from period where community_id = $1 and code = $2 limit 1`,
        communityId, periodCode,
      )
      return rows?.[0] ?? null
    }
    return this.latestStatementPeriod(communityId)
  }

  /**
   * CPI (cotă-parte indiviză) per billing entity at period P.
   *
   * CPI is stored as a PeriodMeasure with type_code 'SQM' (the BY_SQM rules are "după cota-parte
   * indiviză", so the SQM measure carries the cotă weight — see importers/community/parse.ts).
   * Measures are not necessarily written every period, so take each unit's most recent value at
   * or before P — that is what "per-period override" means. Units are attached to their billing
   * entity through the temporal membership window.
   *
   * Two forward-fallbacks handle injected history, which predates both the first recorded measure
   * and the first membership window (def.json declares memberships from the current period, while
   * history is injected per-BE for years before it):
   *   - no measure at or before P      → the unit's earliest measure
   *   - no membership covering P       → the unit's earliest membership
   * CPI is a structural property of the building, not a monthly reading, so reporting 0 for
   * historical periods would silently zero the column for years. Both fallbacks only fire when
   * nothing covers P, so a community with real ownership changes is unaffected wherever it has
   * data — but note that before the first recorded membership a unit is attributed to its
   * earliest known billing entity.
   */
  private async cpiByBe(communityId: string, seq: number): Promise<Map<string, number>> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `with latest as (
         select distinct on (pm.scope_id) pm.scope_id as unit_id, pm.value
           from period_measure pm
           join period p on p.id = pm.period_id
          where pm.community_id = $1 and pm.type_code = 'SQM'
            and pm.scope_type = 'UNIT'
          order by pm.scope_id,
                   (p.seq <= $2) desc,                                    -- prefer at-or-before P
                   case when p.seq <= $2 then -p.seq else p.seq end asc    -- newest before, else oldest after
       ),
       mem as (
         select distinct on (bem.unit_id) bem.unit_id, bem.billing_entity_id
           from billing_entity_member bem
           join billing_entity be on be.id = bem.billing_entity_id
          where be.community_id = $1
          order by bem.unit_id,
                   (bem.start_seq <= $2 and (bem.end_seq is null or bem.end_seq >= $2)) desc,
                   bem.start_seq asc
       )
       select mem.billing_entity_id as be_id, sum(latest.value)::float8 as cpi
         from latest
         join mem on mem.unit_id = latest.unit_id
        group by mem.billing_entity_id`,
      communityId, seq,
    )
    return new Map(rows.map((r) => [r.be_id, Number(r.cpi ?? 0)]))
  }

  /** Fund domain key from `Fund.allocation.type`, matched case-insensitively. */
  private domainKeyOf(allocation: any): string {
    const raw = allocation && typeof allocation === 'object' ? (allocation as any).type : null
    const key = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    return FUND_DOMAIN_META.some((d) => d.key === key) ? key : 'other'
  }

  async collectionRate(communityId: string, periodCode?: string, domain?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return emptyReport(null)

    const pSeq = Number(period.seq)
    const wantDomain = domain ? String(domain).trim().toLowerCase() : null

    // One pass over the statement snapshots for every period up to and including P.
    // be_statement is already at (period, billing entity, fund) grain, so this is the raw
    // material for every level of the report — no second aggregation query needed.
    const stmts: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select bs.billing_entity_id            as be_id,
              be.code                          as be_code,
              be.display_name                  as be_display_name,
              be.name                          as be_name,
              be."order"                       as be_order,
              f.code                           as fund_code,
              f.name                           as fund_name,
              f.allocation                     as fund_allocation,
              p.seq                            as seq,
              p.code                           as period_code,
              p.status                         as period_status,
              bs.due_start::float8             as due_start,
              bs.charges::float8               as charges,
              bs.payments::float8              as payments,
              bs.adjustments::float8           as adjustments,
              bs.due_end::float8               as due_end
         from be_statement bs
         join period p         on p.id  = bs.period_id
         join fund f           on f.id  = bs.fund_id
         join billing_entity be on be.id = bs.billing_entity_id
        where bs.community_id = $1 and p.seq <= $2
        order by p.seq asc, be."order" asc, f.code asc`,
      communityId, pSeq,
    )
    if (!stmts.length) return emptyReport(period)

    // Fund catalogue + domain assignment (from the rows we actually have).
    const funds = new Map<string, { code: string; label: string; shortName: string | null; domain: string }>()
    for (const r of stmts) {
      if (funds.has(r.fund_code)) continue
      const alloc: any = r.fund_allocation ?? null
      funds.set(r.fund_code, {
        code: r.fund_code,
        label: r.fund_name || r.fund_code,
        shortName: alloc?.shortName ?? alloc?.altName ?? null,
        domain: this.domainKeyOf(alloc),
      })
    }

    const inScope = (fundCode: string) => !wantDomain || funds.get(fundCode)?.domain === wantDomain
    const scoped = stmts.filter((r) => inScope(r.fund_code))
    if (!scoped.length) return emptyReport(period, wantDomain)

    // ── Per (billing entity, fund) accumulation ────────────────────────────────────────────
    type Cell = {
      beId: string; fundCode: string
      firstSeq: number; lastSeq: number
      opening: number; charges: number; payments: number; adjustments: number; dueEnd: number
    }
    const cells = new Map<string, Cell>()
    for (const r of scoped) {
      const key = `${r.be_id}::${r.fund_code}`
      let c = cells.get(key)
      if (!c) {
        c = {
          beId: r.be_id, fundCode: r.fund_code,
          firstSeq: r.seq, lastSeq: r.seq,
          opening: Number(r.due_start), charges: 0, payments: 0, adjustments: 0, dueEnd: Number(r.due_end),
        }
        cells.set(key, c)
      }
      // Rows arrive in ascending seq, so the first row seen carries the opening balance and the
      // last one the closing balance. A (be, fund) pair that stops before P keeps its final
      // due_end rather than silently reporting 0 outstanding.
      if (r.seq < c.firstSeq) { c.firstSeq = r.seq; c.opening = Number(r.due_start) }
      if (r.seq >= c.lastSeq) { c.lastSeq = r.seq; c.dueEnd = Number(r.due_end) }
      c.charges += Number(r.charges)
      c.payments += Number(r.payments)
      c.adjustments += Number(r.adjustments)
    }

    const metricOf = (c: Cell) => {
      const owed = c.opening + c.charges + c.adjustments
      const paid = c.payments
      // opening/charges/adjustments are surfaced so every level can show what makes up `owed`
      // (owed = opening + charges + adjustments) — charges is the actual billing, distinct from
      // balance re-basings/reconciliations that land in adjustments.
      return { owed, paid, outstanding: c.dueEnd, opening: c.opening, charges: c.charges, adjustments: c.adjustments }
    }

    // ── Roll up ───────────────────────────────────────────────────────────────────────────
    const cpi = await this.cpiByBe(communityId, pSeq)

    const byBe = new Map<string, Acc & { beId: string }>()
    const byFund = new Map<string, Acc & { bes: Set<string> }>()
    const byBeFund = new Map<string, Record<string, ReturnType<typeof metricOf>>>()
    const total = newAcc()

    for (const c of cells.values()) {
      const m = metricOf(c)
      add(total, m)
      add(getOr(byBe, c.beId, () => ({ ...newAcc(), beId: c.beId })), m)
      add(getOr(byFund, c.fundCode, () => ({ ...newAcc(), bes: new Set<string>() })), m)
      byFund.get(c.fundCode)!.bes.add(c.beId)
      const perFund = getOr(byBeFund, c.beId, () => ({} as Record<string, any>))
      perFund[c.fundCode] = m
    }

    // Billing-entity rows.
    const beInfo = new Map<string, any>()
    for (const r of scoped) if (!beInfo.has(r.be_id)) beInfo.set(r.be_id, r)
    const rows = [...byBe.values()]
      .map((a) => {
        const info = beInfo.get(a.beId)
        return {
          beId: a.beId,
          code: info?.be_code ?? null,
          displayName: info?.be_display_name || info?.be_name || info?.be_code || a.beId,
          order: Number(info?.be_order ?? 0),
          cpi: round2(cpi.get(a.beId) ?? 0),
          ...shape(a),
          byFund: Object.fromEntries(
            Object.entries(byBeFund.get(a.beId) ?? {}).map(([code, m]) => [code, shape(m)]),
          ),
        }
      })
      .sort((x, y) => x.order - y.order || String(x.displayName).localeCompare(String(y.displayName)))

    // Funds grouped into domains. CPI at fund/domain level is a union over distinct billing
    // entities, never a sum of per-fund CPI (that would multiply by the number of funds).
    const domainsMap = new Map<string, { acc: Acc; bes: Set<string>; funds: any[] }>()
    for (const [code, f] of funds) {
      if (!inScope(code)) continue
      const a = byFund.get(code)
      if (!a) continue
      const d = getOr(domainsMap, f.domain, () => ({ acc: newAcc(), bes: new Set<string>(), funds: [] as any[] }))
      add(d.acc, a)
      a.bes.forEach((b) => d.bes.add(b))
      d.funds.push({
        code: f.code,
        label: f.label,
        shortName: f.shortName,
        cpi: round2(sumCpi(a.bes, cpi)),
        ...shape(a),
      })
    }
    const domains = [...domainsMap.entries()]
      .map(([key, d]) => {
        const meta = FUND_DOMAIN_META.find((m) => m.key === key)
        return {
          key,
          label: meta?.label ?? key,
          sortOrder: meta?.sortOrder ?? 99,
          cpi: round2(sumCpi(d.bes, cpi)),
          ...shape(d.acc),
          funds: d.funds.sort((a, b) => a.code.localeCompare(b.code)),
        }
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))

    // ── Historical series ─────────────────────────────────────────────────────────────────
    // Cumulative at each period p ≤ P. A (be, fund) pair contributes its opening balance the
    // first period it appears. Unlike the source implementation we can include the most recent
    // period, because due_end is stored rather than inferred from the following month.
    const openingAtSeq = new Map<number, number>()
    for (const c of cells.values()) openingAtSeq.set(c.firstSeq, (openingAtSeq.get(c.firstSeq) ?? 0) + c.opening)

    const perPeriod = new Map<number, { code: string; status: string; charges: number; payments: number; adjustments: number; dueEnd: number }>()
    for (const r of scoped) {
      const e = getOr(perPeriod, r.seq, () => ({ code: r.period_code, status: r.period_status, charges: 0, payments: 0, adjustments: 0, dueEnd: 0 }))
      e.charges += Number(r.charges)
      e.payments += Number(r.payments)
      e.adjustments += Number(r.adjustments)
      e.dueEnd += Number(r.due_end)
    }
    let owedCum = 0, paidCum = 0, openCum = 0, chargesCum = 0, adjCum = 0, prevOwed = 0, prevPaid = 0
    const history = [...perPeriod.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, e]) => {
        const openThis = openingAtSeq.get(seq) ?? 0
        openCum += openThis; chargesCum += e.charges; adjCum += e.adjustments
        owedCum += openThis + e.charges + e.adjustments
        paidCum += e.payments
        const point = {
          periodCode: e.code,
          status: e.status,
          ...shape({ owed: owedCum, paid: paidCum, outstanding: e.dueEnd, opening: openCum, charges: chargesCum, adjustments: adjCum }),
          deltaOwed: round2(owedCum - prevOwed),
          deltaPaid: round2(paidCum - prevPaid),
        }
        prevOwed = owedCum; prevPaid = paidCum
        return point
      })

    const totals = { ...shape(total), cpi: round2(sumCpi(new Set(byBe.keys()), cpi)) }

    return {
      period: {
        code: period.code,
        seq: pSeq,
        status: period.status,
        afisareDate: period.afisare_date ?? null,
        dueDate: period.due_date ?? null,
      },
      domain: wantDomain,
      totals,
      domains,
      rows,
      history,
      fundDomains: FUND_DOMAIN_META,
      // Self-check: the accounting identity must hold at the root. Surfaced rather than thrown
      // so a data problem is visible in the UI instead of blanking the report.
      checks: {
        identityOk: Math.abs(totals.owed - totals.paid - totals.outstanding) < 0.01,
        residual: round2(totals.owed - totals.paid - totals.outstanding),
      },
    }
  }

  /**
   * Risk exposure (#13): classify each billing entity by how old its oldest unpaid arrear is,
   * measured in days overdue from the scadență (due date) through the target period's end. The age
   * comes from the penalty-aging ledger — each OPEN `PenaltyBucket` (one per penalizable due) whose
   * latest `principalRemaining` is still > 0 — so it reflects debt that is actually tracked for
   * aging (the penalty-bearing funds). The max age over a BE's open buckets maps to a tier:
   * 0–30 fără risc · 31–59 penalități · 60–119 sarcină în CF · ≥120 acțiune în instanță.
   *
   * Note: arrears in non-penalty funds carry no per-origination aging, so they don't add buckets
   * here; this is an aging view of penalized debt, a companion to the collection-rate outstanding.
   */
  async riskExposure(communityId: string, periodCode?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    const tiers = RISK_TIER_META
    if (!period) return { period: null, tiers: tiers.map((t) => ({ ...t, count: 0, outstanding: 0 })), rows: [], totals: { count: 0, outstanding: 0 }, riskTiers: tiers }

    const pSeq = Number(period.seq)
    const per = await this.prisma.period.findUnique({ where: { id: period.id }, select: { endDate: true } })
    const endDate = per?.endDate ? new Date(per.endDate) : new Date()

    // latest principal_remaining per bucket at-or-before P, joined to its OPEN bucket's due date.
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `with latest as (
         select distinct on (pbp.bucket_id) pbp.bucket_id, pbp.principal_remaining::float8 as rem
           from penalty_bucket_period pbp
           join period pr on pr.id = pbp.period_id
          where pr.community_id = $1 and pr.seq <= $2
          order by pbp.bucket_id, pr.seq desc
       )
       select pb.billing_entity_id as "beId", pb.due_date as "dueDate", latest.rem as "rem"
         from penalty_bucket pb
         join latest on latest.bucket_id = pb.id
        where pb.community_id = $1 and pb.status = 'OPEN' and latest.rem > 0.005`,
      communityId, pSeq,
    )

    const DAY = 24 * 60 * 60 * 1000
    const daysOverdue = (due: Date | null) => (!due || due >= endDate ? 0 : Math.floor((endDate.getTime() - due.getTime()) / DAY))
    const tierOf = (days: number) => tiers.find((t) => t.maxDays == null || days <= t.maxDays) ?? tiers[tiers.length - 1]

    // reduce each BE to its oldest open arrear + total penalized principal remaining
    const byBe = new Map<string, { days: number; outstanding: number }>()
    for (const r of rows) {
      const d = daysOverdue(r.dueDate ? new Date(r.dueDate) : null)
      const cur = byBe.get(r.beId) ?? { days: 0, outstanding: 0 }
      cur.days = Math.max(cur.days, d)
      cur.outstanding = round2(cur.outstanding + Number(r.rem))
      byBe.set(r.beId, cur)
    }

    const bes = await this.prisma.billingEntity.findMany({ where: { communityId }, select: { id: true, code: true, name: true, displayName: true, order: true } })
    const members = await this.prisma.billingEntityMember.findMany({
      where: { billingEntity: { communityId }, startSeq: { lte: pSeq }, OR: [{ endSeq: null }, { endSeq: { gte: pSeq } }] },
      select: { billingEntityId: true, unit: { select: { code: true } } },
    })
    const unitsByBe = new Map<string, string[]>()
    members.forEach((m) => { if (m.unit) { const a = unitsByBe.get(m.billingEntityId) ?? []; a.push(m.unit.code); unitsByBe.set(m.billingEntityId, a) } })

    const outRows = bes
      .map((be) => {
        const v = byBe.get(be.id)
        if (!v || v.outstanding <= 0.005) return null
        const tier = tierOf(v.days)
        return {
          beCode: be.code, beName: be.name, displayName: be.displayName ?? null, units: unitsByBe.get(be.id) ?? [],
          order: be.order, oldestArrearDays: v.days, tier: tier.key, tierLabel: tier.label, action: tier.action, outstanding: round2(v.outstanding),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => b.oldestArrearDays - a.oldestArrearDays || b.outstanding - a.outstanding)

    const tierSummary = tiers.map((t) => {
      const inTier = outRows.filter((r) => r.tier === t.key)
      return { ...t, count: inTier.length, outstanding: round2(inTier.reduce((s, r) => s + r.outstanding, 0)) }
    })

    return {
      period: { code: period.code, seq: pSeq, status: period.status, endDate },
      tiers: tierSummary,
      rows: outRows,
      totals: { count: outRows.length, outstanding: round2(outRows.reduce((s, r) => s + r.outstanding, 0)) },
      riskTiers: tiers,
    }
  }

  /**
   * Generalized risk exposure (#13 v2): every unit's live restanță, aged and broken down by
   * EVERY fund — not just the penalty-configured ones `riskExposure()` above is limited to —
   * via `PenaltyReconciliationService`, which anchors each breakdown to the live ledger total so
   * it can never drift from what the avizier/debtors views show (see that service's own doc for
   * why `riskExposure()`'s `PenaltyBucket`-only reading could disagree with them).
   */
  async riskExposureDetail(communityId: string, periodCode?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    const tiers = RISK_TIER_META
    if (!period) {
      return {
        period: null, funds: [], units: [], owners: [], tiers: tiers.map((t) => ({ ...t, count: 0, outstanding: 0 })),
        tierTotals: Object.fromEntries(tiers.map((t) => [t.key, 0])),
        totals: { count: 0, outstanding: 0 }, riskTiers: tiers, checks: { byFund: [], allOk: true },
      }
    }

    const per = await this.prisma.period.findUnique({ where: { id: period.id }, select: { seq: true, status: true, afisareDate: true, endDate: true } })
    const endDate = per?.afisareDate ? new Date(per.afisareDate) : per?.endDate ? new Date(per.endDate) : new Date()
    const tierOf = (days: number) => tiers.find((t) => t.maxDays == null || days <= t.maxDays) ?? tiers[tiers.length - 1]

    const results = await this.reconciliation.reconcileCommunity(communityId, period.id)
    const fundsSeen = new Map<string, { fundCode: string; hasRateSchedule: boolean }>()
    for (const r of results) fundsSeen.set(r.fundId, { fundCode: r.fundCode, hasRateSchedule: r.hasRateSchedule })
    const fundRows = await this.prisma.fund.findMany({ where: { id: { in: Array.from(fundsSeen.keys()) } }, select: { id: true, code: true, name: true } })
    const fundIdByCode = new Map(fundRows.map((f) => [f.code, f.id]))

    // Same fund order and labels as the avizier itself — its own `groups` array (one entry per
    // fund, admin-configured order via Community.features.avizierConfig.fundOrder/groupOrder,
    // "same names and order as the avizier" per the association's own request) — not a fresh
    // alphabetical sort, which would silently disagree with what the avizier's own columns show.
    const av = await this.finance.avizier(communityId, period.code, 'unit')
    const avizierGroups: any[] = (av as any)?.groups ?? []
    const funds: { fundId: string; fundCode: string; fundName: string; hasRateSchedule: boolean }[] = []
    for (const g of avizierGroups) {
      const fundId = fundIdByCode.get(g.key)
      const seen = fundId ? fundsSeen.get(fundId) : undefined
      if (!fundId || !seen) continue
      funds.push({ fundId, fundCode: g.key, fundName: g.label ?? g.key, hasRateSchedule: seen.hasRateSchedule })
    }
    // Any fund with real restanță that the avizier's own groups didn't surface (e.g. no current
    // charge/category maps to it this period) still needs a column — appended after, alphabetically.
    const placed = new Set(funds.map((f) => f.fundId))
    for (const [fundId, v] of fundsSeen) {
      if (placed.has(fundId)) continue
      const row = fundRows.find((f) => f.id === fundId)
      funds.push({ fundId, fundCode: v.fundCode, fundName: row?.name ?? v.fundCode, hasRateSchedule: v.hasRateSchedule })
    }

    // Per-fund age = the PRINCIPAL-weighted average age of that fund's slices, per the association's
    // own convention — not the oldest slice's age, which would let one old-but-tiny sliver of debt
    // outrank a unit whose real weight is mostly recent. A slice not yet past its own grace period
    // contributes ageDays=0 (see reconcileUnitFund), correctly pulling the average down, not up.
    const weightedAge = (slices: { principal: number; ageDays: number }[]) => {
      const totalP = slices.reduce((s, x) => s + x.principal, 0)
      if (totalP <= 0.005) return 0
      return round2(slices.reduce((s, x) => s + x.principal * x.ageDays, 0) / totalP)
    }

    const byUnit = new Map<string, { unitId: string; unitCode: string; byFund: Record<string, any> }>()
    for (const r of results) {
      const entry = byUnit.get(r.unitId) ?? { unitId: r.unitId, unitCode: r.unitCode, byFund: {} }
      const avgDays = weightedAge(r.slices)
      const tier = tierOf(avgDays)
      entry.byFund[r.fundCode] = {
        liveTotal: r.liveTotal, anchorTrusted: r.anchorTrusted, weightedAgeDays: avgDays,
        tier: tier.key, tierLabel: tier.label, penaltyProjected: round2(r.slices.reduce((s, x) => s + x.penaltyProjected, 0)),
        slices: r.slices.map((s) => ({
          originKey: s.originKey, originPeriodCode: s.originPeriodCode, dueDate: s.dueDate, firstPenalDay: s.firstPenalDay,
          principal: s.principal, ageDays: s.ageDays, ratePerDayPct: s.ratePerDayPct, penaltyProjected: s.penaltyProjected,
        })),
      }
      byUnit.set(r.unitId, entry)
    }

    // Every ACTIVE unit in the community, not just the ones `byUnit` happens to carry a
    // reconciled balance for — a unit sitting at exactly zero on every fund this period (fully
    // paid, nothing charged) never gets a `results` row (see reconcileCommunity), so `byUnit`
    // alone silently under-counts the community (found 2026-09: Kralik/2026-06 showed 30 units
    // here against the avizier's own 31 — Ap 4 (III), fully settled that period, missing
    // entirely). Also carries Unit.order — the association's own configured display order
    // (synced from data/<COMM>/def.json's structure[].order — same column the avizier's own
    // "Unitate" mode already sorts by), threaded through so the frontend can default to it too.
    const allUnitRows = await this.prisma.unit.findMany({ where: { communityId }, select: { id: true, code: true, order: true } })
    const beByUnit = await this.prisma.billingEntityMember.findMany({
      where: { unitId: { in: allUnitRows.map((u) => u.id) }, startSeq: { lte: per?.seq ?? 0 }, OR: [{ endSeq: null }, { endSeq: { gte: per?.seq ?? 0 } }] },
      select: { unitId: true, billingEntity: { select: { code: true, name: true } } },
    })
    const beByUnitId = new Map(beByUnit.map((m) => [m.unitId, m.billingEntity]))
    const activeUnitById = new Map(allUnitRows.map((u) => [u.id, u]))
    const activeUnitIds = new Set(beByUnit.map((m) => m.unitId))

    const units = Array.from(byUnit.values())
      .map((u) => {
        const outstanding = round2(Object.values(u.byFund).reduce((s: number, f: any) => s + f.liveTotal, 0))
        const allSlices = Object.values(u.byFund).flatMap((f: any) => f.slices)
        return {
          unitId: u.unitId, unitCode: u.unitCode,
          beCode: beByUnitId.get(u.unitId)?.code ?? null, beName: beByUnitId.get(u.unitId)?.name ?? null,
          byFund: u.byFund, outstanding,
          weightedAgeDays: weightedAge(allSlices),
          order: activeUnitById.get(u.unitId)?.order ?? 0,
        }
      })
    for (const unitId of activeUnitIds) {
      if (byUnit.has(unitId)) continue
      const be = beByUnitId.get(unitId)
      const unitRow = activeUnitById.get(unitId)
      units.push({
        unitId, unitCode: unitRow?.code ?? '',
        beCode: be?.code ?? null, beName: be?.name ?? null,
        byFund: {}, outstanding: 0, weightedAgeDays: 0,
        order: unitRow?.order ?? 0,
      })
    }
    units.sort((a, b) => b.weightedAgeDays - a.weightedAgeDays || b.outstanding - a.outstanding)

    // A fund cell only ever gets a real tier when it's an actual debt (liveTotal > 0) — a unit
    // that's purely in credit still gets a byFund entry (see reconcileCommunity's own doc) so its
    // net balance counts toward the grand total, but tierOf(0) on its empty slice list must not
    // count it as a "Fără risc" debtor, which would understate that tier's own outstanding sum.
    const tierSummary = tiers.map((t) => {
      const inTier = units.filter((u) => Object.values(u.byFund).some((f: any) => f.tier === t.key && f.liveTotal > 0.005))
      return { ...t, count: inTier.length, outstanding: round2(inTier.reduce((s, u) => s + u.outstanding, 0)) }
    })

    // True partition of the community's restanțe by risk tier (unlike tierSummary above, which
    // sums a unit's FULL outstanding into every tier it touches and so can double-count a unit
    // across tiers) — every slice's own principal, classified by its own age, counted exactly
    // once. Powers the avizier's "sume pe risc" / "minim de plată" detail: e.g. the minimum
    // payment to avoid court action is tierTotals.court alone; to avoid a CF lien,
    // tierTotals.cf + tierTotals.court; to avoid penalties accruing further,
    // tierTotals.penalty + tierTotals.cf + tierTotals.court. A credit (negative liveTotal) unit
    // contributes no slices at all (nothing "at risk"), so this sums to the community's total
    // DEBT, not the signed net total shown elsewhere.
    const tierTotals: Record<string, number> = Object.fromEntries(tiers.map((t) => [t.key, 0]))
    for (const r of results) {
      for (const s of r.slices) {
        if (s.principal <= 0.005) continue
        const tier = tierOf(s.ageDays)
        tierTotals[tier.key] = round2(tierTotals[tier.key] + s.principal)
      }
    }

    // Identity check (mirrors collection-rate's own checks.identityOk/residual): this methodology's
    // per-fund total MUST equal the avizier's own restanță for that fund, at the SAME grain the
    // avizier itself uses in "Unitate" view — each unit's own signed (dueStart−payments) for a
    // multi-unit BE (be_unit_statement), the BE's own signed (dueStart−payments) for a
    // single-unit BE (be_statement; the two coincide there by construction). dueStart−payments,
    // not dueEnd, because that is the avizier's own named "Restanțe" figure (see `avizier()`'s
    // `soldFundRows` comment: "Restanțe_shown = dueStart − payments, NOT clamped at zero") — dueEnd
    // additionally folds in the period's own fresh charge, which is not yet due and so isn't
    // restanță. Signed (not clamped to zero) because the avizier's own grand total nets credits
    // against debts the same way (its `totals.soldByFund` sums every row's raw signed value) — a
    // clamped comparison here would mismatch that total as soon as any unit is in credit. A
    // nonzero residual beyond a cent or two means a real bug (wrong anchor, a missed candidate, a
    // mis-split) — comparing at BE grain instead would falsely flag a multi-unit BE whose own
    // units carry opposite signs (Primărie TM UAT: SAD 4/A and 4/C in credit, 4/B owing) as a
    // mismatch, when the reconciliation is right and a BE-level net would just be hiding a real
    // per-unit debt behind a sibling's credit.
    //
    // Units are looked up by their CURRENT active membership, never by `be_unit_statement`'s own
    // stored `billing_entity_id` — that column is only refreshed when a unit's own ledger detail
    // moves, so after an ownership transfer it can still name the FORMER owner (found 2026-09-14:
    // Ap 2/2's be_unit_statement row still pointed at Gampe Francisc, whose membership had already
    // ended — since he then has zero ACTIVE units, he isn't "single-unit" either, so his stale row
    // was being summed a second time on top of the new owner's own be_statement total). Mirrors
    // exactly how `reconcileCommunity` builds its own candidate pairs, so this check independently
    // re-derives the same units it did rather than trusting a column known to go stale.
    const activeMembers = await this.prisma.billingEntityMember.findMany({
      where: { billingEntity: { communityId }, startSeq: { lte: per?.seq ?? 0 }, OR: [{ endSeq: null }, { endSeq: { gte: per?.seq ?? 0 } }] },
      select: { billingEntityId: true, unitId: true },
    })
    const unitsByBe = new Map<string, string[]>()
    for (const m of activeMembers) unitsByBe.set(m.billingEntityId, [...(unitsByBe.get(m.billingEntityId) ?? []), m.unitId])

    const beTotals: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select f.code as "fundCode", bs.billing_entity_id as "beId", (bs.due_start - bs.payments)::float8 as total
         from be_statement bs join fund f on f.id = bs.fund_id
        where bs.community_id = $1 and bs.period_id = $2`,
      communityId, period.id,
    )
    const unitTotalsRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select f.code as "fundCode", bus.unit_id as "unitId", (bus.due_start - bus.payments)::float8 as total
         from be_unit_statement bus join fund f on f.id = bus.fund_id
        where bus.community_id = $1 and bus.period_id = $2`,
      communityId, period.id,
    )
    const unitTotalByKey = new Map(unitTotalsRows.map((r) => [`${r.unitId}::${r.fundCode}`, Number(r.total)]))

    // Trust gate at the SAME grain `resolveLiveTotal` uses — dueEnd summed across EVERY fund for
    // the whole BE, not per fund (matches `avizier()`'s own `unitDueEndSumByBe`/`stmt`). Computing
    // it per-fund here (tried 2026-09-16, reverted the same day) let this check disagree with
    // `resolveLiveTotal`'s own BE-wide decision — trusting a fund's split here that the actual
    // reconciliation didn't (or the reverse) — which shows up as offsetting per-fund residuals
    // even while the grand total still balances (the reconciliation was right all along).
    const beDueEndRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select billing_entity_id as "beId", sum(due_end)::float8 as total
         from be_statement where community_id = $1 and period_id = $2 group by billing_entity_id`,
      communityId, period.id,
    )
    const beDueEndByBe = new Map(beDueEndRows.map((r) => [r.beId, Number(r.total)]))
    const unitDueEndRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select unit_id as "unitId", billing_entity_id as "beId", sum(due_end)::float8 as total
         from be_unit_statement where community_id = $1 and period_id = $2 group by unit_id, billing_entity_id`,
      communityId, period.id,
    )
    const unitDueEndSumByBe = new Map<string, number>()
    for (const r of unitDueEndRows) unitDueEndSumByBe.set(r.beId, (unitDueEndSumByBe.get(r.beId) ?? 0) + Number(r.total))
    const beTrusted = new Set<string>()
    for (const [beId, sum] of unitDueEndSumByBe) {
      if (isUnitSplitTrusted(sum, beDueEndByBe.get(beId) ?? 0)) beTrusted.add(beId)
    }

    const avizierByFund = new Map<string, number>()
    for (const r of beTotals) {
      const units = unitsByBe.get(r.beId) ?? []
      // No currently active unit at all (e.g. a departed owner whose membership already ended) —
      // reconcileCommunity's own candidate generation produces zero pairs for such a BE too (it
      // only expands a BE's *active* units), so the check must skip it the same way rather than
      // count a balance neither side can attribute to a live unit.
      if (units.length === 0) continue
      if (units.length === 1 || beTrusted.has(r.beId)) {
        const total = units.length === 1
          ? Number(r.total)
          : units.reduce((s, unitId) => s + (unitTotalByKey.get(`${unitId}::${r.fundCode}`) ?? 0), 0)
        avizierByFund.set(r.fundCode, round2((avizierByFund.get(r.fundCode) ?? 0) + total))
      }
      // else: untrusted — avizier's own unit-mode view shows zero for these units (see
      // resolveLiveTotal's doc), so this fund contributes nothing here either.
    }
    const reconciledByFund = new Map<string, number>()
    for (const r of results) reconciledByFund.set(r.fundCode, round2((reconciledByFund.get(r.fundCode) ?? 0) + r.liveTotal))
    // Tolerance wider than one cent: a multi-unit BE's own per-unit split is rounded per unit
    // (both here and in avizier's own unitTotalByKey), so a BE with N trusted multi-unit siblings
    // can legitimately drift up to ~0.5 cent per sibling from the BE-level rounded total — verified
    // 2026-09-16 on Kralik/2026-06 (three trusted multi-unit BEs, 0.01 each, netting to a real but
    // harmless 0.03 RULMENT residual). Real bugs (wrong anchor, a missed candidate) run to whole
    // lei or more, never this close to the per-unit rounding floor.
    const fundChecks = funds.map((f) => {
      const reconciled = round2(reconciledByFund.get(f.fundCode) ?? 0)
      const avizier = round2(avizierByFund.get(f.fundCode) ?? 0)
      return { fundCode: f.fundCode, reconciled, avizier, residual: round2(reconciled - avizier), ok: Math.abs(reconciled - avizier) < 0.05 }
    })

    // "Proprietar" (owner) rows: BE-grain reconciliation (see reconcileBeFund's own doc) — always
    // trustworthy, unlike the per-unit rows above, since summing a BE's OWN units' charge history
    // never needs to answer "how does this split across units". A single-unit BE's owner row and
    // its unit row above carry the identical number by construction (both anchor on the same
    // be_statement total) — nothing to reconcile between the two.
    const ownerResults = await this.reconciliation.reconcileCommunityByOwner(communityId, period.id)
    const byOwner = new Map<string, { beId: string; beCode: string; byFund: Record<string, any> }>()
    for (const r of ownerResults) {
      // reconcileBeFund reuses AgingSlice's unitId/unitCode fields to carry the BE's own id/code.
      const entry = byOwner.get(r.unitId) ?? { beId: r.unitId, beCode: r.unitCode, byFund: {} }
      const avgDays = weightedAge(r.slices)
      const tier = r.liveTotal > 0.005 ? tierOf(avgDays) : null
      entry.byFund[r.fundCode] = {
        liveTotal: r.liveTotal, anchorTrusted: r.anchorTrusted, weightedAgeDays: avgDays,
        tier: tier?.key ?? '', tierLabel: tier?.label ?? '', penaltyProjected: round2(r.slices.reduce((s, x) => s + x.penaltyProjected, 0)),
        slices: r.slices.map((s) => ({
          originKey: s.originKey, originPeriodCode: s.originPeriodCode, dueDate: s.dueDate, firstPenalDay: s.firstPenalDay,
          principal: s.principal, ageDays: s.ageDays, ratePerDayPct: s.ratePerDayPct, penaltyProjected: s.penaltyProjected,
        })),
      }
      byOwner.set(r.unitId, entry)
    }
    // Every ACTIVE billing entity (has at least one active unit — `unitsByBe`, already fetched
    // above), not just the ones `byOwner` carries a reconciled balance for — same "fully settled
    // this period" gap as the unit roster above, and the same Unit-roster fix's `order` counterpart
    // (BillingEntity.order — what avizier's own "Proprietar" mode already sorts by).
    const beMeta = await this.prisma.billingEntity.findMany({ where: { id: { in: Array.from(unitsByBe.keys()) } }, select: { id: true, code: true, name: true, order: true } })
    const beMetaById = new Map(beMeta.map((b) => [b.id, b]))
    const unitCodesByBe = await this.prisma.billingEntityMember.findMany({
      where: { billingEntityId: { in: Array.from(unitsByBe.keys()) }, startSeq: { lte: per?.seq ?? 0 }, OR: [{ endSeq: null }, { endSeq: { gte: per?.seq ?? 0 } }] },
      select: { billingEntityId: true, unit: { select: { code: true } } },
    })
    const unitCodesMap = new Map<string, string[]>()
    for (const m of unitCodesByBe) { if (m.unit) unitCodesMap.set(m.billingEntityId, [...(unitCodesMap.get(m.billingEntityId) ?? []), m.unit.code]) }

    const owners = Array.from(byOwner.values())
      .map((o) => {
        const outstanding = round2(Object.values(o.byFund).reduce((s: number, f: any) => s + f.liveTotal, 0))
        const allSlices = Object.values(o.byFund).flatMap((f: any) => f.slices)
        return {
          beId: o.beId, beCode: o.beCode, beName: beMetaById.get(o.beId)?.name ?? null,
          unitCodes: unitCodesMap.get(o.beId) ?? [],
          byFund: o.byFund, outstanding, weightedAgeDays: weightedAge(allSlices),
          order: beMetaById.get(o.beId)?.order ?? 0,
        }
      })
    for (const beId of unitsByBe.keys()) {
      if (byOwner.has(beId)) continue
      const meta = beMetaById.get(beId)
      owners.push({
        beId, beCode: meta?.code ?? '', beName: meta?.name ?? null,
        unitCodes: unitCodesMap.get(beId) ?? [],
        byFund: {}, outstanding: 0, weightedAgeDays: 0,
        order: meta?.order ?? 0,
      })
    }
    owners.sort((a, b) => b.weightedAgeDays - a.weightedAgeDays || b.outstanding - a.outstanding)

    return {
      period: { code: period.code, seq: per?.seq, status: per?.status, endDate },
      funds,
      units,
      owners,
      tiers: tierSummary,
      tierTotals,
      totals: { count: units.length, outstanding: round2(units.reduce((s, u) => s + u.outstanding, 0)) },
      riskTiers: tiers,
      checks: { byFund: fundChecks, allOk: fundChecks.every((c) => c.ok) },
    }
  }

  /**
   * Admin action: preview (default) or apply a penalty-bucket reconciliation for a community,
   * optionally scoped to one fund/unit. `apply=false` never writes — see
   * `PenaltyReconciliationService.applyReconciliation`'s own doc for exactly what a write does.
   */
  async reconcilePenalties(communityId: string, opts: { periodCode?: string; fundCode?: string; unitCode?: string; apply: boolean }) {
    const period = await this.resolvePeriod(communityId, opts.periodCode)
    if (!period) return { period: null, results: [] }
    const unitId = opts.unitCode
      ? (await this.prisma.unit.findFirst({ where: { communityId, code: opts.unitCode }, select: { id: true } }))?.id
      : undefined
    if (!opts.apply) {
      const results = await this.reconciliation.reconcileCommunity(communityId, period.id, { fundCode: opts.fundCode, unitId })
      return { period: { code: period.code }, applied: false, results }
    }
    const res = await this.reconciliation.applyReconciliation(communityId, period.id, { fundCode: opts.fundCode, unitId })
    return { period: { code: period.code }, applied: true, ...res }
  }
}

type Acc = { owed: number; paid: number; outstanding: number; opening: number; charges: number; adjustments: number }
const newAcc = (): Acc => ({ owed: 0, paid: 0, outstanding: 0, opening: 0, charges: 0, adjustments: 0 })
const add = (a: Acc, b: Acc) => {
  a.owed += b.owed; a.paid += b.paid; a.outstanding += b.outstanding
  a.opening += b.opening; a.charges += b.charges; a.adjustments += b.adjustments
}

function getOr<K, V>(m: Map<K, V>, k: K, make: () => V): V {
  let v = m.get(k)
  if (!v) { v = make(); m.set(k, v) }
  return v
}

/**
 * Round the money and derive the rate from the *summed* amounts (never average child rates).
 *
 * Rounding happens only here, at presentation — every aggregate is accumulated at full precision.
 * be_statement stores unscaled Decimals and allocation leaves sub-cent tails on some rows, so the
 * rounded children of a node can differ from the rounded node by a cent or two. That is deliberate:
 * snapping each row to the cent first would make the columns add up perfectly but would drift the
 * headline outstanding away from the association's real debt (measured at 0.07 RON for Kralik
 * 2026-05), and that total is the number people cross-check against the avizier.
 */
function shape(a: Acc) {
  const owed = round2(a.owed)
  const paid = round2(a.paid)
  const charges = round2(a.charges)
  return {
    owed, paid, outstanding: round2(a.outstanding),
    opening: round2(a.opening), charges, adjustments: round2(a.adjustments),
    // Grad de colectare = Plătit / Facturat (paid over invoiced) — the denominator is the actual
    // billing, NOT `owed` (which also carries opening arrears + adjustments/re-basings).
    ratePct: charges > 0 ? round2((paid / charges) * 100) : null,
  }
}

const sumCpi = (bes: Set<string>, cpi: Map<string, number>) =>
  [...bes].reduce((s, b) => s + (cpi.get(b) ?? 0), 0)

function emptyReport(period: any, domain: string | null = null) {
  return {
    period: period
      ? { code: period.code, seq: Number(period.seq), status: period.status, afisareDate: period.afisare_date ?? null, dueDate: period.due_date ?? null }
      : null,
    domain,
    totals: { owed: 0, paid: 0, outstanding: 0, opening: 0, charges: 0, adjustments: 0, ratePct: null, cpi: 0 },
    domains: [],
    rows: [],
    history: [],
    fundDomains: FUND_DOMAIN_META,
    checks: { identityOk: true, residual: 0 },
  }
}

function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
