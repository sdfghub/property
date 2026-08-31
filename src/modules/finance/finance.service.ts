import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { AVIZIER_FUND_GROUP_META } from '../../common/enums-meta'

// #8 Avizier configurator — per-community display config, persisted under Community.features.avizierConfig.
type AvizierConfig = {
  info: { cpi: boolean; residents: boolean; consumption: boolean }
  defaultView: 'fond' | 'fondStare' | 'stare'
  fundGroupOverrides: Record<string, string> // fund code → avizier super-group key
  fundGroupLabels: Record<string, string>     // super-group key → label override
  groupOrder: string[]                        // explicit super-group display order (keys); unlisted groups sort after, by default rank
  fundOrder: string[]                         // explicit fund display order (codes), within their group; unlisted funds sort after, by default rank
}
const normalizeAvizierConfig = (raw: any): AvizierConfig => {
  const info = raw?.info || {}
  const obj = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  const arr = (v: any) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  return {
    info: { cpi: info.cpi !== false, residents: info.residents !== false, consumption: info.consumption !== false },
    defaultView: raw?.defaultView === 'stare' ? 'stare' : raw?.defaultView === 'fondStare' ? 'fondStare' : 'fond',
    fundGroupOverrides: obj(raw?.fundGroupOverrides),
    fundGroupLabels: obj(raw?.fundGroupLabels),
    groupOrder: arr(raw?.groupOrder),
    fundOrder: arr(raw?.fundOrder),
  }
}

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
   * Debtors: per billing entity ARREARS (restanțe) carried into the reference period — i.e.
   * be_statement.due_start minus this period's payments, the same "Restanțe" figure the avizier's
   * grand-total band shows (finance.service's avizier query: soldPrecedent − payments). This is
   * deliberately NOT due_end (which would also include this period's own fresh charges) — a panel
   * called "debtors/arrears" should match the avizier's Restanțe column, not the full balance.
   * The statement snapshot is only rebuilt at period close, so a receipt recorded in the still-open
   * period would not show up; to reflect it immediately we subtract payments recorded in periods
   * that have NO statement yet (uncommitted — e.g. the open period).
   *
   * totalDebt is the NET sum across every billing entity (credits from BEs in advance offset
   * others' arrears), matching the avizier grand-total band exactly; topDebtors/debtorCount then
   * filter to just the entities actually in arrears, since listing a credit balance in a "debtors"
   * table wouldn't make sense.
   */
  async receivables(communityId: string, periodCode?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { periodCode: null, totalDebt: 0, debtorCount: 0, topDebtors: [], byFund: [] }
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `with stmt as (
         select bs.billing_entity_id as be_id, sum(bs.due_start) as due_start, sum(bs.payments) as payments
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
              (coalesce(stmt.due_start,0) - coalesce(stmt.payments,0) - coalesce(uncommitted_pay.paid,0))::float8 as debt
         from billing_entity be
         left join stmt on stmt.be_id = be.id
         left join uncommitted_pay on uncommitted_pay.be_id = be.id
        where be.community_id = $1
        order by debt desc`,
      communityId, period.id,
    )
    const totalDebt = rows.reduce((s, r) => s + Number(r.debt), 0)
    const debtors = rows.filter((r) => Number(r.debt) > 0.005)

    // Per-fund breakdown for the Dashboard's "Restanțe" card expander — summed directly from
    // be_statement's own (billing entity, fund) rows, not re-derived from the entity-level CTE
    // above, so this is the fund split of `due_start − payments` only; it doesn't carry the
    // small "uncommitted payment" adjustment (a per-entity, not fund-attributable, timing fix),
    // so it may not sum to totalDebt to the cent in edge cases.
    const byFundRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select f.code as "fundCode", f.name as "fundName",
              coalesce(sum(bs.due_start - bs.payments),0)::float8 as amount
         from be_statement bs join fund f on f.id = bs.fund_id
        where bs.community_id = $1 and bs.period_id = $2
        group by f.code, f.name
       having coalesce(sum(bs.due_start - bs.payments),0) <> 0
        order by f.code`,
      communityId, period.id,
    )

    return {
      periodCode: period.code,
      totalDebt: round2(totalDebt),
      debtorCount: debtors.length,
      topDebtors: debtors.slice(0, 10).map((r) => ({ ...r, debt: round2(r.debt) })),
      byFund: byFundRows.map((r) => ({ ...r, amount: round2(Number(r.amount)) })),
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
  /** #8: read the per-community avizier display config (normalized with defaults). */
  async getAvizierConfig(communityId: string): Promise<AvizierConfig> {
    const c = await this.prisma.community.findFirst({
      where: { OR: [{ id: communityId }, { code: communityId }] }, select: { features: true },
    })
    return normalizeAvizierConfig(((c?.features as any) || {}).avizierConfig)
  }

  /** #8: persist the avizier config under Community.features.avizierConfig (merges, other flags survive). */
  async setAvizierConfig(communityId: string, body: any): Promise<AvizierConfig> {
    const c = await this.prisma.community.findFirst({
      where: { OR: [{ id: communityId }, { code: communityId }] }, select: { id: true, features: true },
    })
    if (!c) throw new NotFoundException('Community not found')
    const features = ((c.features as any) || {})
    const next = normalizeAvizierConfig({ ...(features.avizierConfig || {}), ...body })
    await this.prisma.community.update({ where: { id: c.id }, data: { features: { ...features, avizierConfig: next } } })
    return next
  }

  /**
   * #16 Configurator support data: every fund with its DOMAIN-DERIVED default avizier super-group
   * (ignoring any config override — same derivation avizier() falls back to), so the configurator can
   * combine it live with the in-progress (unsaved) fundGroupOverrides to show the effective grouping
   * as the admin edits, without duplicating the domain→group logic on the frontend.
   */
  async avizierConfigContext(communityId: string) {
    const funds = await this.prisma.fund.findMany({ where: { communityId }, select: { code: true, name: true, allocation: true } })
    const fundDomain = new Map<string, string>(
      funds.map((f) => [f.code, String(((f.allocation as any)?.type ?? '')).trim().toLowerCase()]),
    )
    const defaultGroupOf = (code: string) =>
      code === 'EXPENSES' ? 'intretinere'
        : code === 'PENALIZARI' ? 'intretinere'
          : fundDomain.get(code) === 'strategic' ? 'reabilitare'
            : 'operational'
    return {
      funds: funds.map((f) => ({ code: f.code, name: f.name, defaultGroup: defaultGroupOf(f.code) })),
      superGroups: AVIZIER_FUND_GROUP_META,
    }
  }

  /**
   * Real ExpenseType catalog for a community — code, live name, its AllocationRule, and which
   * Fund it settles into via params.fundCode. Backs the "Configurare Servicii" admin UI so it can
   * assign real codes to descriptive domains instead of free text. `synthetic` lists avizier
   * columns with no ExpenseType row behind them (currently only APA_DIF, the water-difference
   * split — see the categoryLabels hardcode in avizier() below) so the UI can show them as
   * non-pickable, auto-computed entries.
   *
   * `splitSteps` surfaces the CURRENTLY ACTIVE leaves of ExpenseType.params.splitTemplate (the
   * real per-unit allocation engine — see allocation.service.ts's processSplits/resolveShares) —
   * each leaf's own `name` is already a human Romanian description (e.g. "Apa rece contorizată",
   * "Diferență citire apă rece") written at import time, so this is read-only, purely descriptive
   * plumbing: no new computation, just exposing what the engine already does. "Active" is decided
   * by the community's representative period's waterDifferenceMethod, the same switch
   * allocation.service.ts itself reads (a leaf with no `mode` is always active).
   */
  async expenseCatalog(communityId: string) {
    const [rows, funds, period] = await Promise.all([
      this.prisma.expenseType.findMany({
        where: { communityId },
        select: { code: true, name: true, ruleId: true, params: true, rule: { select: { method: true, name: true } } },
      }),
      this.prisma.fund.findMany({ where: { communityId }, select: { code: true, name: true, allocation: true } }),
      this.resolvePeriod(communityId),
    ])
    const waterDifferenceMethod = period
      ? (await this.prisma.period.findUnique({ where: { id: period.id }, select: { waterDifferenceMethod: true } }))?.waterDifferenceMethod || 'PROPORTIONAL'
      : 'PROPORTIONAL'
    const fundByCode = new Map(funds.map((f) => [f.code, f]))

    // First pass: parse each type's active split leaves and collect every meter id / measure-type
    // code they reference, so their real human names (Meter.name, MeasureType.name — already
    // stored as friendly Romanian text, e.g. "Contor comunitate - Apa Rece (total branșament)")
    // can be fetched in one batch and used to render an actual formula, not just a leaf's own name.
    const parsed = rows.map((e) => {
      const leaves: any[] = Array.isArray((e.params as any)?.splitTemplate) ? (e.params as any).splitTemplate : []
      const activeLeaves = leaves.filter((n) => !n?.mode || n.mode === waterDifferenceMethod)
      return { row: e, activeLeaves }
    })
    const meterIds = new Set<string>()
    const measureTypeCodes = new Set<string>()
    for (const { activeLeaves } of parsed) {
      for (const n of activeLeaves) {
        if (n?.derivedShare?.totalMeterId) meterIds.add(String(n.derivedShare.totalMeterId))
        if (n?.derivedShare?.partMeterId) meterIds.add(String(n.derivedShare.partMeterId))
        if (n?.allocation?.weightSource) measureTypeCodes.add(String(n.allocation.weightSource))
      }
    }
    const [meters, measureTypes] = await Promise.all([
      meterIds.size ? this.prisma.meter.findMany({ where: { meterId: { in: [...meterIds] } }, select: { meterId: true, name: true, scopeType: true, scopeCode: true, typeCode: true } }) : [],
      measureTypeCodes.size ? this.prisma.measureType.findMany({ where: { code: { in: [...measureTypeCodes] } }, select: { code: true, name: true, unit: true } }) : [],
    ])
    const meterName = (id?: string) => (id && meters.find((m) => m.meterId === id)?.name) || id || ''
    const measureTypeName = (code?: string) => (code && measureTypes.find((m) => m.code === code)?.name) || code || ''
    const measureTypeUnit = (code?: string) => (code && measureTypes.find((m) => m.code === code)?.unit) || null

    // Live reading for each referenced COMMUNITY-scope meter, at the representative period (see
    // resolvePeriod above) — so the difference explanation can show real numbers (branch reading,
    // Σ unit readings, residual), not just the formula. Meter → PeriodMeasure isn't a direct FK;
    // a meter's own (scopeType, typeCode) is what PeriodMeasure is actually keyed by.
    const communityMeters = meters.filter((m) => m.scopeType === 'COMMUNITY')
    const meterReadings = period && communityMeters.length
      ? await this.prisma.periodMeasure.findMany({
          where: { communityId, periodId: period.id, scopeType: 'COMMUNITY', typeCode: { in: communityMeters.map((m) => m.typeCode) } },
          select: { typeCode: true, value: true },
        })
      : []
    const meterValue = (id?: string) => {
      const m = id ? communityMeters.find((cm) => cm.meterId === id) : undefined
      const v = m ? meterReadings.find((r) => r.typeCode === m.typeCode)?.value : undefined
      return v == null ? null : Number(v)
    }

    const expenseTypes = parsed
      .map(({ row: e, activeLeaves }) => {
        const fundCode = (e.params as any)?.fundCode ?? null
        const fund = fundCode ? fundByCode.get(fundCode) : undefined
        const splitSteps = activeLeaves.filter((n) => n?.name).map((n) => {
          const weightLabel = measureTypeName(n?.allocation?.weightSource)
          // A "residual"-meter leaf is the difference portion of this split (see template.service.ts's
          // recomputeAggregationsAndDerived: residual = branch meter − Σ unit meters).
          const isDifference = /RESIDUAL/i.test(String(n?.derivedShare?.partMeterId ?? ''))
          const formula = n?.derivedShare
            ? `Parte din sumă: ${meterName(n.derivedShare.partMeterId)} din ${meterName(n.derivedShare.totalMeterId)}. Se împarte pe unități proporțional cu consumul propriu de ${weightLabel}.`
            : weightLabel ? `Se împarte pe unități proporțional cu consumul propriu de ${weightLabel}.` : ''
          return { id: String(n.id ?? n.name), name: String(n.name), isDifference, formula }
        })
        return {
          code: e.code,
          name: e.name,
          ruleId: e.ruleId,
          rule: { method: e.rule.method, name: e.rule.name },
          fundCode: fund?.code ?? fundCode ?? null,
          fundName: fund?.name ?? null,
          fundDomain: fund ? String(((fund.allocation as any)?.type ?? '')).trim().toLowerCase() || null : null,
          splitSteps,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    const anchor =
      expenseTypes.find((e) => e.code === 'APA_RECE')?.code ??
      expenseTypes.find((e) => e.code === 'CANALIZARE')?.code ??
      null
    const contributingCodes = expenseTypes.filter((e) => e.splitSteps.some((s) => s.isDifference)).map((e) => e.code)

    // Build the synthetic difference column's own formula from the anchor type's two matching
    // leaves (the "contorizat" and "diferență" siblings share the same derivedShare.totalMeterId).
    let syntheticFormula = ''
    let syntheticReading: { totalValue: number | null; meteredValue: number | null; residualValue: number | null; unit: string | null } | null = null
    const anchorLeaves = anchor ? parsed.find(({ row }) => row.code === anchor)?.activeLeaves ?? [] : []
    const diffLeaf = anchorLeaves.find((n) => /RESIDUAL/i.test(String(n?.derivedShare?.partMeterId ?? '')))
    const meteredLeaf = anchorLeaves.find((n) => n?.derivedShare && n.derivedShare.totalMeterId === diffLeaf?.derivedShare?.totalMeterId && n !== diffLeaf)
    if (diffLeaf?.derivedShare) {
      syntheticFormula = `Diferență = ${meterName(diffLeaf.derivedShare.totalMeterId)} − ${meterName(meteredLeaf?.derivedShare?.partMeterId)} (înregistrată ca ${meterName(diffLeaf.derivedShare.partMeterId)}), redistribuită pe unități proporțional cu consumul propriu.`
      syntheticReading = {
        totalValue: meterValue(diffLeaf.derivedShare.totalMeterId),
        meteredValue: meterValue(meteredLeaf?.derivedShare?.partMeterId),
        residualValue: meterValue(diffLeaf.derivedShare.partMeterId),
        unit: measureTypeUnit(diffLeaf?.allocation?.weightSource) ?? 'm3',
      }
    }
    const synthetic = anchor
      ? [{ code: 'APA_DIF', label: 'Apă - diferență', anchorCode: anchor, contributingCodes, formula: syntheticFormula, reading: syntheticReading }]
      : []
    return { expenseTypes, synthetic, period: period ? { code: period.code } : null }
  }

  /**
   * Real ExpenseType.code display order, as chosen by the admin in "Configurare Servicii"
   * (Community.features.associationInfo.serviceConfig.domains[].serviceCodes — see
   * community.service.ts). Flattens domain order + intra-domain order into a single rank map,
   * inserting each synthetic column (e.g. APA_DIF) right after the real code it's computed from.
   * Used by avizier()'s category sort so the report's column order matches the config page.
   */
  private async serviceOrderIndex(communityId: string): Promise<Map<string, number>> {
    const [c, catalog] = await Promise.all([
      this.prisma.community.findFirst({ where: { OR: [{ id: communityId }, { code: communityId }] }, select: { features: true } }),
      this.expenseCatalog(communityId),
    ])
    const domains = (c?.features as any)?.associationInfo?.serviceConfig?.domains
    const order: string[] = []
    if (Array.isArray(domains)) {
      for (const dom of domains) {
        const codes = Array.isArray(dom?.serviceCodes) ? dom.serviceCodes : []
        for (const code of codes) {
          if (typeof code !== 'string') continue
          order.push(code)
          for (const s of catalog.synthetic) if (s.anchorCode === code) order.push(s.code)
        }
      }
    }
    return new Map(order.map((code, i) => [code, i]))
  }

  async avizier(communityId: string, periodCode?: string, groupBy?: 'entity' | 'unit' | 'group') {
    const mode: 'entity' | 'unit' | 'group' = groupBy === 'unit' || groupBy === 'group' ? groupBy : 'entity'
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { period: null, categories: [], rows: [], totals: null }
    const cfg = await this.getAvizierConfig(communityId)
    const serviceOrder = await this.serviceOrderIndex(communityId)
    const p = await this.prisma.period.findUnique({
      where: { id: period.id },
      select: { code: true, status: true, dueDate: true, afisareDate: true, seq: true },
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

    // Manual penalty overrides live as two ADJUSTMENT legs (CHG_OVR_*) on the penalty fund. For display
    // we fold their net (override − computed) INTO the penalty figure (so the avizier shows the approved
    // penalty, not the gross) and OUT of the adjustments column (so it isn't double-counted). The ledger
    // keeps both legs for the audit trail; totalDue (from be_statement) is already net either way.
    const ovrRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select l.billing_entity_id as "beId", coalesce(sum(l.amount),0)::float8 as delta
         from be_ledger_entry l join fund f on f.id = l.fund_id
        where l.community_id = $1 and l.period_id = $2 and l.ref_type in ('CHG_OVR_REV','CHG_OVR_SET') and f.code = 'PENALIZARI'
        group by l.billing_entity_id`,
      communityId, period.id,
    )
    const overrideDelta = new Map<string, number>(ovrRows.map((r) => [r.beId, Number(r.delta)]))

    // per-BE per-fund arrears net of this period's fund-scoped payments (be_statement, grouped by
    // fund) — powers the "per Fond-Stare" view, which pairs each fund's Restanțe with its Curente
    // (raw charges, same as "Per fond") breakdown. Restanțe_shown = dueStart − payments, NOT clamped
    // at zero — an owner who paid more than their opening balance shows a negative (credit) figure
    // rather than a false zero, and Restanțe_shown + Curente(raw) always equals the fund's dueEnd.
    const soldFundRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select bs.billing_entity_id as "beId", coalesce(f.code, 'ALTELE') as "fundCode",
              sum(bs.due_start)::float8 as sold, sum(bs.payments)::float8 as payments
         from be_statement bs left join fund f on f.id = bs.fund_id
        where bs.community_id = $1 and bs.period_id = $2
        group by bs.billing_entity_id, f.code`,
      communityId, period.id,
    )
    const soldByFundByBe = new Map<string, Record<string, number>>()
    // #18 raw per-fund Încasări (payments), for the new per-fund/TOTAL Încasări column — separate from
    // soldByFund above, which already nets payments into Restanțe.
    const paymentsByFundByBe = new Map<string, Record<string, number>>()
    for (const r of soldFundRows) {
      const m = soldByFundByBe.get(r.beId) ?? {}
      m[r.fundCode] = round2((m[r.fundCode] ?? 0) + Number(r.sold) - Number(r.payments))
      soldByFundByBe.set(r.beId, m)
      const pm = paymentsByFundByBe.get(r.beId) ?? {}
      pm[r.fundCode] = round2((pm[r.fundCode] ?? 0) + Number(r.payments))
      paymentsByFundByBe.set(r.beId, pm)
    }

    // per-BE (and, in the same pass, per-unit — grouping by both costs nothing extra and lets
    // "Unitate"/"Grup unități" mode re-sum these same lines by unit instead of by entity) per-
    // category current charges.
    const lineRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select ccl.billing_entity_id as "beId", ccl.unit_id as "unitId",
              case when cc.source_key like 'penalty:%' then 'PEN:' || split_part(cc.source_key, ':', 2)
                   when ccl.meta->>'splitNodeId' like '%DIFERENTA' then 'APA_DIF'
                   when cc.source_type = 'FUND' then f.code
                   else coalesce(cc.allocation_snapshot->>'expenseType', 'ALTELE') end as label,
              sum(ccl.amount)::float8 as amt
         from community_charge_line ccl
         join community_charge cc on cc.id = ccl.charge_id
         left join fund f on f.id = cc.fund_id
        where ccl.community_id = $1 and ccl.period_id = $2
        group by ccl.billing_entity_id, ccl.unit_id, label`,
      communityId, period.id,
    )

    const bes = await this.prisma.billingEntity.findMany({
      where: { communityId },
      select: { id: true, code: true, name: true, order: true, displayName: true, primaryOwnerName: true },
    })
    const members = await this.prisma.billingEntityMember.findMany({
      where: { billingEntity: { communityId }, startSeq: { lte: p?.seq ?? 0 }, OR: [{ endSeq: null }, { endSeq: { gte: p?.seq ?? 0 } }] },
      select: { billingEntityId: true, unit: { select: { id: true, code: true } } },
    })
    const unitsByBe = new Map<string, string[]>()
    const beIdByUnitId = new Map<string, string>()
    members.forEach((m) => {
      if (!m.unit) return
      const arr = unitsByBe.get(m.billingEntityId) ?? []
      arr.push(m.unit.code)
      unitsByBe.set(m.billingEntityId, arr)
      beIdByUnitId.set(m.unit.id, m.billingEntityId)
    })

    // Per-unit identity + owner/contact resolution ("Unitate"/"Grup unități" modes) — built
    // unconditionally since it's cheap, and keeps this method's shape simple. Contact is just the
    // owning BillingEntity's own primaryOwnerName (or its first name) — no separate storage, no
    // query, since owner was never persisted separately from BillingEntity.name.
    const beById = new Map(bes.map((b) => [b.id, b]))
    const firstNameOf = (name: string) => name.split(',')[0].trim()
    // Name/displayName are traceable through periods (BillingEntityNameHistory) — a rename only
    // rewrites reports from its effective period forward, so this period's own view resolves
    // against whichever history row (if any) was open at this period's seq, falling back to the
    // entity's current name/displayName when it was never renamed.
    const nameHistoryRows = await this.prisma.billingEntityNameHistory.findMany({
      where: { billingEntity: { communityId } },
      select: { billingEntityId: true, name: true, displayName: true, startSeq: true, endSeq: true },
    })
    const nameHistoryByBe = new Map<string, typeof nameHistoryRows>()
    for (const h of nameHistoryRows) {
      const arr = nameHistoryByBe.get(h.billingEntityId) ?? []
      arr.push(h)
      nameHistoryByBe.set(h.billingEntityId, arr)
    }
    const aviSeq = p?.seq ?? 0
    const resolveBeName = (be: { id: string; name: string; displayName: string | null }): { name: string; displayName: string | null } => {
      const hist = nameHistoryByBe.get(be.id)
      const row = hist?.find((h) => h.startSeq <= aviSeq && (h.endSeq == null || h.endSeq >= aviSeq))
      return row ? { name: row.name, displayName: row.displayName } : { name: be.name, displayName: be.displayName }
    }
    const allUnits = mode === 'entity' ? [] : await this.prisma.unit.findMany({
      where: { communityId },
      select: { id: true, code: true, name: true, type: true, floorNumber: true, staircase: true },
    })
    const unitById = new Map(allUnits.map((u) => [u.id, u]))
    const contactForUnit = (unitId: string): string | null => {
      const beId = beIdByUnitId.get(unitId)
      const be = beId ? beById.get(beId) : undefined
      return be ? (be.primaryOwnerName || firstNameOf(resolveBeName(be).name)) : null
    }

    // Physical-group (PHYS_ UnitGroup) resolution, period-correct, private groups only — the
    // building's own common/technical spaces never carry CPI or charges, excluded the same way
    // the Units/Persoane pages already exclude "Gr Spatii Comune".
    const groupIdByUnitId = new Map<string, string>()
    const groupMetaById = new Map<string, { id: string; name: string }>()
    if (mode === 'group') {
      const groupMembers = await this.prisma.unitGroupMember.findMany({
        where: {
          group: { communityId, code: { startsWith: 'PHYS_' } },
          startSeq: { lte: p?.seq ?? 0 },
          OR: [{ endSeq: null }, { endSeq: { gte: p?.seq ?? 0 } }],
        },
        select: { unitId: true, group: { select: { id: true, name: true } } },
      })
      const BILLABLE_TYPES = new Set(['apartament', 'sad', 'comercial'])
      const unitsByGroupId = new Map<string, string[]>()
      for (const gm of groupMembers) {
        groupIdByUnitId.set(gm.unitId, gm.group.id)
        groupMetaById.set(gm.group.id, gm.group)
        const arr = unitsByGroupId.get(gm.group.id) ?? []
        arr.push(gm.unitId)
        unitsByGroupId.set(gm.group.id, arr)
      }
      for (const [groupId, unitIds] of unitsByGroupId) {
        const isComune = unitIds.every((uid) => {
          const t = (unitById.get(uid)?.type || '').toLowerCase()
          return !BILLABLE_TYPES.has(t) && t !== 'boxa'
        })
        if (isComune) {
          for (const uid of unitIds) groupIdByUnitId.delete(uid)
          groupMetaById.delete(groupId)
        }
      }
    }

    const funds = await this.prisma.fund.findMany({ where: { communityId }, select: { code: true, name: true, allocation: true } })
    const fundCodes = new Set(funds.map((f) => f.code))
    // Fund domain (from allocation.type) drives the coarse avizier grouping (#2). See AVIZIER_FUND_GROUP_META.
    const fundDomain = new Map<string, string>(
      funds.map((f) => [f.code, String(((f.allocation as any)?.type ?? '')).trim().toLowerCase()]),
    )

    // #7 INFO fields per BE: cotă-parte (CPI, from the SQM measure) and residents take the latest
    // value at-or-before this period (structural attributes); water consumption is THIS period's
    // reading only. Units map to their BE through the temporal membership window (earliest as a
    // forward-fallback, mirroring reports.cpiByBe so injected history isn't zeroed).
    const infoRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `with mem as (
         select distinct on (bem.unit_id) bem.unit_id, bem.billing_entity_id as be_id
           from billing_entity_member bem join billing_entity be on be.id = bem.billing_entity_id
          where be.community_id = $1
          order by bem.unit_id,
                   (bem.start_seq <= $2 and (bem.end_seq is null or bem.end_seq >= $2)) desc,
                   bem.start_seq asc
       ),
       sqm as (
         select distinct on (pm.scope_id) pm.scope_id as unit_id, pm.value
           from period_measure pm join period p on p.id = pm.period_id
          where pm.community_id = $1 and pm.type_code = 'SQM' and pm.scope_type = 'UNIT'
          order by pm.scope_id, (p.seq <= $2) desc, case when p.seq <= $2 then -p.seq else p.seq end asc
       ),
       res as (
         select distinct on (pm.scope_id) pm.scope_id as unit_id, pm.value
           from period_measure pm join period p on p.id = pm.period_id
          where pm.community_id = $1 and pm.type_code = 'RESIDENTS' and pm.scope_type = 'UNIT'
          order by pm.scope_id, (p.seq <= $2) desc, case when p.seq <= $2 then -p.seq else p.seq end asc
       ),
       cons as (
         select pm.scope_id as unit_id, sum(pm.value)::float8 as value
           from period_measure pm
          where pm.community_id = $1 and pm.type_code = 'WATER_COLD' and pm.scope_type = 'UNIT' and pm.period_id = $3
          group by pm.scope_id
       )
       select mem.be_id as "beId", mem.unit_id as "unitId",
              sqm.value::float8 as cpi,
              res.value::float8 as residents,
              cons.value::float8 as consumption
         from mem
         left join sqm on sqm.unit_id = mem.unit_id
         left join res on res.unit_id = mem.unit_id
         left join cons on cons.unit_id = mem.unit_id`,
      communityId, p?.seq ?? 0, period.id,
    )
    const infoByUnit = new Map<string, { cpi: number | null; residents: number | null; consumption: number | null }>(
      infoRows.map((r) => [r.unitId, {
        cpi: r.cpi == null ? null : round2(Number(r.cpi)),
        residents: r.residents == null ? null : Number(r.residents),
        consumption: r.consumption == null ? null : round2(Number(r.consumption)),
      }]),
    )
    const infoByBe = new Map<string, { cpi: number | null; residents: number | null; consumption: number | null }>()
    for (const r of infoRows) {
      const cur = infoByBe.get(r.beId) ?? { cpi: null, residents: null, consumption: null }
      if (r.cpi != null) cur.cpi = round2((cur.cpi ?? 0) + Number(r.cpi))
      if (r.residents != null) cur.residents = (cur.residents ?? 0) + Number(r.residents)
      if (r.consumption != null) cur.consumption = round2((cur.consumption ?? 0) + Number(r.consumption))
      infoByBe.set(r.beId, cur)
    }
    // Column display labels come from the data (expense-type / fund names) — the frontend renders these
    // rather than hardcoding a code→label map. APA_DIF is the synthetic water-difference column.
    const expTypes = await this.prisma.expenseType.findMany({ where: { communityId }, select: { code: true, name: true } })
    const categoryLabels: Record<string, string> = { APA_DIF: 'Apă - diferență' }
    for (const e of expTypes) if (e.name) categoryLabels[e.code] = e.name
    for (const f of funds) if (f.name) categoryLabels[f.code] = f.name
    const rank = (label: string) => (label === 'PENALIZARI' || label.startsWith('PEN:') ? 2 : fundCodes.has(label) ? 1 : 0)

    // charges per BE keyed by category. Penalty (`PEN:<fund>`) amounts stay in the charge map so they
    // count toward the month total, but are NOT registered as categories/columns — penalties are now
    // rendered per fund via penaltyByFund, next to each fund's own column.
    const byBe = new Map<string, Record<string, number>>()
    const byUnit = new Map<string, Record<string, number>>()
    const catSet = new Set<string>()
    for (const r of lineRows) {
      if (!String(r.label).startsWith('PEN:')) catSet.add(r.label)
      const m = byBe.get(r.beId) ?? {}
      m[r.label] = round2((m[r.label] ?? 0) + Number(r.amt))
      byBe.set(r.beId, m)
      const mu = byUnit.get(r.unitId) ?? {}
      mu[r.label] = round2((mu[r.label] ?? 0) + Number(r.amt))
      byUnit.set(r.unitId, mu)
    }
    const categories = [...catSet].sort((a, b) =>
      rank(a) - rank(b) || ((serviceOrder.get(a) ?? 1e6) - (serviceOrder.get(b) ?? 1e6)) || a.localeCompare(b))

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
    // APA_DIF is derived at the line level (the water-difference split), so it isn't in the charge-level
    // catFundRows above — place it in the same group as apa rece (Expenses).
    const waterGrp = catToGroup.get('APA_RECE') ?? catToGroup.get('CANALIZARE')
    if (waterGrp && !catToGroup.has('APA_DIF')) catToGroup.set('APA_DIF', waterGrp)
    const groupRank = (k: string) => (k === 'EXPENSES' ? 0 : k === 'PENALIZARI' ? 9 : 1)
    // #2/#17 coarse avizier bucket for a fund group: services → Întreținere, strategic (reabilitare)
    // funds → Fond Reabilitare, everything else → Fond Operațional. Penalties nest under Întreținere
    // too — they're an accessory of a fund's own arrears, not a domain of their own. Derived from the
    // fund's domain (allocation.type), not per-code hardcoded (except EXPENSES/PENALIZARI, which are
    // fixed community-wide concepts, not amenable to a generic domain lookup).
    const superGroupMeta = new Map(AVIZIER_FUND_GROUP_META.map((g) => [g.key, g]))
    // #8: an admin-set override (config.fundGroupOverrides[fundCode]) wins over the domain-derived bucket.
    const superGroupKeyOf = (groupKey: string) =>
      cfg.fundGroupOverrides[groupKey]
        ?? (groupKey === 'EXPENSES' ? 'intretinere'
          : groupKey === 'PENALIZARI' ? 'intretinere'
            : fundDomain.get(groupKey) === 'strategic' ? 'reabilitare'
              : 'operational')
    const sgLabelOf = (sgKey: string, fallback: string) => cfg.fundGroupLabels[sgKey] ?? superGroupMeta.get(sgKey)?.label ?? fallback
    const groupMap = new Map<string, { key: string; label: string; superGroup: { key: string; label: string }; categories: string[] }>()
    for (const c of categories) {
      const g = catToGroup.get(c) || { key: 'ALTELE', label: 'Altele' }
      const sgKey = superGroupKeyOf(g.key)
      const entry = groupMap.get(g.key)
        ?? { key: g.key, label: g.label, superGroup: { key: sgKey, label: sgLabelOf(sgKey, g.label) }, categories: [] }
      entry.categories.push(c)
      groupMap.set(g.key, entry)
    }
    // Some funds carry arrears but had no current-period charge this cycle (e.g. a Reabilitare fund
    // billed only sporadically) — they'd otherwise have no group/column at all, making their Restanțe
    // invisible to any per-fund view (notably "Per fond-stare", which pairs Restanțe with Curente per
    // fund). Add a zero-category placeholder group for any such fund so its Restanțe still gets shown.
    for (const code of new Set(soldFundRows.map((r) => String(r.fundCode)))) {
      if (groupMap.has(code)) continue
      const fundRow = funds.find((f) => f.code === code)
      const label = code === 'PENALIZARI' ? 'Penalizări' : (fundRow?.name ?? (code === 'ALTELE' ? 'Altele' : code))
      const sgKey = superGroupKeyOf(code)
      groupMap.set(code, { key: code, label, superGroup: { key: sgKey, label: sgLabelOf(sgKey, label) }, categories: [] })
    }
    // #16 explicit admin order (config.groupOrder / config.fundOrder) wins; anything not listed keeps
    // the old default rank but sorts after every explicitly-ordered entry.
    const sgOrderIdx = (k: string) => { const i = cfg.groupOrder.indexOf(k); return i >= 0 ? i : 1000 + (superGroupMeta.get(k)?.sortOrder ?? 5) }
    const fundOrderIdx = (k: string) => { const i = cfg.fundOrder.indexOf(k); return i >= 0 ? i : 1000 + groupRank(k) }
    const groups = [...groupMap.values()].sort((a, b) =>
      sgOrderIdx(a.superGroup.key) - sgOrderIdx(b.superGroup.key)
      || fundOrderIdx(a.key) - fundOrderIdx(b.key)
      || a.label.localeCompare(b.label))

    const entityRows = bes
      .map((be) => {
        const s = stmt.get(be.id)
        const charges = byBe.get(be.id) ?? {}
        const curTotal = round2(Object.values(charges).reduce((x, v) => x + v, 0))
        const delta = overrideDelta.get(be.id) ?? 0 // net (override − computed); folded into penalty display
        const grossMonth = penMonth.get(be.id) ?? 0
        const pbf = penaltyByFund.get(be.id)
        const penByFundOut: Record<string, { month: number; total: number }> = {}
        if (pbf) for (const [f, v] of pbf) {
          const share = delta === 0 ? 0 : grossMonth !== 0 ? v.month / grossMonth : 1 / pbf.size
          penByFundOut[f] = { month: round2(v.month + delta * share), total: round2(v.total + delta * share) }
        }
        const rn = resolveBeName(be)
        return {
          rowKey: be.code,
          beCode: be.code,
          beName: rn.name,
          displayName: rn.displayName ?? null,
          order: be.order,
          units: unitsByBe.get(be.id) ?? [],
          cpi: infoByBe.get(be.id)?.cpi ?? null,
          residents: infoByBe.get(be.id)?.residents ?? null,
          consumption: infoByBe.get(be.id)?.consumption ?? null,
          soldPrecedent: round2(Number(s?.sold ?? 0)),
          soldByFund: soldByFundByBe.get(be.id) ?? {},
          paymentsByFund: paymentsByFundByBe.get(be.id) ?? {},
          charges,
          curentTotal: round2(curTotal + delta),
          penaltyMonth: round2(grossMonth + delta),
          penaltyTotal: round2((penTotal.get(be.id) ?? 0) + delta),
          penaltyByFund: penByFundOut,
          payments: round2(Number(s?.pay ?? 0)),
          adjustments: round2(Number(s?.adj ?? 0) - delta),
          totalDue: round2(Number(s?.total ?? 0)),
          contactMismatch: false,
        }
      })
      .filter((r) => r.soldPrecedent !== 0 || r.curentTotal !== 0 || r.totalDue !== 0 || r.penaltyTotal !== 0)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    // "Unitate" / "Grup unități" rows only ever carry current-period Cheltuieli (community_charge_line
    // already has a real per-unit unitId) — arrears/payments/penalties stay billing-entity concepts
    // (`BeStatement` has zero unit granularity) and are shown as 0 here rather than repeating a BE's
    // aggregate on every one of its units, which would overcount the TOTAL row.
    const zeroFinancials = {
      soldPrecedent: 0,
      soldByFund: {} as Record<string, number>,
      paymentsByFund: {} as Record<string, number>,
      penaltyMonth: 0, penaltyTotal: 0,
      penaltyByFund: {} as Record<string, { month: number; total: number }>,
      payments: 0, adjustments: 0, totalDue: 0,
    }
    const unitRows = mode !== 'unit' ? [] : allUnits
      .map((u) => {
        const charges = byUnit.get(u.id) ?? {}
        const curTotal = round2(Object.values(charges).reduce((x, v) => x + v, 0))
        const beId = beIdByUnitId.get(u.id)
        const be = beId ? beById.get(beId) : undefined
        const contact = contactForUnit(u.id) ?? (be ? (resolveBeName(be).displayName || resolveBeName(be).name) : '')
        return {
          rowKey: u.id,
          beCode: be?.code ?? u.code, beName: contact, displayName: null, order: 0,
          units: [u.code],
          cpi: infoByUnit.get(u.id)?.cpi ?? null,
          residents: infoByUnit.get(u.id)?.residents ?? null,
          consumption: infoByUnit.get(u.id)?.consumption ?? null,
          charges, curentTotal: curTotal, contactMismatch: false,
          ...zeroFinancials,
          _sortFloor: u.floorNumber ?? 999, _sortName: u.name || u.code,
        }
      })
      .filter((r) => r.curentTotal !== 0 || r.cpi != null)
      .sort((a, b) => a._sortFloor - b._sortFloor || a._sortName.localeCompare(b._sortName, 'ro', { numeric: true }))
      .map(({ _sortFloor, _sortName, ...r }) => r)

    const groupRowsAgg = new Map<string, { name: string; unitIds: string[] }>()
    for (const [unitId, groupId] of groupIdByUnitId) {
      const meta = groupMetaById.get(groupId)!
      const g = groupRowsAgg.get(groupId) ?? { name: meta.name, unitIds: [] }
      g.unitIds.push(unitId)
      groupRowsAgg.set(groupId, g)
    }
    const groupRows = mode !== 'group' ? [] : [...groupRowsAgg.entries()]
      .map(([groupId, g]) => {
        const charges: Record<string, number> = {}
        for (const uid of g.unitIds) for (const [k, v] of Object.entries(byUnit.get(uid) ?? {})) charges[k] = round2((charges[k] ?? 0) + v)
        let cpi: number | null = null
        for (const uid of g.unitIds) { const c = infoByUnit.get(uid)?.cpi; if (c != null) cpi = round2((cpi ?? 0) + c) }
        const apartmentUnitId = g.unitIds.find((uid) => {
          const t = (unitById.get(uid)?.type || '').toLowerCase()
          return t === 'apartament' || t === 'sad' || t === 'comercial'
        })
        const distinctContacts = [...new Set(g.unitIds.map((uid) => contactForUnit(uid)).filter((n): n is string => !!n))]
        let beName = distinctContacts[0] ?? ''
        let contactMismatch = false
        if (distinctContacts.length > 1) {
          const lead = apartmentUnitId ? contactForUnit(apartmentUnitId) : null
          beName = (lead ? [lead, ...distinctContacts.filter((n) => n !== lead)] : distinctContacts).join(', ')
          contactMismatch = true
        }
        const apartmentBeId = apartmentUnitId ? beIdByUnitId.get(apartmentUnitId) : undefined
        const apartmentBeCode = apartmentBeId ? beById.get(apartmentBeId)?.code : undefined
        return {
          rowKey: groupId,
          beCode: apartmentBeCode ?? groupId, beName, displayName: g.name, order: 0,
          units: g.unitIds.map((uid) => unitById.get(uid)?.code ?? uid),
          cpi, residents: null, consumption: null,
          charges, curentTotal: round2(Object.values(charges).reduce((x, v) => x + v, 0)), contactMismatch,
          ...zeroFinancials,
        }
      })
      .filter((r) => r.curentTotal !== 0 || r.cpi != null)
      .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '', 'ro', { numeric: true }))

    const rows = mode === 'unit' ? unitRows : mode === 'group' ? groupRows : entityRows

    const totals = {
      cpi: round2(rows.reduce((s, r) => s + (r.cpi ?? 0), 0)),
      residents: rows.reduce((s, r) => s + (r.residents ?? 0), 0),
      consumption: round2(rows.reduce((s, r) => s + (r.consumption ?? 0), 0)),
      soldPrecedent: round2(rows.reduce((s, r) => s + r.soldPrecedent, 0)),
      soldByFund: groups.reduce((acc, g) => {
        acc[g.key] = round2(rows.reduce((s, r) => s + (r.soldByFund?.[g.key] ?? 0), 0))
        return acc
      }, {} as Record<string, number>),
      paymentsByFund: groups.reduce((acc, g) => {
        acc[g.key] = round2(rows.reduce((s, r) => s + ((r as any).paymentsByFund?.[g.key] ?? 0), 0))
        return acc
      }, {} as Record<string, number>),
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

    return { period: { code: p?.code, status: p?.status, dueDate: p?.dueDate, afisareDate: p?.afisareDate }, groupBy: mode, categories, categoryLabels, groups, fundGroups: AVIZIER_FUND_GROUP_META, config: cfg, penaltyFunds, rows, totals }
  }

  /**
   * #22 Avizier "Asociație" view — one row per vendor-service line (not per payer): traces each
   * posted expense charge from the vendor's own invoiced quantity through to how the association
   * categorizes and splits it. Reuses `expenseCatalog()`'s split-leaf reading (derivedShare meter
   * pairs for the water branch-vs-measured-vs-residual triad) but per CHARGE instead of per
   * ExpenseType, and filters each charge's leaves to exactly the ones the allocation engine
   * actually used (`allocationSnapshot.splitNodeIds`) rather than re-deriving "active" from the
   * period's current waterDifferenceMethod — so a mid-period method change doesn't retroactively
   * relabel an already-posted charge.
   */
  async avizierExpenses(communityId: string, periodCode?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { period: null, rows: [], totals: { totalCost: 0 } }
    const p = await this.prisma.period.findUnique({ where: { id: period.id }, select: { code: true, seq: true } })
    const seq = p?.seq ?? 0

    const chargeRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select cc.id, cc.source_type, cc.amount::float8 as amount, cc.source_key,
              cc.allocation_snapshot->>'expenseType' as expense_type_code,
              cc.allocation_snapshot->'splitNodeIds' as split_node_ids,
              cc.meta->>'description' as description,
              f.code as fund_code,
              vi.id as invoice_id, vi.number as invoice_number, v.name as vendor_name
         from community_charge cc
         left join fund f on f.id = cc.fund_id
         left join vendor_invoice vi on vi.id = cc.source_id
         left join vendor v on v.id = vi.vendor_id
        where cc.community_id = $1 and cc.period_id = $2 and cc.status = 'ACTIVE'`,
      communityId, period.id,
    )
    if (!chargeRows.length) return { period: { code: p?.code ?? null }, rows: [], totals: { totalCost: 0 } }

    // Domeniu = the SAME per-community domains the admin set up in "Configurare Servicii" (not a
    // separate hardcoded taxonomy) — Community.features.associationInfo.serviceConfig.domains,
    // the exact source serviceOrderIndex() above already reads for that config page's own order.
    // Fund-contribution charges have no ExpenseType/domain assignment at all (they're not
    // "services" in that config), so they get a fixed "Fonduri" domain instead.
    const community = await this.prisma.community.findFirst({ where: { OR: [{ id: communityId }, { code: communityId }] }, select: { features: true } })
    const serviceDomains: any[] = (community?.features as any)?.associationInfo?.serviceConfig?.domains ?? []
    const domainByExpenseCode = new Map<string, string>()
    for (const dom of serviceDomains) {
      const codes = Array.isArray(dom?.serviceCodes) ? dom.serviceCodes : []
      for (const code of codes) if (typeof code === 'string') domainByExpenseCode.set(code, String(dom?.name || dom?.key || ''))
    }
    const METHOD_LABEL: Record<string, string> = {
      EQUAL: 'Egal (per unitate)', BY_SQM: 'Cotă-parte indiviză (CPI)', BY_RESIDENTS: 'Număr persoane',
      BY_CONSUMPTION: 'Consum', MIXED: 'Mixt',
    }
    const expenseCodes = [...new Set(chargeRows.map((r) => r.expense_type_code).filter(Boolean))] as string[]
    const expenseTypes = expenseCodes.length
      ? await this.prisma.expenseType.findMany({
          where: { communityId, code: { in: expenseCodes } },
          select: { code: true, name: true, params: true, rule: { select: { method: true } } },
        })
      : []
    const expenseTypeByCode = new Map(expenseTypes.map((e) => [e.code, e]))

    // Per-charge: the leaves the engine actually used (for vendor-invoice charges only — fund
    // contribution charges have no ExpenseType/splitTemplate at all, see the FUND branch below),
    // whether any of them derive a branch-vs-measured-vs-residual triad (water), and which
    // UnitGroup it pays through.
    type LeafSet = { basisCode: string | null; metered: any | null; residual: any | null }
    const groupCodes = new Set<string>()
    const communityMeterIds = new Set<string>()
    const leafSetByChargeId = new Map<string, LeafSet>()
    for (const row of chargeRows) {
      const et = row.expense_type_code ? expenseTypeByCode.get(row.expense_type_code) : undefined
      const allLeaves: any[] = et && Array.isArray((et.params as any)?.splitTemplate) ? (et.params as any).splitTemplate : []
      const activeIds: string[] = Array.isArray(row.split_node_ids) ? row.split_node_ids.map(String) : []
      const active = activeIds.length ? allLeaves.filter((l) => activeIds.includes(String(l?.id))) : allLeaves
      const withShare = active.filter((l) => l?.derivedShare)
      const residual = withShare.find((l) => /RESIDUAL/i.test(String(l?.derivedShare?.partMeterId ?? ''))) ?? null
      const metered = withShare.find((l) => l !== residual) ?? null
      const basisCode = active.find((l) => l?.allocation?.basis?.type === 'GROUP')?.allocation?.basis?.code ?? null
      if (basisCode) groupCodes.add(String(basisCode))
      for (const l of [metered, residual]) {
        if (l?.derivedShare?.totalMeterId) communityMeterIds.add(String(l.derivedShare.totalMeterId))
        if (l?.derivedShare?.partMeterId) communityMeterIds.add(String(l.derivedShare.partMeterId))
      }
      leafSetByChargeId.set(row.id, { basisCode: basisCode ? String(basisCode) : null, metered, residual })
    }

    // A charge with both a "metered" and "residual" leaf (the water branch-vs-measured-vs-
    // residual triad) gets split into TWO output rows below ("Apă rece" + "Apă - diferență") —
    // each leaf's own real cost share, not a pro-rata guess, lives on every one of its
    // community_charge_line rows as meta.allocation.base (the leaf's total before per-unit
    // distribution); read it directly.
    const splitChargeIds = [...leafSetByChargeId.entries()].filter(([, l]) => l.metered && l.residual).map(([id]) => id)
    const leafCostRows: any[] = splitChargeIds.length
      ? await (this.prisma as any).$queryRawUnsafe(
          `select distinct charge_id, meta->>'splitNodeId' as split_node_id, (meta->'allocation'->>'base')::float8 as base
             from community_charge_line
            where charge_id = any($1::text[])`,
          splitChargeIds,
        )
      : []
    const leafCost = (chargeId: string, splitNodeId?: string | null): number | null => {
      const r = leafCostRows.find((x) => x.charge_id === chargeId && x.split_node_id === splitNodeId)
      return r ? Number(r.base) : null
    }

    // Fund-contribution charges (source_type='FUND', e.g. the REABILITARE/RULMENT monthly offset)
    // have no ExpenseType at all — they're driven straight from Fund.allocation (method/split/
    // weights), community-wide, per `explainCell`'s own convention (`cc.source_type = 'FUND'` →
    // `f.code` as the category). "Beneficiari" defaults to ALL_BILLABLE (every fund-contribution
    // charge in practice applies community-wide).
    const fundCodes = [...new Set(chargeRows.filter((r) => r.source_type === 'FUND' && r.fund_code).map((r) => r.fund_code))] as string[]
    const funds = fundCodes.length
      ? await this.prisma.fund.findMany({ where: { communityId, code: { in: fundCodes } }, select: { code: true, name: true, allocation: true } })
      : []
    const fundByCode = new Map(funds.map((f) => [f.code, f]))
    if (fundCodes.length) groupCodes.add('ALL_BILLABLE')

    // Batch-fetch: UnitGroup names + their current member units (for Beneficiari + non-water
    // "Cantitate măsurată" counts), community meter readings (for the water triad).
    const [groups, groupMembers, meters] = await Promise.all([
      groupCodes.size ? this.prisma.unitGroup.findMany({ where: { communityId, code: { in: [...groupCodes] } }, select: { id: true, code: true, name: true } }) : [],
      groupCodes.size ? this.prisma.unitGroupMember.findMany({
          where: { group: { communityId, code: { in: [...groupCodes] } }, startSeq: { lte: seq }, OR: [{ endSeq: null }, { endSeq: { gte: seq } }] },
          select: { unitId: true, group: { select: { code: true } } },
        }) : [],
      communityMeterIds.size ? this.prisma.meter.findMany({ where: { meterId: { in: [...communityMeterIds] } }, select: { meterId: true, scopeType: true, typeCode: true } }) : [],
    ])
    const groupNameByCode = new Map(groups.map((g) => [g.code, g.name]))
    const unitIdsByGroupCode = new Map<string, string[]>()
    for (const m of groupMembers) {
      const arr = unitIdsByGroupCode.get(m.group.code) ?? []
      arr.push(m.unitId)
      unitIdsByGroupCode.set(m.group.code, arr)
    }
    const communityMeters = meters.filter((m) => m.scopeType === 'COMMUNITY')
    const communityReadings = communityMeters.length
      ? await this.prisma.periodMeasure.findMany({
          where: { communityId, periodId: period.id, scopeType: 'COMMUNITY', typeCode: { in: communityMeters.map((m) => m.typeCode) } },
          select: { typeCode: true, value: true },
        })
      : []
    const meterValue = (meterId?: string | null): number | null => {
      const m = meterId ? communityMeters.find((cm) => cm.meterId === meterId) : undefined
      const v = m ? communityReadings.find((r) => r.typeCode === m.typeCode)?.value : undefined
      return v == null ? null : Number(v)
    }

    // Non-water "Cantitate măsurată" for vendor-invoice charges: sum of SQM/RESIDENTS across the
    // payer group's current units, dispatched off the ExpenseType's own AllocationRule.method
    // (not a per-leaf field — e.g. a CPI-split leaf carries `ruleCode: 'BY_CPI'`, not a
    // `weightSource`, so the rule's method is the reliable signal).
    const unitMeasureRows = await this.prisma.periodMeasure.findMany({
      where: { communityId, periodId: period.id, scopeType: 'UNIT', typeCode: { in: ['SQM', 'RESIDENTS'] } },
      select: { scopeId: true, typeCode: true, value: true },
    })
    const sumMeasureForGroup = (typeCode: string, groupCode: string): number => {
      const unitIds = new Set(unitIdsByGroupCode.get(groupCode) ?? [])
      return unitMeasureRows
        .filter((r) => r.typeCode === typeCode && unitIds.has(r.scopeId))
        .reduce((s, r) => s + Number(r.value), 0)
    }

    const unitCostOf = (totalCost: number, qty: number | null, unit: string | null) => ({
      unitCost: qty ? round2(totalCost / qty) : null,
      unitCostUnit: unit,
    })

    const rows = chargeRows.flatMap((row) => {
      const isFund = row.source_type === 'FUND'
      const et = !isFund && row.expense_type_code ? expenseTypeByCode.get(row.expense_type_code) : undefined
      const fund = isFund && row.fund_code ? fundByCode.get(row.fund_code) : undefined
      const leafSet = !isFund ? leafSetByChargeId.get(row.id) : undefined
      const domain = isFund ? 'Fonduri' : (row.expense_type_code ? (domainByExpenseCode.get(row.expense_type_code) ?? '—') : '—')
      const vendorName = isFund ? 'Asociația' : (row.vendor_name ?? '—')
      const document = row.invoice_number ?? '—'
      const fundCode: string | null = row.fund_code ?? null

      // Water's branch-vs-measured-vs-residual triad splits into TWO rows — "Apă rece" (the
      // metered leaf) and "Apă - diferență" (the residual leaf) — each with its own real cost
      // share (community_charge_line.meta.allocation.base, read above), not a pro-rata guess, so
      // the two rows' totalCost always adds back up to the charge's own posted amount. Both stay
      // attributed to the same vendor/document (Aquatim) — the residual is still part of that
      // same invoice, just a different line of it — using each leaf's own descriptive `name`
      // (from def.json's expenseSplits) for "Serviciu Furnizor" instead of the charge-level
      // combined description, since the two leaves are genuinely different line items.
      if (et && leafSet?.metered && leafSet?.residual) {
        const beneficiaries = leafSet.basisCode ? (groupNameByCode.get(leafSet.basisCode) ?? leafSet.basisCode) : '—'
        const splitMethod = et.rule?.method ? (METHOD_LABEL[et.rule.method] ?? et.rule.method) : '—'
        const invoicedQty = meterValue(leafSet.metered.derivedShare.totalMeterId)
        const measuredQty = meterValue(leafSet.metered.derivedShare.partMeterId)
        const residualQty = meterValue(leafSet.residual.derivedShare.partMeterId)
        const meteredCost = round2(leafCost(row.id, leafSet.metered.id) ?? Number(row.amount))
        const residualCost = round2(leafCost(row.id, leafSet.residual.id) ?? 0)

        const meteredRow = {
          domain, associationService: et.name ?? row.expense_type_code ?? '—',
          measuredQty, measuredQtyUnit: measuredQty != null ? 'm3' : null, measuredQtyBasis: 'Măsurat',
          beneficiaries, splitMethod,
          vendorName, vendorService: leafSet.metered.name ?? '—', document,
          invoicedQty, invoicedQtyUnit: invoicedQty != null ? 'm3' : null,
          qtyDifference: null as number | null,
          // Priced against its OWN quantity (not the total invoiced m³) — both the metered and
          // residual rows come out to the same real per-m³ rate this way, since the underlying
          // invoice charges one uniform rate across the whole branch reading.
          ...unitCostOf(meteredCost, measuredQty, 'm3'),
          totalCost: meteredCost, fundCode,
        }
        const residualRow = {
          domain, associationService: 'Apă - diferență',
          measuredQty: residualQty, measuredQtyUnit: residualQty != null ? 'm3' : null, measuredQtyBasis: 'Calculat',
          beneficiaries, splitMethod,
          vendorName, vendorService: leafSet.residual.name ?? '—', document,
          invoicedQty: null as number | null, invoicedQtyUnit: null as string | null,
          qtyDifference: null as number | null,
          ...unitCostOf(residualCost, residualQty, 'm3'),
          totalCost: residualCost, fundCode,
        }
        return [meteredRow, residualRow]
      }

      let measuredQty: number | null = null, measuredQtyUnit: string | null = null, measuredQtyBasis: string | null = null
      let invoicedQty: number | null = null, invoicedQtyUnit: string | null = null
      let qtyDifference: number | null = null
      let beneficiaries = '—', splitMethod = '—'
      const vendorService = row.vendor_name ? (row.description ?? '—') : '—'

      if (isFund && fund) {
        const alloc: any = fund.allocation ?? {}
        beneficiaries = groupNameByCode.get('ALL_BILLABLE') ?? 'Toate unitățile facturabile'
        if (alloc.method === 'EQUAL') {
          splitMethod = METHOD_LABEL.EQUAL
          measuredQty = (unitIdsByGroupCode.get('ALL_BILLABLE') ?? []).length
          measuredQtyUnit = 'Unitate'; measuredQtyBasis = 'Calculat'
        } else if (alloc.split === 'CPI' || alloc.method === 'EXPLICIT') {
          splitMethod = METHOD_LABEL.BY_SQM
          const weights = alloc.weights && typeof alloc.weights === 'object' ? Object.values(alloc.weights) as number[] : []
          measuredQty = weights.length ? round2(weights.reduce((s, v) => s + Number(v), 0)) : null
          measuredQtyUnit = measuredQty != null ? 'CPI' : null; measuredQtyBasis = measuredQty != null ? 'Calculat' : null
        }
      } else if (et && leafSet) {
        beneficiaries = leafSet.basisCode ? (groupNameByCode.get(leafSet.basisCode) ?? leafSet.basisCode) : '—'
        splitMethod = et.rule?.method ? (METHOD_LABEL[et.rule.method] ?? et.rule.method) : '—'
        if (leafSet.metered || leafSet.residual) {
          const totalMeterId = leafSet.metered?.derivedShare?.totalMeterId ?? leafSet.residual?.derivedShare?.totalMeterId
          invoicedQty = meterValue(totalMeterId)
          invoicedQtyUnit = invoicedQty != null ? 'm3' : null
          if (leafSet.metered) { measuredQty = meterValue(leafSet.metered.derivedShare.partMeterId); measuredQtyUnit = measuredQty != null ? 'm3' : null; measuredQtyBasis = 'Măsurat' }
          if (leafSet.residual) qtyDifference = meterValue(leafSet.residual.derivedShare.partMeterId)
        } else if (et.rule?.method === 'BY_SQM' && leafSet.basisCode) {
          measuredQty = round2(sumMeasureForGroup('SQM', leafSet.basisCode)); measuredQtyUnit = 'CPI'; measuredQtyBasis = 'Calculat'
        } else if (et.rule?.method === 'BY_RESIDENTS' && leafSet.basisCode) {
          measuredQty = round2(sumMeasureForGroup('RESIDENTS', leafSet.basisCode)); measuredQtyUnit = 'Persoana'; measuredQtyBasis = 'Estimat'
        } else if (et.rule?.method === 'EQUAL' && leafSet.basisCode) {
          measuredQty = (unitIdsByGroupCode.get(leafSet.basisCode) ?? []).length; measuredQtyUnit = 'Unitate'; measuredQtyBasis = 'Calculat'
        }
      }

      const totalCost = round2(Number(row.amount))
      // Prefer the vendor's own invoiced quantity (water) when there is one; every other method
      // still has a real quantity basis (CPI %, persons, unit count) to price against — no reason
      // to leave it blank just because there's no physical meter behind it.
      const unitCostQty = invoicedQty ?? measuredQty
      const unitCostUnit = invoicedQty != null ? invoicedQtyUnit : measuredQtyUnit

      return [{
        domain,
        associationService: isFund ? (fund?.name ?? row.fund_code ?? '—') : (et?.name ?? row.expense_type_code ?? '—'),
        measuredQty, measuredQtyUnit, measuredQtyBasis,
        beneficiaries,
        splitMethod,
        vendorName, vendorService, document,
        invoicedQty, invoicedQtyUnit,
        qtyDifference,
        ...unitCostOf(totalCost, unitCostQty, unitCostUnit),
        totalCost,
        fundCode,
      }]
    })
    rows.sort((a, b) => a.domain.localeCompare(b.domain, 'ro') || a.associationService.localeCompare(b.associationService, 'ro') || a.vendorService.localeCompare(b.vendorService, 'ro'))

    return { period: { code: p?.code ?? null }, rows, totals: { totalCost: round2(rows.reduce((s, r) => s + r.totalCost, 0)) } }
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
    // round measures/percentages to 2 digits and drop trailing zeros (avoids float noise like 99.99999997)
    const num = (n: any) => (n == null ? '?' : String(Math.round(Number(n) * 100) / 100))
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

    // Manual correction (if any) applied to this BE's penalty for the period — shown as a banner so the
    // drilldown reconciles with the (net) avizier figure.
    const penFund = await this.prisma.fund.findFirst({ where: { communityId, code: 'PENALIZARI' }, select: { id: true } })
    const ovrRow = penFund ? await this.prisma.chargeOverride.findFirst({
      where: { communityId, periodId: period.id, billingEntityId: be.id, fundId: penFund.id }, orderBy: { createdAt: 'desc' },
    }) : null
    const override = ovrRow && ovrRow.overrideAmount != null
      ? { computed: round2(Number(ovrRow.computedAmount)), approved: round2(Number(ovrRow.overrideAmount)), comment: ovrRow.comment, actor: ovrRow.actor, at: ovrRow.createdAt }
      : null

    return {
      beCode, beName: be.name, periodCode: p.code, sourceFund: sourceFund ?? null,
      monthTotal: round2(monthTotal), grandTotal: round2(grandTotal),
      override,
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
              sum(bs.due_start)::float8 as sold, sum(bs.payments)::float8 as payments, sum(bs.charges)::float8 as charges
         from be_statement bs left join fund f on f.id = bs.fund_id
        where bs.community_id = $1 and bs.period_id = $2 and bs.billing_entity_id = $3
        group by f.code, f.name
       having abs(sum(bs.due_start)) > 0.0001 or abs(sum(bs.payments)) > 0.0001 or abs(sum(bs.charges)) > 0.0001
        order by coalesce(f.name, f.code)`,
      communityId, period.id, be.id,
    )
    // amount = net Restanțe (dueStart − payments), same figure the "per Fond-Stare" Restanțe cell
    // shows; dueStart/payments are broken out so the drilldown explains how that net figure was
    // reached, and charges/totalDue show this period's own charge and the true full total owed
    // (net Restanțe + charges) — distinct from "amount", which deliberately excludes this month's
    // own new charge.
    const out = rows.map((r) => ({
      fundCode: r.fundCode, fundName: r.fundName,
      dueStart: round2(Number(r.sold)), payments: round2(Number(r.payments)),
      amount: round2(Number(r.sold) - Number(r.payments)),
      charges: round2(Number(r.charges)),
      totalDue: round2(Number(r.sold) - Number(r.payments) + Number(r.charges)),
    }))
    return {
      beCode, beName: be.name, periodCode: period.code, rows: out,
      dueStartTotal: round2(out.reduce((s, r) => s + r.dueStart, 0)),
      paymentsTotal: round2(out.reduce((s, r) => s + r.payments, 0)),
      chargesTotal: round2(out.reduce((s, r) => s + r.charges, 0)),
      totalDueTotal: round2(out.reduce((s, r) => s + r.totalDue, 0)),
      total: round2(out.reduce((s, r) => s + r.amount, 0)),
    }
  }

  /**
   * Payment log for one billing entity in a period: the individual owner receipts collected against
   * that period's cycle (from the imported cash register — payment.provider LIKE 'cash-register%'
   * — each import batch gets its own suffixed provider, e.g. 'cash-register-2026-06' — scoped by
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
        where community_id = $1 and billing_entity_id = $3 and provider like 'cash-register%'
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
          and not (d.ref_type in ('CHG_OVR_REV','CHG_OVR_SET') and f.code = 'PENALIZARI')
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

  /**
   * Focused penalty-review list for the close wizard: per billing entity, the computed penalty charge
   * (be_statement.charges for the penalty fund) + any active manual override, newest-net first.
   */
  async penaltyReview(communityId: string, periodCode: string, fundCode = 'PENALIZARI') {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { period: null, rows: [], totalComputed: 0, totalNet: 0 }
    const penFund = await this.prisma.fund.findFirst({ where: { communityId, code: fundCode }, select: { id: true } })
    const p = await this.prisma.period.findFirst({ where: { communityId, code: period.code }, select: { status: true } })
    if (!penFund) return { period: { code: period.code, status: p?.status ?? null }, rows: [], totalComputed: 0, totalNet: 0 }
    const [stmts, bes, ovAll] = await Promise.all([
      this.prisma.beStatement.findMany({ where: { communityId, periodId: period.id, fundId: penFund.id }, select: { billingEntityId: true, charges: true } }),
      this.prisma.billingEntity.findMany({ where: { communityId }, select: { id: true, code: true, name: true, displayName: true } }),
      this.prisma.chargeOverride.findMany({ where: { communityId, periodId: period.id, fundId: penFund.id }, orderBy: { createdAt: 'desc' } }),
    ])
    const beById = new Map(bes.map((b) => [b.id, b]))
    const activeOv = new Map<string, any>()
    for (const o of ovAll) if (!activeOv.has(o.billingEntityId)) activeOv.set(o.billingEntityId, o)
    const rows = stmts
      .map((s) => {
        const computed = round2(Number(s.charges))
        const ov = activeOv.get(s.billingEntityId)
        const override = ov && ov.overrideAmount != null ? round2(Number(ov.overrideAmount)) : null
        const be = beById.get(s.billingEntityId)
        return { beCode: be?.code, beName: be?.name, displayName: (be as any)?.displayName ?? null, computed, override, net: override != null ? override : computed }
      })
      .filter((r) => r.computed > 0.005 || r.override != null)
      .sort((a, b) => b.net - a.net)
    return {
      period: { code: period.code, status: p?.status ?? null },
      fundCode,
      rows,
      totalComputed: round2(rows.reduce((s, r) => s + r.computed, 0)),
      totalNet: round2(rows.reduce((s, r) => s + r.net, 0)),
    }
  }

  /** Collection rate for a period: charged (be_statement.charges) vs collected (payments). */
  /**
   * `charged` is this period's own be_statement total (correct as a period-scoped figure).
   * `collected`, however, is deliberately NOT be_statement.payments for this same period: residents
   * pay a period's invoice only after it's actually posted (Period.afisareDate) — payments booked
   * into period X's own be_statement are typically settling the PRIOR cycle's invoice (this is why
   * the avizier itself labels period X's payments column "Încasări (X-1)", a cosmetic relabeling of
   * the same underlying number — see AvizierPanel.tsx). So "this period's real collection" is
   * instead every POSTED payment dated after this period's own afisareDate — right after posting,
   * that's correctly 0 until residents start paying against it.
   */
  async collection(communityId: string, periodCode?: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    if (!period) return { periodCode: null, charged: 0, chargedCount: 0, collected: 0, collectedCount: 0, ratePct: null }
    // be_statement has one row per (billing entity, fund) — @@unique([communityId, periodId,
    // billingEntityId, fundId]) — so counting rows overcounts units by however many funds each
    // one spans. Aggregate to one row per billing entity first, then count those with a real charge.
    const chargedRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select coalesce(sum(charges),0)::float8 as charged,
              (select count(*) from (
                select billing_entity_id from be_statement
                where community_id = $1 and period_id = $2
                group by billing_entity_id
                having sum(charges) > 0
              ) x)::int as "chargedCount"
         from be_statement where community_id = $1 and period_id = $2`,
      communityId, period.id,
    )
    const charged = round2(Number(chargedRows?.[0]?.charged ?? 0))
    const chargedCount = Number(chargedRows?.[0]?.chargedCount ?? 0)

    // Per-fund breakdown for the Dashboard's "Curente" card expander.
    const chargedByFundRows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select f.code as "fundCode", f.name as "fundName", coalesce(sum(bs.charges),0)::float8 as amount
         from be_statement bs join fund f on f.id = bs.fund_id
        where bs.community_id = $1 and bs.period_id = $2
        group by f.code, f.name
       having coalesce(sum(bs.charges),0) <> 0
        order by f.code`,
      communityId, period.id,
    )
    const chargedByFund = chargedByFundRows.map((r) => ({ ...r, amount: round2(Number(r.amount)) }))

    const periodRow: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select afisare_date as "afisareDate" from period where id = $1`,
      period.id,
    )
    const afisareDate: Date | null = periodRow?.[0]?.afisareDate ?? null
    let collected = 0
    let collectedCount = 0
    if (afisareDate) {
      const collectedRows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `select coalesce(sum(amount),0)::float8 as collected, count(distinct billing_entity_id)::int as "collectedCount"
           from payment where community_id = $1 and status = 'POSTED' and ts > $2`,
        communityId, afisareDate,
      )
      collected = round2(Number(collectedRows?.[0]?.collected ?? 0))
      collectedCount = Number(collectedRows?.[0]?.collectedCount ?? 0)
    }
    return {
      periodCode: period.code,
      charged,
      chargedCount,
      chargedByFund,
      collected,
      collectedCount,
      ratePct: charged > 0 ? round2((collected / charged) * 100) : null,
    }
  }
}

function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
