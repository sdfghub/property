import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

/**
 * Read-only community finance signals for the admin "Today" home / command center:
 * debtors (receivables), unpaid vendor invoices, fund balance-vs-target, and collection rate.
 * All queries are community-scoped and derive from already-computed ledger/statement rows.
 */
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Latest period that has computed be_statement rows (prefers CLOSED, else the newest prepared). */
  private async latestStatementPeriod(communityId: string): Promise<{ id: string; code: string } | null> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select p.id, p.code
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
        `select id, code from period where community_id=$1 and code=$2 limit 1`,
        communityId, periodCode,
      )
      return rows?.[0] ?? null
    }
    return this.latestStatementPeriod(communityId)
  }

  /**
   * Debtors: per billing entity outstanding for the reference period.
   * The statement snapshot (be_statement.due_end) is only rebuilt at period close, so a receipt
   * recorded in the still-open period would not show up. To reflect it immediately we subtract
   * payments recorded in periods that have NO statement yet (uncommitted — e.g. the open period).
   */
  async receivables(communityId: string, periodCode?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { periodCode: null, totalDebt: 0, debtorCount: 0, topDebtors: [] }
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `with stmt as (
         select bs.billing_entity_id as be_id, sum(bs.due_end) as due_end
           from be_statement bs
          where bs.community_id = $1 and bs.period_id = $2
          group by bs.billing_entity_id
       ),
       uncommitted_pay as (
         select le.billing_entity_id as be_id, sum(le.amount) as paid
           from be_ledger_entry le
          where le.community_id = $1 and le.kind = 'PAYMENT' and le.lane = 'CASH'
            and not exists (select 1 from be_statement bs2 where bs2.period_id = le.period_id)
          group by le.billing_entity_id
       )
       select be.code as "beCode", be.name as "beName",
              (coalesce(stmt.due_end,0) - coalesce(uncommitted_pay.paid,0))::float8 as debt
         from billing_entity be
         left join stmt on stmt.be_id = be.id
         left join uncommitted_pay on uncommitted_pay.be_id = be.id
        where be.community_id = $1
          and (coalesce(stmt.due_end,0) - coalesce(uncommitted_pay.paid,0)) > 0.005
        order by debt desc`,
      communityId, period.id,
    )
    const totalDebt = rows.reduce((s, r) => s + Number(r.debt), 0)
    return {
      periodCode: period.code,
      totalDebt: round2(totalDebt),
      debtorCount: rows.length,
      topDebtors: rows.slice(0, 10).map((r) => ({ ...r, debt: round2(r.debt) })),
    }
  }

  /** Vendor invoices with outstanding balance (gross − applied payments) > 0. */
  async unpaidVendorInvoices(communityId: string) {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select vi.id, vi.number, v.name as vendor, vi.currency,
              vi.issue_date as "issueDate", vi.due_date as "dueDate",
              coalesce(vi.gross,0)::float8 as gross,
              coalesce(sum(vpa.amount),0)::float8 as paid,
              (coalesce(vi.gross,0) - coalesce(sum(vpa.amount),0))::float8 as outstanding
         from vendor_invoice vi
         left join vendor v on v.id = vi.vendor_id
         left join vendor_payment_application vpa on vpa.invoice_id = vi.id
        where vi.community_id = $1
        group by vi.id, vi.number, v.name, vi.currency, vi.issue_date, vi.due_date, vi.gross
        having (coalesce(vi.gross,0) - coalesce(sum(vpa.amount),0)) > 0.005
        order by vi.due_date asc nulls last, outstanding desc`,
      communityId,
    )
    const totalOutstanding = rows.reduce((s, r) => s + Number(r.outstanding), 0)
    return {
      count: rows.length,
      totalOutstanding: round2(totalOutstanding),
      invoices: rows.map((r) => ({ ...r, gross: round2(r.gross), paid: round2(r.paid), outstanding: round2(r.outstanding) })),
    }
  }

  /** Per-fund accrued revenue (all periods) vs the fund's total target + monthly target. */
  async fundsStatus(communityId: string) {
    const funds = await this.prisma.fund.findMany({
      where: { communityId },
      select: { id: true, code: true, name: true, currency: true, totalTarget: true, targetPlan: true, targets: true, allocation: true },
    })
    const accruedRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select fund_id as "fundId", coalesce(sum(amount),0)::float8 as accrued
         from fund_ledger_entry
        where community_id = $1 and kind = 'REVENUE'
        group by fund_id`,
      communityId,
    )
    const accruedByFund = new Map(accruedRows.map((r) => [r.fundId, Number(r.accrued)]))
    return {
      funds: funds.map((f) => {
        const tp: any = f.targetPlan
        const monthly = tp?.perPeriodAmount != null ? Number(tp.perPeriodAmount) : null
        const total = f.totalTarget != null ? Number(f.totalTarget) : null
        const accrued = round2(accruedByFund.get(f.id) ?? 0)
        return {
          code: f.code,
          name: f.name,
          currency: f.currency,
          totalTarget: total,
          monthlyTarget: monthly,
          accrued,
          progressPct: total && total > 0 ? round2((accrued / total) * 100) : null,
          split: (f.allocation as any)?.split ?? (f.allocation as any)?.method ?? null,
        }
      }),
    }
  }

  /**
   * Avizier (listă de întreținere) for a period: per billing entity, the prior balance
   * (sold precedent), this-period charges broken down by category (services / funds / penalties),
   * payments, and total due. Categories are ordered services → funds → penalties.
   */
  async avizier(communityId: string, periodCode?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { period: null, categories: [], rows: [], totals: null }
    const p = await this.prisma.period.findUnique({
      where: { id: period.id },
      select: { code: true, status: true, dueDate: true, seq: true },
    })

    // per-BE running balance from statements
    const stmtRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select billing_entity_id as "beId",
              sum(due_start)::float8 as sold, sum(payments)::float8 as pay,
              sum(adjustments)::float8 as adj, sum(due_end)::float8 as total
         from be_statement where community_id = $1 and period_id = $2
        group by billing_entity_id`,
      communityId, period.id,
    )
    const stmt = new Map(stmtRows.map((r) => [r.beId, r]))

    // penalties from the aging ledger, per (BE, source fund): this period's posted (month) and
    // cumulative-to-date (total). Grouped by the SOURCE fund (pb.fund_id) so each fund's penalties can
    // be shown next to that fund's own column.
    const penMonthRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select pb.billing_entity_id as "beId", sf.code as fund, coalesce(sum(pbp.penalty_posted),0)::float8 as amt
         from penalty_bucket_period pbp join penalty_bucket pb on pb.id = pbp.bucket_id join fund sf on sf.id = pb.fund_id
        where pb.community_id = $1 and pbp.period_id = $2
        group by pb.billing_entity_id, sf.code`,
      communityId, period.id,
    )
    const penTotalRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select pb.billing_entity_id as "beId", sf.code as fund, coalesce(sum(pbp.penalty_posted),0)::float8 as amt
         from penalty_bucket_period pbp join penalty_bucket pb on pb.id = pbp.bucket_id join fund sf on sf.id = pb.fund_id
        where pb.community_id = $1 and pbp.period_seq <= $2
        group by pb.billing_entity_id, sf.code`,
      communityId, p?.seq ?? 0,
    )
    // penaltyByFund: beId -> fundCode -> { month, total }; penaltyFundSet: funds that ever accrued.
    const penaltyByFund = new Map<string, Map<string, { month: number; total: number }>>()
    const penaltyFundSet = new Set<string>()
    const bumpPen = (beId: string, fund: string, key: 'month' | 'total', amt: number) => {
      const m = penaltyByFund.get(beId) ?? new Map<string, { month: number; total: number }>()
      const cur = m.get(fund) ?? { month: 0, total: 0 }
      cur[key] = round2(cur[key] + amt)
      m.set(fund, cur); penaltyByFund.set(beId, m)
      if (amt !== 0) penaltyFundSet.add(fund)
    }
    penMonthRows.forEach((r) => bumpPen(r.beId, r.fund, 'month', Number(r.amt)))
    penTotalRows.forEach((r) => bumpPen(r.beId, r.fund, 'total', Number(r.amt)))
    // per-BE all-funds roll-ups (used for the TOTAL row and back-compat fields)
    const penMonth = new Map<string, number>()
    const penTotal = new Map<string, number>()
    for (const [beId, byFund] of penaltyByFund) {
      let mo = 0, to = 0
      for (const v of byFund.values()) { mo += v.month; to += v.total }
      penMonth.set(beId, round2(mo)); penTotal.set(beId, round2(to))
    }

    // per-BE per-category current charges
    const lineRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select ccl.billing_entity_id as "beId",
              case when cc.source_key like 'penalty:%' then 'PEN:' || split_part(cc.source_key, ':', 2)
                   when cc.source_type = 'FUND' then f.code
                   else coalesce(cc.allocation_snapshot->>'expenseType', 'ALTELE') end as label,
              sum(ccl.amount)::float8 as amt
         from community_charge_line ccl
         join community_charge cc on cc.id = ccl.charge_id
         left join fund f on f.id = cc.fund_id
        where ccl.community_id = $1 and ccl.period_id = $2
        group by ccl.billing_entity_id, label`,
      communityId, period.id,
    )

    const bes = await this.prisma.billingEntity.findMany({
      where: { communityId },
      select: { id: true, code: true, name: true, order: true },
    })
    const members = await this.prisma.billingEntityMember.findMany({
      where: { billingEntity: { communityId }, startSeq: { lte: p?.seq ?? 0 }, OR: [{ endSeq: null }, { endSeq: { gte: p?.seq ?? 0 } }] },
      select: { billingEntityId: true, unit: { select: { code: true } } },
    })
    const unitsByBe = new Map<string, string[]>()
    members.forEach((m) => {
      if (!m.unit) return
      const arr = unitsByBe.get(m.billingEntityId) ?? []
      arr.push(m.unit.code)
      unitsByBe.set(m.billingEntityId, arr)
    })

    const funds = await this.prisma.fund.findMany({ where: { communityId }, select: { code: true } })
    const fundCodes = new Set(funds.map((f) => f.code))
    const rank = (label: string) => (label === 'PENALIZARI' || label.startsWith('PEN:') ? 2 : fundCodes.has(label) ? 1 : 0)

    // charges per BE keyed by category. Penalty (`PEN:<fund>`) amounts stay in the charge map so they
    // count toward the month total, but are NOT registered as categories/columns — penalties are now
    // rendered per fund via penaltyByFund, next to each fund's own column.
    const byBe = new Map<string, Record<string, number>>()
    const catSet = new Set<string>()
    for (const r of lineRows) {
      if (!String(r.label).startsWith('PEN:')) catSet.add(r.label)
      const m = byBe.get(r.beId) ?? {}
      m[r.label] = round2((m[r.label] ?? 0) + Number(r.amt))
      byBe.set(r.beId, m)
    }
    const categories = [...catSet].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))

    // map each category to its owning fund group (services → EXPENSES, contributions → own fund, penalties → PENALIZARI)
    const catFundRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select distinct
              case when cc.source_key like 'penalty:%' then 'PEN:' || split_part(cc.source_key, ':', 2)
                   when cc.source_type = 'FUND' then f.code
                   else coalesce(cc.allocation_snapshot->>'expenseType', 'ALTELE') end as label,
              case when cc.source_key like 'penalty:%' then 'PENALIZARI' else coalesce(f.code, 'ALTELE') end as "fundGroup",
              case when cc.source_key like 'penalty:%' then 'Penalizări' else coalesce(f.name, f.code, 'Altele') end as "fundName"
         from community_charge cc left join fund f on f.id = cc.fund_id
        where cc.community_id = $1 and cc.period_id = $2`,
      communityId, period.id,
    )
    const catToGroup = new Map<string, { key: string; label: string }>()
    catFundRows.forEach((r) => catToGroup.set(r.label, { key: r.fundGroup, label: r.fundName }))
    const groupRank = (k: string) => (k === 'EXPENSES' ? 0 : k === 'PENALIZARI' ? 9 : 1)
    const groupMap = new Map<string, { key: string; label: string; categories: string[] }>()
    for (const c of categories) {
      const g = catToGroup.get(c) || { key: 'ALTELE', label: 'Altele' }
      const entry = groupMap.get(g.key) ?? { key: g.key, label: g.label, categories: [] }
      entry.categories.push(c)
      groupMap.set(g.key, entry)
    }
    const groups = [...groupMap.values()].sort((a, b) => groupRank(a.key) - groupRank(b.key) || a.label.localeCompare(b.label))

    const rows = bes
      .map((be) => {
        const s = stmt.get(be.id)
        const charges = byBe.get(be.id) ?? {}
        const curTotal = round2(Object.values(charges).reduce((x, v) => x + v, 0))
        return {
          beCode: be.code,
          beName: be.name,
          order: be.order,
          units: unitsByBe.get(be.id) ?? [],
          soldPrecedent: round2(Number(s?.sold ?? 0)),
          charges,
          curentTotal: curTotal,
          penaltyMonth: round2(penMonth.get(be.id) ?? 0),
          penaltyTotal: round2(penTotal.get(be.id) ?? 0),
          penaltyByFund: Object.fromEntries(penaltyByFund.get(be.id) ?? []),
          payments: round2(Number(s?.pay ?? 0)),
          adjustments: round2(Number(s?.adj ?? 0)),
          totalDue: round2(Number(s?.total ?? 0)),
        }
      })
      .filter((r) => r.soldPrecedent !== 0 || r.curentTotal !== 0 || r.totalDue !== 0 || r.penaltyTotal !== 0)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const totals = {
      soldPrecedent: round2(rows.reduce((s, r) => s + r.soldPrecedent, 0)),
      curentTotal: round2(rows.reduce((s, r) => s + r.curentTotal, 0)),
      penaltyMonth: round2(rows.reduce((s, r) => s + r.penaltyMonth, 0)),
      penaltyTotal: round2(rows.reduce((s, r) => s + r.penaltyTotal, 0)),
      payments: round2(rows.reduce((s, r) => s + r.payments, 0)),
      adjustments: round2(rows.reduce((s, r) => s + r.adjustments, 0)),
      totalDue: round2(rows.reduce((s, r) => s + r.totalDue, 0)),
      byCategory: categories.reduce((acc, c) => {
        acc[c] = round2(rows.reduce((s, r) => s + (r.charges[c] ?? 0), 0))
        return acc
      }, {} as Record<string, number>),
      penaltyByFund: [...penaltyFundSet].reduce((acc, f) => {
        acc[f] = {
          month: round2(rows.reduce((s, r) => s + ((r as any).penaltyByFund?.[f]?.month ?? 0), 0)),
          total: round2(rows.reduce((s, r) => s + ((r as any).penaltyByFund?.[f]?.total ?? 0), 0)),
        }
        return acc
      }, {} as Record<string, { month: number; total: number }>),
    }

    // penaltyFunds: which funds ever accrued penalties (frontend adds month+total columns after each
    // such fund's own column), ordered to match the group order.
    const groupOrder = new Map(groups.map((g, i) => [g.key, i]))
    const penaltyFunds = [...penaltyFundSet].sort((a, b) => (groupOrder.get(a) ?? 99) - (groupOrder.get(b) ?? 99))

    return { period: { code: p?.code, status: p?.status, dueDate: p?.dueDate }, categories, groups, penaltyFunds, rows, totals }
  }

  /**
   * Explain how one avizier cell (billing entity × category) was computed for a period.
   * Reads the allocation detail (`meta.allocation`) that each allocator persisted on the charge
   * line at allocation time — no recomputation. Returns per underlying charge (invoice / fund
   * contribution / penalty) the total, method, and a per-unit formula (basis, share, amount).
   */
  async explainCell(communityId: string, periodCode: string, beCode: string, category: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { parts: [], total: 0 }
    const be = await this.prisma.billingEntity.findFirst({ where: { communityId, code: beCode }, select: { id: true, name: true } })
    if (!be) return { parts: [], total: 0 }

    // this BE's charge lines for the period, with their charge category + persisted allocation meta
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select u.code as unit, ccl.amount::float8 as amt, ccl.meta as meta,
              cc.id as "chargeId", cc.amount::float8 as "chargeTotal", cc.source_key as skey,
              case when cc.source_key like 'penalty:%' then 'PENALIZARI'
                   when cc.source_type = 'FUND' then f.code
                   else coalesce(cc.allocation_snapshot->>'expenseType', 'ALTELE') end as label
         from community_charge_line ccl
         join community_charge cc on cc.id = ccl.charge_id
         left join fund f on f.id = cc.fund_id
         join unit u on u.id = ccl.unit_id
        where ccl.community_id = $1 and ccl.period_id = $2 and ccl.billing_entity_id = $3`,
      communityId, period.id, be.id,
    )
    const mine = rows.filter((r) => r.label === category && Math.abs(r.amt) > 0.0001)

    const fmt = (n: any) => (n == null ? '?' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    const num = (n: any) => (n == null ? '?' : String(Number(n)))
    const methodLabel = (m: string) =>
      m === 'BY_CONSUMPTION' ? 'după consum' :
      m === 'BY_RESIDENTS' ? 'după număr de persoane' :
      m === 'EQUAL' || m === 'equal-fallback' ? 'egal pe unitate' :
      (m === 'BY_SQM' || m === 'EXPLICIT') ? 'după cota-parte indiviză' :
      m === 'PENALTY' ? 'penalizare de întârziere' : (m || '—')

    // group this BE's lines by underlying charge
    const byCharge = new Map<string, any[]>()
    for (const r of mine) {
      const arr = byCharge.get(r.chargeId) ?? []
      arr.push(r)
      byCharge.set(r.chargeId, arr)
    }

    const parts = [...byCharge.values()].map((lines) => {
      const c0 = lines[0]
      const a0 = c0.meta?.allocation || {}
      const method = a0.method || 'UNKNOWN'
      const explLines = lines.map((l) => {
        const a = l.meta?.allocation || {}
        const base = a.base ?? c0.chargeTotal
        let formula: string
        if (method === 'PENALTY') {
          formula = `${num(a.ratePerDayPct)}%/zi pe sold restant ${fmt(a.principal)} → acumulat ${fmt(a.base)}; cotă unitate ${num(a.unitMeasure)}/${num(a.totalMeasure)} = ${fmt(l.amt)}`
        } else if (method === 'BY_CONSUMPTION') {
          formula = `${num(a.unitMeasure)} / ${num(a.totalMeasure)} × ${fmt(base)} = ${fmt(l.amt)}`
        } else if (method === 'BY_RESIDENTS') {
          formula = `${num(a.unitMeasure)} pers. / ${num(a.totalMeasure)} × ${fmt(base)} = ${fmt(l.amt)}`
        } else if (method === 'EQUAL' || method === 'equal-fallback') {
          formula = `${fmt(base)} / ${num(a.totalMeasure)} = ${fmt(l.amt)}`
        } else if (method === 'BY_SQM' || method === 'EXPLICIT') {
          formula = `cotă ${num(a.unitMeasure)} / ${num(a.totalMeasure)} × ${fmt(base)} = ${fmt(l.amt)}`
        } else {
          formula = `${fmt(l.amt)}`
        }
        return { unit: l.unit, amount: round2(l.amt), method, formula }
      })
      return {
        source: category === 'PENALIZARI' ? 'penalty' : c0.skey?.startsWith('offset:') ? 'fund' : 'service',
        label: category === 'PENALIZARI' ? `Penalizări (${c0.meta?.sourceFund || ''})` : category,
        chargeTotal: round2(c0.meta?.allocation?.base ?? c0.chargeTotal),
        method,
        methodLabel: methodLabel(method),
        lines: explLines,
      }
    })
    const total = round2(parts.reduce((s, p) => s + p.lines.reduce((x: number, l: any) => x + l.amount, 0), 0))
    return { category, beCode, beName: be.name, periodCode: period.code, parts, total }
  }

  /**
   * Detailed penalty drilldown for one billing entity, up to a period. Reads the per-bucket aging
   * ledger (`PenaltyBucket` + `PenaltyBucketPeriod`) — one "bucket" per penalizable due (the migrated
   * opening arrears, and each period's charge) — and reconstructs, per due: the principal, its daily
   * rate, the exact penalizable days in each period, the penalty posted that period, the cumulative
   * accrued, and the per-bucket cap. Returns both this month's total and the cumulative total.
   */
  async explainPenalty(communityId: string, periodCode: string, beCode: string, sourceFund?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { buckets: [], monthTotal: 0, grandTotal: 0 }
    const p = await this.prisma.period.findUnique({ where: { id: period.id }, select: { code: true, seq: true } })
    const be = await this.prisma.billingEntity.findFirst({ where: { communityId, code: beCode }, select: { id: true, name: true } })
    if (!be || !p) return { buckets: [], monthTotal: 0, grandTotal: 0 }

    const bucketRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select pb.id as "bucketId", pb.origin_key as "originKey", pb.principal_original::float8 as "principalOriginal",
              pb.due_date as "dueDate", pb.first_penal_day as "firstPenalDay", pb.status as "bucketStatus",
              pb.rate_per_day_pct::float8 as "bucketRate",
              sf.code as "sourceFund", sf.name as "sourceFundName", tf.code as "targetFund", sf.allocation as "srcAlloc"
         from penalty_bucket pb
         join fund sf on sf.id = pb.fund_id
         left join fund tf on tf.id = pb.target_fund_id
        where pb.community_id = $1 and pb.billing_entity_id = $2
          and ($3::text is null or sf.code = $3)
        order by pb.created_at asc, pb.first_penal_day asc`,
      communityId, be.id, sourceFund ?? null,
    )
    const periodRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select pbp.bucket_id as "bucketId", pr.code as "periodCode", pr.seq as "seq",
              pr.start_date as "startDate", pr.end_date as "endDate",
              pbp.principal_remaining::float8 as "principalRemaining",
              pbp.penalty_accrued::float8 as "penaltyAccrued", pbp.penalty_posted::float8 as "penaltyPosted", pbp.status as status
         from penalty_bucket_period pbp
         join penalty_bucket pb on pb.id = pbp.bucket_id
         join period pr on pr.id = pbp.period_id
        where pb.community_id = $1 and pb.billing_entity_id = $2 and pr.seq <= $3
        order by pbp.bucket_id, pr.seq`,
      communityId, be.id, p.seq,
    )
    const periodsByBucket = new Map<string, any[]>()
    for (const r of periodRows) {
      const arr = periodsByBucket.get(r.bucketId) ?? []
      arr.push(r)
      periodsByBucket.set(r.bucketId, arr)
    }

    const DAY = 24 * 60 * 60 * 1000
    const countDays = (from: Date, to: Date) => (from > to ? 0 : Math.floor((to.getTime() - from.getTime()) / DAY) + 1)

    let monthTotal = 0
    let grandTotal = 0
    const buckets = bucketRows.map((b) => {
      // The bucket carries the rate stamped at its creation; only fall back to the fund's current rate
      // for legacy buckets with no stamped rate. (Showing the fund rate made rate-stamped buckets read 0%.)
      const ratePerDayPct = b.bucketRate != null ? Number(b.bucketRate) : Number((b.srcAlloc as any)?.penaltyPerDayPct ?? 0)
      const rate = ratePerDayPct / 100
      const firstPenal = new Date(b.firstPenalDay)
      const due = b.dueDate ? new Date(b.dueDate) : null
      let penalDaysToDate = 0 // cumulative days actually penalized (after grace), across periods
      const hist = (periodsByBucket.get(b.bucketId) ?? []).map((pr) => {
        // Zile: days actually penalized in THIS period (counted from firstPenalDay, i.e. after grace).
        const lo = firstPenal > new Date(pr.startDate) ? firstPenal : new Date(pr.startDate)
        const days = countDays(lo, new Date(pr.endDate))
        penalDaysToDate += days
        // Total zile: total AGE of the debt = days overdue since scadența through this period's end
        // (the grace month included). Falls back to penalized-days when the bucket has no due date.
        const daysToDate = due ? countDays(new Date(due.getTime() + DAY), new Date(pr.endDate)) : penalDaysToDate
        return {
          periodCode: pr.periodCode,
          principalRemaining: round2(pr.principalRemaining),
          days,
          daysToDate,
          penaltyPosted: round2(pr.penaltyPosted),
          penaltyAccrued: round2(pr.penaltyAccrued),
          status: pr.status,
          current: pr.periodCode === p.code,
        }
      })
      const totalDays = hist.length ? hist[hist.length - 1].daysToDate : 0 // total age through latest period
      const cur = hist.find((h) => h.current)
      const last = hist[hist.length - 1]
      const postedThis = cur?.penaltyPosted ?? 0
      const accruedToDate = last?.penaltyAccrued ?? round2(b.principalOriginal && 0)
      monthTotal += postedThis
      grandTotal += accruedToDate
      const isOpening = b.originKey === 'opening'
      // Migrated buckets carry no real "original principal" — they use a 1e9 sentinel to disable the
      // legal cap (the penalty was already accrued in the source system). Flag them so the UI omits the
      // meaningless "Datorie" figure and never claims the cap was reached.
      const uncapped = b.originKey === 'migrated' || Number(b.principalOriginal) >= 1e9
      return {
        label: isOpening
          ? `Restanță reportată (${b.sourceFund})`
          : `Cotă ${b.sourceFund}${b.dueDate ? ` · scadentă ${new Date(b.dueDate).toLocaleDateString('ro-RO')}` : ''}`,
        sourceFund: b.sourceFund,
        targetFund: b.targetFund,
        dueDate: b.dueDate,
        firstPenalDay: b.firstPenalDay,
        ratePerDayPct,
        uncapped,
        principalOriginal: uncapped ? null : round2(b.principalOriginal),
        principalRemaining: round2(cur?.principalRemaining ?? last?.principalRemaining ?? b.principalOriginal),
        penaltyThisPeriod: round2(postedThis),
        penaltyToDate: round2(accruedToDate),
        totalDays,
        capReached: !uncapped && accruedToDate + 0.005 >= Number(b.principalOriginal),
        status: b.bucketStatus,
        history: hist,
      }
    })
      // hide buckets that never accrued anything up to this period; keep creation-date order (SQL)
      .filter((b) => b.penaltyToDate > 0.0001 || b.penaltyThisPeriod > 0.0001)

    return {
      beCode, beName: be.name, periodCode: p.code, sourceFund: sourceFund ?? null,
      monthTotal: round2(monthTotal), grandTotal: round2(grandTotal),
      buckets,
    }
  }

  /**
   * Explain the "sold precedent" (opening balance) of one billing entity for a period:
   * the carried-forward due (be_statement.due_start) broken down per fund.
   */
  async explainSold(communityId: string, periodCode: string, beCode: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { rows: [], total: 0 }
    const be = await this.prisma.billingEntity.findFirst({ where: { communityId, code: beCode }, select: { id: true, name: true } })
    if (!be) return { rows: [], total: 0 }

    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select coalesce(f.code, 'ALTELE') as "fundCode",
              coalesce(f.name, f.code, 'Altele') as "fundName",
              sum(bs.due_start)::float8 as sold
         from be_statement bs left join fund f on f.id = bs.fund_id
        where bs.community_id = $1 and bs.period_id = $2 and bs.billing_entity_id = $3
        group by f.code, f.name
       having abs(sum(bs.due_start)) > 0.0001
        order by coalesce(f.name, f.code)`,
      communityId, period.id, be.id,
    )
    const out = rows.map((r) => ({ fundCode: r.fundCode, fundName: r.fundName, amount: round2(Number(r.sold)) }))
    return { beCode, beName: be.name, periodCode: period.code, rows: out, total: round2(out.reduce((s, r) => s + r.amount, 0)) }
  }

  /**
   * Payment log for one billing entity in a period: the individual owner receipts collected against
   * that period's cycle (from the imported cash register — payment.provider='cash-register',
   * providerMeta.cycleCode = the period code), with date, account, reference, payer and fund split.
   */
  async paymentsLog(communityId: string, periodCode: string, beCode: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { rows: [], total: 0 }
    const be = await this.prisma.billingEntity.findFirst({ where: { communityId, code: beCode }, select: { id: true, name: true } })
    if (!be) return { rows: [], total: 0 }
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select id, ts, amount::float8 as amount, provider_ref as "ref", method, provider_meta as "meta"
         from payment
        where community_id = $1 and billing_entity_id = $3 and provider = 'cash-register'
          and provider_meta->>'cycleCode' = $4
        order by ts, id`,
      communityId, period.id, be.id, period.code,
    )
    const out = rows.map((r) => ({
      date: r.ts, amount: round2(Number(r.amount)), ref: r.ref, method: r.method,
      account: r.meta?.account ?? null, payer: r.meta?.payer ?? null,
      funds: r.meta?.funds ?? null, cycle: r.meta?.cycle ?? null, memo: r.meta?.memo ?? null,
    }))
    return { beCode, beName: be.name, periodCode: period.code, rows: out, total: round2(out.reduce((s, r) => s + r.amount, 0)) }
  }

  /**
   * Explain a billing entity's adjustments for a period: the non-cash balance corrections
   * (be_ledger_entry kind ADJUSTMENT — e.g. penalty forgiveness "scutire-penalizări") per fund.
   */
  async explainAdjustments(communityId: string, periodCode: string, beCode: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { rows: [], total: 0 }
    const be = await this.prisma.billingEntity.findFirst({ where: { communityId, code: beCode }, select: { id: true, name: true } })
    if (!be) return { rows: [], total: 0 }
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select coalesce(f.code, 'ALTELE') as "fundCode", coalesce(f.name, f.code, 'Altele') as "fundName",
              sum(d.amount)::float8 as amount, max(d.meta->>'reason') as reason
         from be_ledger_entry_detail d left join fund f on f.id = d.fund_id
        where d.community_id = $1 and d.period_id = $2 and d.billing_entity_id = $3 and d.kind = 'ADJUSTMENT'
        group by f.code, f.name
       having abs(sum(d.amount)) > 0.0001
        order by coalesce(f.name, f.code)`,
      communityId, period.id, be.id,
    )
    const out = rows.map((r) => ({ fundCode: r.fundCode, fundName: r.fundName, amount: round2(Number(r.amount)), reason: r.reason }))
    return { beCode, beName: be.name, periodCode: period.code, rows: out, total: round2(out.reduce((s, r) => s + r.amount, 0)) }
  }

  /**
   * Manual charge-override audit history for a (BE, fund) in a period: every amendment with its actor,
   * comment, computed value and target. The newest row is the active override (null target = cleared).
   */
  async chargeOverrideHistory(communityId: string, periodCode: string, beCode: string, fundCode = 'PENALIZARI') {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { rows: [], active: null }
    const be = await this.prisma.billingEntity.findFirst({ where: { communityId, code: beCode }, select: { id: true, name: true } })
    const fund = await this.prisma.fund.findFirst({ where: { communityId, code: fundCode }, select: { id: true } })
    if (!be || !fund) return { rows: [], active: null }
    const rows = await this.prisma.chargeOverride.findMany({
      where: { communityId, periodId: period.id, billingEntityId: be.id, fundId: fund.id },
      orderBy: { createdAt: 'desc' },
    })
    const out = rows.map((r) => ({
      at: r.createdAt,
      actor: r.actor,
      comment: r.comment,
      computed: round2(Number(r.computedAmount)),
      override: r.overrideAmount == null ? null : round2(Number(r.overrideAmount)),
    }))
    return { beCode, beName: be.name, fundCode, periodCode: period.code, active: out[0] ?? null, rows: out }
  }

  /** Collection rate for a period: charged (be_statement.charges) vs collected (payments). */
  async collection(communityId: string, periodCode?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { periodCode: null, charged: 0, collected: 0, ratePct: null }
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select coalesce(sum(charges),0)::float8 as charged,
              coalesce(sum(payments),0)::float8 as collected
         from be_statement where community_id = $1 and period_id = $2`,
      communityId, period.id,
    )
    const charged = round2(Number(rows?.[0]?.charged ?? 0))
    const collected = round2(Number(rows?.[0]?.collected ?? 0))
    return {
      periodCode: period.code,
      charged,
      collected,
      ratePct: charged > 0 ? round2((collected / charged) * 100) : null,
    }
  }
}

function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
