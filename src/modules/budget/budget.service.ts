import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { satisfactionOf } from '../services/services.service'
import {
  BUDGET_COST_TYPE_META, BUDGET_DIMENSION_META, BUDGET_ENTRY_KIND_META, BUDGET_LINE_STATUS_META, BUDGET_MAINTENANCE_META,
  BUDGET_METRIC_META, BUDGET_SERVICE_META, labelOf,
} from './budget-meta'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: any) => (v == null ? 0 : Number(v))

type ExpenseChargeRow = { periodCode: string; periodSeq: number; periodStatus: string; chargeId: string; expenseType: string; amount: number }

export type LineMetrics = {
  budget: number
  estimate: number
  committed: number | null
  actual: number
  remainingCommitted: number
  remainingUncommitted: number
  forecast: number
  variance: number
  paidByFund: Record<string, number>
}

type Split = Array<{ code: string; weight: number }>
type FundPlanRow = { code: string; label: string; dimension: string; appFund: boolean }

type MonthRow = { periodCode: string; budget: number; actual: number | null; forecast: number; kind: 'ACTUAL' | 'DRAFT' | 'ESTIMATE' }

/**
 * Budget vs Forecast vs Actual (docs/budget.md). Read side over the budget tables plus the live
 * ledger: OPERATIONAL/TACTIC lines with an `actualSource` read their actuals from
 * `community_charge` (the same rows the avizier bills — CLAUDE.md rule 9); STRATEGIC lines carry
 * their own commitment/payment evidence (`budget_entry`, imported from the project plan).
 */
@Injectable()
export class BudgetService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCommunityId(communityId: string) {
    const c = await this.prisma.community.findFirst({ where: { OR: [{ id: communityId }, { code: communityId }] }, select: { id: true, name: true } })
    if (!c) throw new NotFoundException('Community not found')
    return c
  }

  /**
   * Every ACTIVE charge of `fundCode`, labelled with its expense type. EXPENSE charges carry the
   * type in `source_key`; VENDOR_INVOICE charges carry the bill template's item key, which only
   * the invoice's own template can resolve ("penalitati" exists in several templates).
   */
  async expenseCharges(communityId: string, fundCode = 'EXPENSES'): Promise<ExpenseChargeRow[]> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select p.code as period_code, p.seq as period_seq, p.status::text as period_status, cc.id as charge_id,
              cc.amount::float8 as amount,
              case when cc.source_type = 'VENDOR_INVOICE' then coalesce(x.item->>'expenseTypeCode', upper(cc.source_key))
                   else cc.source_key end as expense_type
         from community_charge cc
         join fund f on f.id = cc.fund_id
         join period p on p.id = cc.period_id
         left join vendor_invoice vi on cc.source_type = 'VENDOR_INVOICE' and vi.id = cc.source_id
         left join bill_template_instance bti on bti.id = vi.template_instance_id
         left join bill_template bt on bt.id = bti.template_id
         left join lateral (select i as item from jsonb_array_elements(bt.template->'items') i
                             where i->>'key' = cc.source_key limit 1) x on true
        where cc.community_id = $1 and f.code = $2 and cc.status = 'ACTIVE'`,
      communityId, fundCode,
    )
    return rows.map((r) => ({
      periodCode: r.period_code, periodSeq: Number(r.period_seq), periodStatus: r.period_status,
      chargeId: r.charge_id, expenseType: r.expense_type, amount: Number(r.amount),
    }))
  }

  private yearMonths(year: number) {
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  }

  private async periodsByCode(communityId: string) {
    const ps = await this.prisma.period.findMany({ where: { communityId }, select: { id: true, code: true, seq: true, status: true }, orderBy: { seq: 'asc' } })
    return new Map(ps.map((p) => [p.code, p]))
  }

  /** Monthly budget/actual/forecast for a line that reads its actuals live from expense charges. */
  private liveMonths(line: any, year: number, charges: ExpenseChargeRow[], periods: Map<string, { status: string; seq: number }>): MonthRow[] {
    // `codes: null` = every charge of the source fund (e.g. Fond de rulment).
    const all = !line.actualSource?.codes?.length
    const codes = new Set<string>(line.actualSource?.codes ?? [])
    const byPeriod = new Map<string, number>()
    for (const c of charges) if (all || codes.has(c.expenseType)) byPeriod.set(c.periodCode, (byPeriod.get(c.periodCode) ?? 0) + c.amount)
    const phasing = (line.phasing ?? {}) as Record<string, number>
    const method = line.basis?.forecastMethod ?? 'RUN_RATE'
    // Run rate = mean of the last 3 CLOSED periods (zeros included: a month with no cost is data).
    const closedDesc = [...periods.entries()].filter(([, p]) => p.status === 'CLOSED').sort((a, b) => b[1].seq - a[1].seq).slice(0, 3)
    const runRate = closedDesc.length ? closedDesc.reduce((s, [code]) => s + (byPeriod.get(code) ?? 0), 0) / closedDesc.length : 0
    return this.yearMonths(year).map((code) => {
      const p = periods.get(code)
      const budget = r2(num(phasing[code]))
      if (p?.status === 'CLOSED') {
        const a = r2(byPeriod.get(code) ?? 0)
        return { periodCode: code, budget, actual: a, forecast: a, kind: 'ACTUAL' as const }
      }
      if (p?.status === 'PREPARED' && byPeriod.has(code)) {
        return { periodCode: code, budget, actual: null, forecast: r2(byPeriod.get(code)!), kind: 'DRAFT' as const }
      }
      const f = method === 'NONE' ? 0 : method === 'BUDGET' ? budget : r2(runRate)
      return { periodCode: code, budget, actual: null, forecast: f, kind: 'ESTIMATE' as const }
    })
  }

  private metricsFor(line: any, months: MonthRow[] | null): LineMetrics {
    const budget = num(line.budgetAmount)
    const paidByFund: Record<string, number> = {}
    if (months) {
      const actual = r2(months.reduce((s, m) => s + (m.actual ?? 0), 0))
      const forecast = r2(months.reduce((s, m) => s + m.forecast, 0))
      if (line.fundCode) paidByFund[line.fundCode] = actual
      return {
        budget: r2(budget), estimate: forecast, committed: null, actual,
        remainingCommitted: 0, remainingUncommitted: r2(forecast - actual), forecast, variance: r2(forecast - budget), paidByFund,
      }
    }
    const entries = line.entries ?? []
    const sum = (k: string) => entries.filter((e: any) => e.kind === k).reduce((s: number, e: any) => s + num(e.amount), 0)
    const actual = r2(sum('PAYMENT'))
    for (const e of entries) if (e.kind === 'PAYMENT') {
      const k = e.fundCode ?? '_'
      paidByFund[k] = r2((paidByFund[k] ?? 0) + num(e.amount))
    }
    const committedRaw = sum('COMMITMENT')
    const committed = entries.some((e: any) => e.kind === 'COMMITMENT') ? r2(committedRaw) : null
    const estimate = r2(line.estimateAmount != null ? num(line.estimateAmount) : budget)
    const remainingCommitted = r2(Math.max((committed ?? 0) - actual, 0))
    const forecast = r2(Math.max(actual, committed ?? 0, estimate, entries.length ? 0 : budget))
    return {
      budget: r2(budget), estimate, committed, actual, remainingCommitted,
      remainingUncommitted: r2(forecast - actual - remainingCommitted), forecast, variance: r2(forecast - budget), paidByFund,
    }
  }

  private addMetrics(acc: any, m: LineMetrics) {
    for (const k of ['budget', 'estimate', 'actual', 'remainingCommitted', 'remainingUncommitted', 'forecast', 'variance'] as const) acc[k] = r2((acc[k] ?? 0) + m[k])
    acc.committed = r2((acc.committed ?? 0) + (m.committed ?? 0))
    acc.lineCount = (acc.lineCount ?? 0) + 1
    return acc
  }

  async listVersions(communityId: string) {
    const c = await this.resolveCommunityId(communityId)
    return this.prisma.budgetVersion.findMany({ where: { communityId: c.id }, orderBy: [{ fiscalYear: 'desc' }, { code: 'desc' }] })
  }

  private async loadVersion(communityId: string, versionCode?: string) {
    const version = versionCode
      ? await this.prisma.budgetVersion.findFirst({ where: { communityId, code: versionCode } })
      : await this.prisma.budgetVersion.findFirst({ where: { communityId }, orderBy: [{ fiscalYear: 'desc' }, { updatedAt: 'desc' }] })
    return version
  }

  async getBudget(communityId: string, versionCode?: string, opts: { years?: string; currency?: string } = {}) {
    const c = await this.resolveCommunityId(communityId)
    const versions = await this.listVersions(c.id)
    const meta = this.meta()
    const version = await this.loadVersion(c.id, versionCode)
    if (!version) return { community: c, versions, version: null, meta, lines: [], dimensions: [], projects: [], funds: [], totals: null }

    const [lines, periods, charges, funds, programs, serviceDefs, comm] = await Promise.all([
      this.prisma.budgetLine.findMany({ where: { versionId: version.id }, include: { entries: true, project: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.periodsByCode(c.id),
      this.expenseCharges(c.id, 'EXPENSES'),
      this.prisma.fund.findMany({ where: { communityId: c.id }, select: { code: true, name: true, totalTarget: true, allocation: true, startPeriodCode: true } }),
      this.prisma.budgetProgram.findMany({ where: { communityId: c.id }, include: { projects: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } }),
      this.serviceCatalogue(c.id),
      this.prisma.community.findUnique({ where: { id: c.id }, select: { features: true } }),
    ])
    const order = this.catalogueOrder(serviceDefs, comm?.features)
    const otherFunds = [...new Set(lines.map((l: any) => (l.actualSource as any)?.fundCode).filter((f: any) => f && f !== 'EXPENSES'))] as string[]
    const chargesByFund = new Map<string, ExpenseChargeRow[]>([['EXPENSES', charges], ...(await Promise.all(otherFunds.map(async (f) => [f, await this.expenseCharges(c.id, f)] as [string, ExpenseChargeRow[]])))])
    const chargesOf = (f: string) => chargesByFund.get(f) ?? []
    const fundPlan = ((version as any).fundPlan ?? []) as FundPlanRow[]
    const fundName = new Map<string, string>([...fundPlan.map((f) => [f.code, f.label] as [string, string]), ...funds.map((f) => [f.code, f.name] as [string, string])])
    const svcLabel = (code?: string | null) => (code ? serviceDefs.find((x) => x.code === code)?.name ?? labelOf(BUDGET_SERVICE_META, code) : null)
    const latestClosed = [...periods.values()].filter((p) => p.status === 'CLOSED').sort((a, b) => b.seq - a.seq)[0]

    const outLines = lines.map((l: any) => {
      const months = l.actualSource?.type === 'EXPENSE_TYPES' ? this.liveMonths(l, version.fiscalYear, chargesOf(l.actualSource.fundCode ?? 'EXPENSES'), periods) : null
      const m = this.metricsFor(l, months)
      return {
        id: l.id, code: l.code, dimension: l.dimension, maintenanceKind: l.maintenanceKind,
        maintenanceKindLabel: labelOf(BUDGET_MAINTENANCE_META, l.maintenanceKind),
        serviceCode: l.serviceCode, serviceLabel: svcLabel(l.serviceCode), serviceSplit: this.splitOf(l),
        area: l.area, name: l.name, projectCode: l.project?.code ?? null, projectName: l.project?.name ?? null,
        fundCode: l.fundCode, fundName: l.fundCode ? fundName.get(l.fundCode) ?? l.fundCode : null,
        costType: l.dimension === 'STRATEGIC' ? 'PROJECT' : l.costType ?? null,
        vendorName: l.vendorName, documentRef: l.documentRef, status: l.status, statusLabel: labelOf(BUDGET_LINE_STATUS_META, l.status),
        assumption: l.assumption, live: !!months, horizon: l.dimension === 'STRATEGIC' ? 'MULTIYEAR' : 'ANNUAL',
        metrics: m,
      }
    })

    // Rollups — every perspective sums the same final lines (model §8 rule 3), so they reconcile.
    const dimensions = BUDGET_DIMENSION_META.map((d) => {
      const ls = outLines.filter((l) => l.dimension === d.code)
      const totals = ls.reduce((acc, l) => this.addMetrics(acc, l.metrics), {} as any)
      const groups = d.code === 'TACTIC'
        ? BUDGET_MAINTENANCE_META.map((k) => ({ key: k.code, label: k.label, totals: ls.filter((l) => l.maintenanceKind === k.code).reduce((a, l) => this.addMetrics(a, l.metrics), {} as any) }))
        : d.code === 'STRATEGIC'
          ? programs.flatMap((pg) => pg.projects).map((p) => ({ key: p.code, label: p.name, totals: ls.filter((l) => l.projectCode === p.code).reduce((a, l) => this.addMetrics(a, l.metrics), {} as any) }))
          : []
      return { ...d, horizon: d.code === 'STRATEGIC' ? 'MULTIYEAR' : 'ANNUAL', totals, groups }
    })

    // Funds: what the budget plans to draw from each fund vs what the fund raises / has collected.
    const collected: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select f.code, coalesce(sum(fl.amount) filter (where fl.kind = 'PAYMENT'), 0)::float8 as collected
         from fund f left join fund_ledger_entry fl on fl.fund_id = f.id
        where f.community_id = $1 group by f.code`, c.id,
    )
    const collectedBy = new Map(collected.map((r) => [r.code, Number(r.collected)]))
    const fundCodes = new Set<string>()
    for (const l of outLines) { fundCodes.add(l.fundCode ?? '_'); for (const k of Object.keys(l.metrics.paidByFund)) fundCodes.add(k) }
    const fundRows = [...fundCodes].map((code) => {
      const planned = outLines.filter((l) => (l.fundCode ?? '_') === code)
      const totals = planned.reduce((a, l) => this.addMetrics(a, l.metrics), {} as any)
      const paidFromFund = r2(outLines.reduce((s, l) => s + (l.metrics.paidByFund[code] ?? 0), 0))
      const f = funds.find((x) => x.code === code)
      const target = f?.totalTarget != null ? Number(f.totalTarget) : null
      const col = collectedBy.get(code) ?? null
      return {
        code: code === '_' ? null : code, name: code === '_' ? null : fundName.get(code) ?? code,
        dimensionHint: (f?.allocation as any)?.type ?? null, allocationSplit: (f?.allocation as any)?.split ?? null,
        target, collected: col != null ? r2(col) : null, paidFromFund,
        available: col != null ? r2(col - paidFromFund) : null,
        planned: totals,
        // A positive gap = the lines planned on this fund forecast more than its whole target.
        fundingGap: target != null ? r2((totals.forecast ?? 0) - target) : null,
      }
    }).sort((a, b) => (a.code ?? 'ZZZ').localeCompare(b.code ?? 'ZZZ'))

    const totals = outLines.reduce((a, l) => this.addMetrics(a, l.metrics), {} as any)
    const portfolio = this.portfolio(programs, lines, outLines, version.fiscalYear, fundName, svcLabel)
    // Year selection (default: the fiscal year) and currency: every amount of year Y is divided by
    // that year's EUR rate before the selected years are summed.
    const fy = version.fiscalYear
    const fxRates = ((version as any).fxRates ?? null) as Record<string, { rate: number; basis: string }> | null
    const eur = opts.currency === 'EUR' && !!fxRates
    const lastRate = fxRates ? fxRates[Object.keys(fxRates).sort().pop()!].rate : 1
    const rate = (y: string | number) => (eur ? fxRates![String(y)]?.rate ?? lastRate : 1)
    const yItems = this.yearItems(fy, lines, outLines, portfolio, chargesOf, periods)
    const available = [...new Set(yItems.flatMap((i) => Object.entries(i.byYear).filter(([, v]: any) => v.budget || v.actual || v.forecast).map(([y]) => y)).concat(String(fy)))].sort()
    const asked = (opts.years ?? '').split(',').map((x) => x.trim()).filter((x) => available.includes(x))
    const sel = asked.length ? asked.sort() : [String(fy)]
    const items = yItems.map((i) => {
      const t = { budget: 0, actual: 0, forecast: 0, actualByFund: {} as Record<string, number> }
      for (const y of sel) {
        const v = i.byYear[y]
        if (!v) continue
        const k = rate(y)
        t.budget += v.budget / k; t.actual += v.actual / k; t.forecast += v.forecast / k
        for (const [f, a] of Object.entries(v.actualByFund as Record<string, number>)) t.actualByFund[f] = (t.actualByFund[f] ?? 0) + a / k
      }
      const mon: Record<string, { budget: number; actual: number; forecast: number; actualByFund: Record<string, number> }> = {}
      for (const [m, v] of Object.entries(i.byMonth as Record<string, any>)) {
        if (!sel.includes(m.slice(0, 4))) continue
        const k = rate(m.slice(0, 4))
        mon[m] = { budget: r2(v.budget / k), actual: r2(v.actual / k), forecast: r2(v.forecast / k), actualByFund: Object.fromEntries(Object.entries(v.actualByFund as Record<string, number>).map(([f, a]) => [f, r2(a / k)])) }
      }
      return { ...i, mon, budget: r2(t.budget), actual: r2(t.actual), forecast: r2(t.forecast), actualByFund: Object.fromEntries(Object.entries(t.actualByFund).map(([f, a]) => [f, r2(a)])) }
    })
    const annual = this.annualViews(sel, fy, items, serviceDefs, fundPlan, funds, collectedBy, fundName, order, rate(fy))
    const multiYear = this.multiYear(fy, yItems, annual.byService, annual.byFund, rate)
    return {
      community: c, versions, meta: { ...meta, services: serviceDefs },
      version: { ...version, latestClosedPeriod: latestClosed?.code ?? null },
      programs: programs.map((p) => ({ code: p.code, name: p.name, objective: p.objective, dimension: p.dimension, projects: p.projects.map((x) => ({ code: x.code, name: x.name })) })),
      lines: outLines, dimensions, funds: fundRows, totals, portfolio, annual, multiYear,
      selection: { years: sel, available, fiscalYear: fy, currency: eur ? 'EUR' : 'RON', fxRates, fundBudgetRon: this.fundBudgetRon(yItems, fundName) },
    }
  }

  /**
   * Display order = the services catalogue order (set on the services dashboard): a domain sits at
   * its first service's position, a budget service at its catalogue service's. Funds keep the
   * avizier's fund order (EXPENSES first).
   */
  private catalogueOrder(defs: Array<{ code: string; domain: string | null; catalogueOrder: number | null; [k: string]: any }>, features: any) {
    const svc = new Map(defs.map((d, i) => [d.code, d.catalogueOrder ?? 1000 + i]))
    const dom = new Map<string, number>()
    for (const d of defs) if (d.domain != null) dom.set(d.domain, Math.min(dom.get(d.domain) ?? Infinity, svc.get(d.code)!))
    const fundOrder = ['EXPENSES', ...((features?.avizierConfig?.fundOrder ?? []) as string[])]
    return {
      domainRank: (name: string | null) => (name != null && dom.has(name) ? dom.get(name)! : 5000),
      serviceRank: (code: string | null, sortOrder: number) => (code && svc.has(code) ? svc.get(code)! : 5000 + sortOrder),
      fundRank: (code: string | null) => { const i = code ? fundOrder.indexOf(code) : -1; return i < 0 ? 1000 : i },
    }
  }

  /**
   * Every final item of the budget — operational/tactic lines and strategic projects — with its
   * budget, actual and forecast per year:
   * - budget: Portofoliu column of that year;
   * - actual: past years = closed avizier charges of the line's expense types (lines) or dated
   *   Contract-Factura payments (projects); fiscal year = the live actual;
   * - forecast: past = actual; fiscal year = the live forecast; later years = budget (lines) or the
   *   project's remaining cost spread over its later tranches.
   */
  private yearItems(fy: number, lines: any[], outLines: any[], portfolio: any, chargesOf: (f: string) => ExpenseChargeRow[], periods: Map<string, { status: string; seq: number }>) {
    type Y = { budget: number; actual: number; forecast: number; actualByFund: Record<string, number> }
    type M = { budget: number; actual: number; forecast: number; actualByFund: Record<string, number> }
    // Months: an annual amount with no monthly phasing is spread evenly (Jan–Dec, cents on December);
    // the part of a year's forecast not yet paid goes on the months still to come.
    const spread = (total: number, n = 12) => { const per = r2(total / n); return Array.from({ length: n }, (_, i) => (i < n - 1 ? per : r2(total - per * (n - 1)))) }
    const now = new Date()
    const firstOpen = (y: number) => (y < now.getFullYear() ? 12 : y > now.getFullYear() ? 0 : now.getMonth())
    const monthsOf = (y: string) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`)
    const fillMonths = (y: string, v: Y, actualM: Record<string, number>, fundOfM: (m: string) => Record<string, number>, budgetM?: number[], forecastM?: number[]) => {
      const ms = monthsOf(y)
      const b = budgetM ?? spread(v.budget)
      let f = forecastM
      if (!f) {
        const paid = ms.reduce((s, m) => s + (actualM[m] ?? 0), 0)
        const rest = r2(v.forecast - paid)
        const start = Math.min(firstOpen(Number(y)), 11)
        const r = spread(rest, 12 - start)
        f = ms.map((m, i) => r2((actualM[m] ?? 0) + (i >= start ? r[i - start] : 0)))
      }
      const out: Record<string, M> = {}
      ms.forEach((m, i) => { out[m] = { budget: b[i], actual: r2(actualM[m] ?? 0), forecast: f![i], actualByFund: fundOfM(m) } })
      return out
    }
    const purposeOf = (d: string) => (d === 'OPERATIONAL' ? 'RUN' : d === 'TACTIC' ? 'MAINTAIN' : 'TRANSFORM')
    const items: any[] = []
    for (const l of outLines.filter((x) => x.dimension !== 'STRATEGIC')) {
      const raw = lines.find((x: any) => x.id === l.id)
      const plan = Object.fromEntries(Object.entries((raw?.yearPlan ?? {}) as Record<string, number>).map(([y, v]) => [y, num(v)]))
      if (!plan[String(fy)] && l.metrics.budget) plan[String(fy)] = l.metrics.budget
      const past: Record<string, number> = {}
      const src = raw?.actualSource as any
      if (src?.type === 'EXPENSE_TYPES') {
        const codes = new Set<string>(src.codes ?? [])
        for (const c of chargesOf(src.fundCode ?? 'EXPENSES')) {
          const y = c.periodCode.slice(0, 4)
          if (c.periodStatus === 'CLOSED' && Number(y) < fy && (!codes.size || codes.has(c.expenseType))) past[y] = (past[y] ?? 0) + c.amount
        }
      }
      const fund = l.fundCode ?? '_'
      const byYear: Record<string, Y> = {}
      const byMonth: Record<string, M> = {}
      const pastM: Record<string, number> = {}
      if (src?.type === 'EXPENSE_TYPES') {
        const codes = new Set<string>(src.codes ?? [])
        for (const c of chargesOf(src.fundCode ?? 'EXPENSES')) {
          if (c.periodStatus === 'CLOSED' && Number(c.periodCode.slice(0, 4)) < fy && (!codes.size || codes.has(c.expenseType))) pastM[c.periodCode] = r2((pastM[c.periodCode] ?? 0) + c.amount)
        }
      }
      const live = src?.type === 'EXPENSE_TYPES' ? this.liveMonths(raw, fy, chargesOf(src.fundCode ?? 'EXPENSES'), periods) : null
      for (const y of new Set([...Object.keys(plan), ...Object.keys(past), String(fy)])) {
        const n = Number(y)
        const b = r2(plan[y] ?? 0)
        const a = n < fy ? r2(past[y] ?? 0) : n === fy ? l.metrics.actual : 0
        byYear[y] = { budget: b, actual: a, forecast: n < fy ? a : n === fy ? l.metrics.forecast : b, actualByFund: a ? { [fund]: a } : {} }
        const fm = (actM: Record<string, number>) => (m: string) => (actM[m] ? { [fund]: actM[m] } : {})
        if (n === fy && live) {
          const actM = Object.fromEntries(live.map((m) => [m.periodCode, m.actual ?? 0]))
          Object.assign(byMonth, fillMonths(y, byYear[y], actM, fm(actM), live.map((m) => m.budget), live.map((m) => m.forecast)))
        } else if (n === fy) {
          // No live source: phase budget, actual and forecast like the budget phasing.
          const ph = monthsOf(y).map((m) => num((raw?.phasing ?? {})[m]))
          const tot = ph.reduce((x, v) => x + v, 0)
          const share = (v: number) => (tot > 0 ? ph.map((p, i) => (i < 11 ? r2((v * p) / tot) : 0)).map((x, i, arr) => (i < 11 ? x : r2(v - arr.slice(0, 11).reduce((s2, z) => s2 + z, 0)))) : spread(v))
          const aM = share(a)
          const actM = Object.fromEntries(monthsOf(y).map((m, i) => [m, aM[i]]))
          Object.assign(byMonth, fillMonths(y, byYear[y], actM, fm(actM), share(b), share(byYear[y].forecast)))
        } else {
          const actM = Object.fromEntries(monthsOf(y).map((m) => [m, n < fy ? pastM[m] ?? 0 : 0]))
          Object.assign(byMonth, fillMonths(y, byYear[y], actM, fm(actM)))
        }
      }
      items.push({ key: `L:${l.id}`, kind: 'LINE', id: l.id, code: l.code, name: l.name, purpose: purposeOf(l.dimension), maintenanceKind: l.maintenanceKind, costType: l.costType,
        fundCode: l.fundCode, split: l.serviceSplit, groupCode: `AREA:${l.area ?? '—'}`, groupName: l.area ?? '—', live: l.live, byYear, byMonth })
    }
    for (const pg of portfolio.programs) for (const p of pg.projects) {
      const remaining = Math.max(p.forecast - p.paid, 0)
      const laterTotal = Object.entries(p.yearPlan as Record<string, number>).filter(([y]) => Number(y) > fy).reduce((s, [, v]) => s + v, 0)
        + (p.yearPlan[String(fy)] ?? 0)
      const byYear: Record<string, Y> = {}
      const byMonth: Record<string, M> = {}
      for (const y of new Set([...Object.keys(p.yearPlan), ...Object.keys(p.paidByYear), String(fy)])) {
        const n = Number(y)
        const b = p.yearPlan[y] ?? 0
        const a = p.paidByYear[y] ?? 0
        const f = n < fy ? a : n === fy ? p.year.forecast : laterTotal > 0 ? r2(a + (remaining * (p.yearPlan[y] ?? 0)) / laterTotal) : a
        byYear[y] = { budget: b, actual: a, forecast: f, actualByFund: p.paidByYearFund[y] ?? {} }
        const actM = Object.fromEntries(monthsOf(y).map((m) => [m, p.paidByMonth[m] ?? 0]))
        Object.assign(byMonth, fillMonths(y, byYear[y], actM, (m) => p.paidByMonthFund[m] ?? {}))
      }
      items.push({ key: `P:${p.code}`, kind: 'PROJECT', id: p.code, code: p.code, name: p.name, purpose: 'TRANSFORM', maintenanceKind: null, costType: 'PROJECT',
        fundCode: p.fundCode, split: p.serviceSplit.map((s: any) => ({ code: s.code, weight: s.weight })), groupCode: pg.code, groupName: pg.name, live: false, byYear, byMonth })
    }
    return items
  }

  /** RON budget of every fund per year — the base of a "fund = X EUR" rate. */
  private fundBudgetRon(items: any[], fundName: Map<string, string>) {
    const out: Record<string, Record<string, number>> = {}
    for (const it of items) for (const [y, v] of Object.entries(it.byYear as Record<string, any>)) {
      if (!v.budget || !it.fundCode) continue
      const m = (out[y] ??= {})
      m[it.fundCode] = r2((m[it.fundCode] ?? 0) + v.budget)
    }
    return Object.fromEntries(Object.entries(out).map(([y, m]) => [y, Object.entries(m).map(([code, ron]) => ({ code, name: fundName.get(code) ?? code, ron }))]))
  }

  async setFxRate(communityId: string, body: { version?: string; year: string; rate?: number; fundCode?: string; eur?: number }) {
    const c = await this.resolveCommunityId(communityId)
    const version = await this.loadVersion(c.id, body.version)
    if (!version) throw new NotFoundException('Budget version not found')
    const year = String(body.year ?? '')
    if (!/^\d{4}$/.test(year)) throw new BadRequestException('year must be YYYY')
    let entry: any
    if (body.fundCode && body.eur) {
      const eurAmt = Number(body.eur)
      if (!(eurAmt > 0)) throw new BadRequestException('eur must be > 0')
      const b: any = await this.getBudget(c.id, version.code, { years: year })
      const ron = b.selection.fundBudgetRon[year]?.find((f: any) => f.code === body.fundCode)?.ron
      if (!ron) throw new BadRequestException(`Fund ${body.fundCode} has no budget in ${year}`)
      const name = b.selection.fundBudgetRon[year].find((f: any) => f.code === body.fundCode).name
      const fmt = (n: number) => n.toLocaleString('ro-RO', { maximumFractionDigits: 2 })
      entry = { rate: ron / eurAmt, fromFund: { code: body.fundCode, ron, eur: eurAmt }, basis: `${name} = ${fmt(ron)} lei = ${fmt(eurAmt)} € (setat în aplicație)`, manual: true }
    } else {
      const rate = Number(body.rate)
      if (!(rate > 0 && rate < 100)) throw new BadRequestException('rate must be a positive number')
      entry = { rate: Math.round(rate * 1e6) / 1e6, basis: 'setat manual în aplicație', manual: true }
    }
    const fxRates = { ...(((version as any).fxRates ?? {}) as Record<string, any>), [year]: { ...entry, editedAt: new Date().toISOString() } }
    await this.prisma.budgetVersion.update({ where: { id: version.id }, data: { fxRates } as any })
    return { year, ...entry }
  }

  /** Multi-year budget: budget per year by service (domain → service, split weights) and by fund. */
  private multiYear(fy: number, items: any[], byService: any[], byFund: any[], rate: (y: string) => number) {
    const years = [...new Set([String(fy), ...items.flatMap((i) => Object.entries(i.byYear).filter(([, v]: any) => v.budget).map(([y]) => y))])].sort()
    // Keys: years ("2026") and their months ("2026-01"), so the same rows serve both layouts.
    const months = years.flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`))
    const keys = [...years, ...months]
    const zero = () => Object.fromEntries(keys.map((y) => [y, 0])) as Record<string, number>
    const addTo = (acc: Record<string, number>, plan: Record<string, number>, w = 1) => { for (const y of keys) acc[y] = r2(acc[y] + (plan[y] ?? 0) * w) }
    const bySvc = new Map<string, Record<string, number>>()
    const byF = new Map<string, Record<string, number>>()
    const totals = zero()
    for (const it of items) {
      const plan = Object.fromEntries([
        ...years.map((y) => [y, (it.byYear[y]?.budget ?? 0) / rate(y)]),
        ...months.map((m) => [m, (it.byMonth[m]?.budget ?? 0) / rate(m.slice(0, 4))]),
      ])
      addTo(totals, plan)
      const f = it.fundCode ?? '_'
      if (!byF.has(f)) byF.set(f, zero())
      addTo(byF.get(f)!, plan)
      for (const sp of it.split) {
        if (!bySvc.has(sp.code)) bySvc.set(sp.code, zero())
        addTo(bySvc.get(sp.code)!, plan, sp.weight)
      }
    }
    const domains = byService.map((d: any) => {
      const services = d.services.map((x: any) => ({ code: x.code, name: x.name, plan: bySvc.get(x.code ?? '_') ?? zero() }))
      const plan = zero()
      for (const x of services) addTo(plan, x.plan)
      return { name: d.name, plan, services }
    })
    const funds = byFund.map((f: any) => ({ code: f.code, name: f.name, appFund: f.appFund, plan: byF.get(f.code ?? '_') ?? zero() }))
    return { year: fy, years, byService: domains, byFund: funds, totals }
  }

  /** Service catalogue with the current evaluation level of the linked service (0–5, null = unknown). */
  async serviceCatalogue(communityId: string) {
    const defs = await this.prisma.budgetServiceDef.findMany({ where: { communityId }, orderBy: { sortOrder: 'asc' } })
    const items = await this.prisma.serviceItem.findMany({ where: { id: { in: defs.map((d) => d.serviceItemId).filter(Boolean) as string[] } }, select: { id: true, domain: true, name: true, sortOrder: true, level: true, status: true, assessedAt: true } })
    // Name, domain and order come from the services catalogue (the dashboard's list) when linked.
    return defs.map((d) => {
      const it = items.find((i) => i.id === d.serviceItemId)
      return { code: d.code, label: it?.name ?? d.name, name: it?.name ?? d.name, category: d.category, domain: it?.domain ?? d.domain, specCode: d.specCode,
        level: it ? satisfactionOf(it) : null, status: it?.status ?? null, assessedAt: it?.assessedAt ?? null, evaluated: !!it, catalogueOrder: it?.sortOrder ?? null }
    })
  }

  private splitOf(l: { serviceSplit?: any; serviceCode?: string | null }): Split {
    const s = (l.serviceSplit ?? null) as Split | null
    if (s?.length) return s
    return l.serviceCode ? [{ code: l.serviceCode, weight: 1 }] : [{ code: '_', weight: 1 }]
  }

  /**
   * Strategic portfolio: program → project with its financial structure. The project budget and
   * its yearly tranches come from Portofoliu; estimates, commitments and payments from the
   * project's evidence lines (Contract-Factura).
   */
  private portfolio(programs: any[], lines: any[], outLines: any[], year: number, fundName: Map<string, string>, svcLabel: (c?: string | null) => string | null) {
    const out = programs.filter((pg) => pg.dimension === 'STRATEGIC' || pg.projects.length).map((pg) => {
      const projects = pg.projects.map((p: any) => {
        const pl = lines.filter((l: any) => l.projectId === p.id)
        const ol = outLines.filter((l: any) => l.projectCode === p.code)
        const entries = pl.flatMap((l: any) => l.entries.map((e: any) => ({ ...e, area: l.area, vendor: l.vendorName })))
        const sum = (k: string, f: (e: any) => boolean = () => true) => r2(entries.filter((e: any) => e.kind === k && f(e)).reduce((s: number, e: any) => s + num(e.amount), 0))
        const budget = p.budgetAmount != null ? r2(num(p.budgetAmount)) : null
        const linesBudget = r2(ol.reduce((s: number, l: any) => s + l.metrics.budget, 0))
        const estimate = r2(ol.reduce((s: number, l: any) => s + l.metrics.estimate, 0))
        const committed = sum('COMMITMENT')
        const paid = sum('PAYMENT')
        // A project with no evidence yet is forecast at its approved budget.
        const forecast = ol.length ? r2(ol.reduce((s: number, l: any) => s + l.metrics.forecast, 0)) : r2(budget ?? 0)
        const yearPlan = Object.fromEntries(Object.entries((p.yearPlan ?? {}) as Record<string, number>).map(([y, v]) => [y, r2(num(v))]))
        const paidByYear: Record<string, number> = {}
        const paidByFund: Record<string, number> = {}
        const yearByFund: Record<string, number> = {}
        const paidByYearFund: Record<string, Record<string, number>> = {}
        const paidByMonth: Record<string, number> = {}
        const paidByMonthFund: Record<string, Record<string, number>> = {}
        let undatedPaid = 0
        for (const e of entries) if (e.kind === 'PAYMENT') {
          const amt = num(e.amount)
          if (e.date) {
            const y = String(new Date(e.date).getUTCFullYear())
            paidByYear[y] = r2((paidByYear[y] ?? 0) + amt)
            if (y === String(year)) yearByFund[e.fundCode ?? '_'] = r2((yearByFund[e.fundCode ?? '_'] ?? 0) + amt)
            const yf = (paidByYearFund[y] ??= {})
            yf[e.fundCode ?? '_'] = r2((yf[e.fundCode ?? '_'] ?? 0) + amt)
            const ym = new Date(e.date).toISOString().slice(0, 7)
            paidByMonth[ym] = r2((paidByMonth[ym] ?? 0) + amt)
            const mf = (paidByMonthFund[ym] ??= {})
            mf[e.fundCode ?? '_'] = r2((mf[e.fundCode ?? '_'] ?? 0) + amt)
          } else undatedPaid = r2(undatedPaid + amt)
          const f = e.fundCode ?? '_'
          paidByFund[f] = r2((paidByFund[f] ?? 0) + amt)
        }
        const group = (field: 'area' | 'vendor') => {
          const m = new Map<string, any>()
          for (const e of entries) {
            const k = e[field] ?? '—'
            const g = m.get(k) ?? { key: k, estimate: 0, budget: 0, committed: 0, paid: 0 }
            if (e.kind === 'ESTIMATE') { g.estimate = r2(g.estimate + num(e.amount)); if (e.inBaseline) g.budget = r2(g.budget + num(e.amount)) }
            if (e.kind === 'COMMITMENT') g.committed = r2(g.committed + num(e.amount))
            if (e.kind === 'PAYMENT') g.paid = r2(g.paid + num(e.amount))
            m.set(k, g)
          }
          return [...m.values()].map((g) => ({ ...g, remainingToPay: r2(Math.max(g.committed - g.paid, 0)) }))
        }
        const remaining = r2(Math.max(forecast - paid, 0))
        // Annual slice: this year's payments + the remaining cost spread over this and later tranches.
        const laterYears = Object.entries(yearPlan).filter(([y]) => Number(y) >= year)
        const laterTotal = laterYears.reduce((s, [, v]) => s + v, 0)
        const share = laterTotal > 0 ? (yearPlan[String(year)] ?? 0) / laterTotal : 1
        const yearActual = paidByYear[String(year)] ?? 0
        const yearForecast = r2(yearActual + remaining * share)
        const split = this.splitOf(p).map((x) => ({ ...x, label: svcLabel(x.code) }))
        const src = (p.source ?? {}) as any
        const status = paid > 0 ? 'IN_EXECUTION' : committed > 0 ? 'CONTRACTED' : budget ? 'APPROVED' : 'PROPOSED'
        return {
          code: p.code, name: p.name, scope: p.scope, programCode: pg.code, programName: pg.name,
          fundCode: p.fundCode, fundName: p.fundCode ? fundName.get(p.fundCode) ?? p.fundCode : null, fundLabel: src.fundLabel ?? null,
          voteYear: p.voteYear, durationYears: p.durationYears, status, statusLabel: labelOf(BUDGET_LINE_STATUS_META, status),
          budget, budgetEur: p.budgetEur != null ? r2(num(p.budgetEur)) : null, yearPlan,
          linesBudget, estimate, committed, paid, remainingToPay: r2(Math.max(committed - paid, 0)), forecast,
          variance: budget != null ? r2(forecast - budget) : null, paidPct: budget ? Math.round((paid / budget) * 1000) / 10 : null,
          paidByYear, paidByYearFund, paidByMonth, paidByMonthFund, undatedPaid, paidByFund: Object.entries(paidByFund).map(([code, amount]) => ({ code: code === '_' ? null : code, name: code === '_' ? null : fundName.get(code) ?? code, amount })),
          serviceSplit: split, serviceSplitNote: src.serviceSplitNote ?? null, source: src.file ? `${src.file}, foaia ${src.sheet}, rândul ${src.row}` : null,
          byArea: group('area'), byVendor: group('vendor'),
          lines: ol.map((l: any) => ({ id: l.id, code: l.code, name: l.name, area: l.area, vendorName: l.vendorName, fundName: l.fundName, status: l.status, statusLabel: l.statusLabel, metrics: l.metrics })),
          year: { year, budget: r2(yearPlan[String(year)] ?? 0), actual: r2(yearActual), forecast: yearForecast, actualByFund: yearByFund, remainingShare: Math.round(share * 1000) / 1000, overdue: laterTotal === 0 && remaining > 0 },
        }
      })
      const tot = (k: string) => r2(projects.reduce((s: number, p: any) => s + (p[k] ?? 0), 0))
      return {
        code: pg.code, name: pg.name, dimension: pg.dimension, projects,
        totals: { budget: tot('budget'), budgetEur: tot('budgetEur'), estimate: tot('estimate'), committed: tot('committed'), paid: tot('paid'), remainingToPay: tot('remainingToPay'), forecast: tot('forecast') },
      }
    })
    const years = [...new Set(out.flatMap((pg: any) => pg.projects.flatMap((p: any) => [...Object.keys(p.yearPlan), ...Object.keys(p.paidByYear)])))].sort()
    return { years, programs: out.filter((pg: any) => pg.dimension === 'STRATEGIC') }
  }

  /**
   * Fiscal-year views (model §12): the same final items — every operational/tactic line and each
   * strategic project's slice of the year — grouped by service, fund, purpose and project. The
   * three perspectives sum the same items, so their totals coincide (`check`).
   */
  private annualViews(years: string[], year: number, items: any[], serviceDefs: any[], fundPlan: FundPlanRow[], funds: any[], collectedBy: Map<string, number>, fundName: Map<string, string>,
    order: { domainRank: (n: string | null) => number; serviceRank: (c: string | null, s: number) => number; fundRank: (c: string | null) => number }, fyRate = 1) {
    type MV = { budget: number; actual: number; forecast: number }
    const zero = () => ({ budget: 0, actual: 0, forecast: 0, variance: 0, months: {} as Record<string, MV> })
    // `mon` = the same amounts per month (YYYY-MM); w = service weight.
    const add = (acc: any, b: number, a: number, f: number, mon?: Record<string, MV>, w = 1) => {
      acc.budget = r2(acc.budget + b); acc.actual = r2(acc.actual + a); acc.forecast = r2(acc.forecast + f); acc.variance = r2(acc.forecast - acc.budget)
      if (mon && acc.months) for (const [m, v] of Object.entries(mon)) {
        const t = (acc.months[m] ??= { budget: 0, actual: 0, forecast: 0 })
        t.budget = r2(t.budget + v.budget * w); t.actual = r2(t.actual + v.actual * w); t.forecast = r2(t.forecast + v.forecast * w)
      }
      return acc
    }
    const scaled = (mon: Record<string, MV>, w: number) => Object.fromEntries(Object.entries(mon).map(([m, v]) => [m, { budget: r2(v.budget * w), actual: r2(v.actual * w), forecast: r2(v.forecast * w) }]))
    const pick = (mon: Record<string, any>, f: (v: any) => MV) => Object.fromEntries(Object.entries(mon).map(([m, v]) => [m, f(v)]))
    const PURPOSES = ['RUN', 'MAINTAIN', 'TRANSFORM']
    const typeOf = (it: any) => ({ costType: it.costType ?? null, costTypeLabel: it.costType ? labelOf(BUDGET_COST_TYPE_META as any, it.costType) : null })

    // ---- by service ----
    const svcMap = new Map<string, any>()
    const svcRow = (code: string) => {
      if (!svcMap.has(code)) {
        const d = serviceDefs.find((x) => x.code === code)
        svcMap.set(code, { code: code === '_' ? null : code, name: d?.name ?? null, category: d?.category ?? null, domain: d?.domain ?? null, specCode: d?.specCode ?? null,
          level: d?.level ?? null, status: d?.status ?? null, evaluated: !!d?.evaluated, totals: zero(), byPurpose: Object.fromEntries(PURPOSES.map((p) => [p, zero()])), items: [] as any[] })
      }
      return svcMap.get(code)
    }
    for (const it of items) for (const s of it.split) {
      const row = svcRow(s.code)
      const w = s.weight
      add(row.totals, it.budget * w, it.actual * w, it.forecast * w, it.mon, w)
      add(row.byPurpose[it.purpose], it.budget * w, it.actual * w, it.forecast * w)
      row.items.push({ kind: it.kind, id: it.id, code: it.code, name: it.name, purpose: it.purpose, weight: w, fundCode: it.fundCode, fundName: it.fundCode ? fundName.get(it.fundCode) ?? it.fundCode : null,
        budget: r2(it.budget * w), actual: r2(it.actual * w), forecast: r2(it.forecast * w), live: it.live, months: scaled(it.mon, w), ...typeOf(it) })
    }
    const services = serviceDefs.map((d) => svcMap.get(d.code) ?? svcRow(d.code))
    if (svcMap.has('_')) services.push(svcMap.get('_'))
    // Domains in avizier order; inside a domain, services in avizier order, then catalogue order.
    const domMap = new Map<string, any>()
    for (const s of services) {
      const dk = s.domain ?? '—'
      const dom = domMap.get(dk) ?? { name: s.domain, totals: zero(), byPurpose: Object.fromEntries(PURPOSES.map((p) => [p, zero()])), services: [] as any[] }
      dom.services.push(s)
      add(dom.totals, s.totals.budget, s.totals.actual, s.totals.forecast, s.totals.months)
      for (const p of PURPOSES) add(dom.byPurpose[p], s.byPurpose[p].budget, s.byPurpose[p].actual, s.byPurpose[p].forecast)
      domMap.set(dk, dom)
    }
    const sortIx = new Map(serviceDefs.map((d, i) => [d.code, i]))
    const byService = [...domMap.values()]
      .map((d, i) => ({ ...d, _i: i, services: d.services.sort((a: any, b: any) => order.serviceRank(a.code, sortIx.get(a.code) ?? 999) - order.serviceRank(b.code, sortIx.get(b.code) ?? 999)) }))
      .sort((a, b) => (a.name == null ? 1 : 0) - (b.name == null ? 1 : 0) || order.domainRank(a.name) - order.domainRank(b.name) || a._i - b._i)
      .map(({ _i, ...d }) => d)

    // ---- by fund ----
    const fundRows = new Map<string, any>()
    const fundRow = (code: string) => {
      if (!fundRows.has(code)) {
        const plan = fundPlan.find((f) => f.code === code)
        const f = funds.find((x: any) => x.code === code)
        fundRows.set(code, {
          code: code === '_' ? null : code, name: code === '_' ? null : fundName.get(code) ?? code, dimension: plan?.dimension ?? (f?.allocation as any)?.type ?? null,
          appFund: !!f, target: f?.totalTarget != null ? r2(Number(f.totalTarget) / fyRate) : null, collected: collectedBy.has(code) ? r2(collectedBy.get(code)! / fyRate) : null,
          totals: zero(), items: [] as any[],
        })
      }
      return fundRows.get(code)
    }
    for (const f of fundPlan) fundRow(f.code)
    for (const it of items) {
      const home = it.fundCode ?? '_'
      // Budget and the not-yet-paid part of the forecast sit on the item's fund; actuals follow each payment's fund.
      const restF = it.forecast - it.actual
      const homeM = pick(it.mon, (v) => ({ budget: v.budget, actual: 0, forecast: r2(v.forecast - v.actual) }))
      const paidM = (fc: string) => pick(it.mon, (v) => ({ budget: 0, actual: v.actualByFund[fc] ?? 0, forecast: v.actualByFund[fc] ?? 0 }))
      add(fundRow(home).totals, it.budget, 0, restF, homeM)
      for (const [fc, a] of Object.entries(it.actualByFund as Record<string, number>)) add(fundRow(fc).totals, 0, a, a, paidM(fc))
      const touched = new Set([home, ...Object.keys(it.actualByFund)])
      for (const fc of touched) {
        const a = it.actualByFund[fc] ?? 0
        const m = zero()
        if (fc === home) add(m, 0, 0, 0, homeM)
        if (it.actualByFund[fc] != null) add(m, 0, 0, 0, paidM(fc))
        fundRow(fc).items.push({ kind: it.kind, id: it.id, code: it.code, name: it.name, purpose: it.purpose,
          budget: fc === home ? it.budget : 0, actual: r2(a), forecast: r2((fc === home ? restF : 0) + a), crossFund: fc !== home, months: m.months, ...typeOf(it) })
      }
    }
    const byFund = [...fundRows.values()].filter((f) => f.items.length || f.code)
      .map((f, i) => ({ ...f, _i: i })).sort((a, b) => order.fundRank(a.code) - order.fundRank(b.code) || a._i - b._i).map(({ _i, ...f }) => f)

    // ---- by purpose and by project / program ----
    const byPurpose = PURPOSES.map((p) => ({ code: p, totals: items.filter((i) => i.purpose === p).reduce((a, i) => add(a, i.budget, i.actual, i.forecast, i.mon), zero()) }))
    const grp = new Map<string, any>()
    for (const it of items) {
      const g = grp.get(it.groupCode) ?? { code: it.groupCode, name: it.groupName, purpose: it.purpose, project: it.kind === 'PROJECT', totals: zero(), items: [] as any[] }
      add(g.totals, it.budget, it.actual, it.forecast, it.mon)
      g.items.push({ kind: it.kind, id: it.id, code: it.code, name: it.name, purpose: it.purpose, budget: it.budget, actual: it.actual, forecast: it.forecast, months: scaled(it.mon, 1), ...typeOf(it) })
      grp.set(it.groupCode, g)
    }
    const totals = items.reduce((a, i) => add(a, i.budget, i.actual, i.forecast, i.mon), zero())
    const sumB = (rows: any[]) => r2(rows.reduce((s, r) => s + r.totals.budget, 0))
    return {
      year, years, months: years.flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`)), purposes: [
        { code: 'RUN', label: 'Run', dimension: 'OPERATIONAL' }, { code: 'MAINTAIN', label: 'Maintain', dimension: 'TACTIC' }, { code: 'TRANSFORM', label: 'Transform', dimension: 'STRATEGIC' },
      // Shown as Operațional / Tactic / Strategic (the RUN / MAINTAIN / TRANSFORM codes stay internal).
      ].map((p) => ({ ...p, label: labelOf(BUDGET_DIMENSION_META as any, p.dimension) ?? p.label, dimensionLabel: labelOf(BUDGET_DIMENSION_META as any, p.dimension) })),
      totals, byService, byFund, byPurpose, byProject: [...grp.values()],
      check: { byService: r2(services.reduce((s, x) => s + x.totals.budget, 0)), byFund: sumB(byFund), byPurpose: sumB(byPurpose), byProject: sumB([...grp.values()]), total: totals.budget },
    }
  }

  meta() {
    return {
      dimensions: BUDGET_DIMENSION_META, maintenanceKinds: BUDGET_MAINTENANCE_META, statuses: BUDGET_LINE_STATUS_META,
      entryKinds: BUDGET_ENTRY_KIND_META, services: BUDGET_SERVICE_META, metrics: BUDGET_METRIC_META, costTypes: BUDGET_COST_TYPE_META,
    }
  }

  /** Unit shares of a fund's (or expense types') last real allocation — the key the app itself billed. */
  private async sharesFromCharges(communityId: string, chargeIds: string[]) {
    if (!chargeIds.length) return new Map<string, number>()
    const rows = await this.prisma.communityChargeLine.groupBy({ by: ['unitId'], where: { chargeId: { in: chargeIds } }, _sum: { amount: true } })
    return new Map(rows.map((r) => [r.unitId, Number(r._sum.amount ?? 0)]))
  }

  private async sqmShares(communityId: string) {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select distinct on (pm.scope_id) pm.scope_id as unit_id, pm.value::float8 as value
         from period_measure pm join period p on p.id = pm.period_id
        where pm.community_id = $1 and pm.type_code = 'SQM' and pm.scope_type = 'UNIT'
        order by pm.scope_id, p.seq desc`, communityId,
    )
    return new Map(rows.map((r) => [r.unit_id, Number(r.value ?? 0)]))
  }

  /** Allocation key for a fund: its latest period's real FUND charges, else the SQM (cotă) fallback. */
  private async fundKey(communityId: string, fundCode: string) {
    const last = await this.prisma.communityCharge.findFirst({
      where: { communityId, status: 'ACTIVE', fund: { code: fundCode }, sourceType: 'FUND' },
      orderBy: { period: { seq: 'desc' } }, select: { period: { select: { id: true, code: true } } },
    })
    if (last) {
      const charges = await this.prisma.communityCharge.findMany({ where: { communityId, status: 'ACTIVE', fund: { code: fundCode }, periodId: last.period.id }, select: { id: true } })
      const weights = await this.sharesFromCharges(communityId, charges.map((x) => x.id))
      if ([...weights.values()].some((v) => v > 0)) return { weights, referencePeriod: last.period.code, source: 'CHARGES' as const }
    }
    return { weights: await this.sqmShares(communityId), referencePeriod: null, source: 'SQM' as const }
  }

  async getLine(communityId: string, lineId: string) {
    const c = await this.resolveCommunityId(communityId)
    const line: any = await this.prisma.budgetLine.findFirst({
      where: { id: lineId, communityId: c.id }, include: { entries: { orderBy: [{ date: 'asc' }, { sourceRow: 'asc' }] }, project: { include: { program: true } }, version: true },
    })
    if (!line) throw new NotFoundException('Budget line not found')
    const year = line.version.fiscalYear
    const periods = await this.periodsByCode(c.id)
    const funds = await this.prisma.fund.findMany({ where: { communityId: c.id }, select: { code: true, name: true, allocation: true } })
    const fundPlan = ((line.version as any).fundPlan ?? []) as FundPlanRow[]
    const fundName = new Map<string, string>([...fundPlan.map((f) => [f.code, f.label] as [string, string]), ...funds.map((f) => [f.code, f.name] as [string, string])])
    const defs = await this.prisma.budgetServiceDef.findMany({ where: { communityId: c.id }, select: { code: true, name: true } })

    const live = line.actualSource?.type === 'EXPENSE_TYPES'
    const charges = live ? await this.expenseCharges(c.id, line.actualSource.fundCode ?? 'EXPENSES') : []
    const months = live ? this.liveMonths(line, year, charges, periods) : null
    const metrics = this.metricsFor(line, months)

    // ---- per-unit calculation ----
    const units = await this.prisma.unit.findMany({ where: { communityId: c.id }, select: { id: true, code: true, name: true, type: true, order: true }, orderBy: [{ order: 'asc' }, { code: 'asc' }] })
    let method: { label: string; source: string; referencePeriod: string | null; detail: string }
    let weights: Map<string, number>
    const actualByUnit = new Map<string, number>()
    if (live) {
      const codes = new Set<string>(line.actualSource.codes ?? [])
      const mine = charges.filter((ch) => !codes.size || codes.has(ch.expenseType))
      const closedSeqDesc = [...new Set(mine.filter((ch) => ch.periodStatus === 'CLOSED').map((ch) => `${ch.periodSeq}|${ch.periodCode}`))].sort((a, b) => Number(b.split('|')[0]) - Number(a.split('|')[0]))
      const ref = closedSeqDesc[0]?.split('|')[1] ?? null
      weights = await this.sharesFromCharges(c.id, mine.filter((ch) => ch.periodCode === ref).map((ch) => ch.chargeId))
      const yearIds = mine.filter((ch) => ch.periodStatus === 'CLOSED' && ch.periodCode.startsWith(`${year}-`)).map((ch) => ch.chargeId)
      for (const [u, v] of await this.sharesFromCharges(c.id, yearIds)) actualByUnit.set(u, v)
      const ets = await this.prisma.expenseType.findMany({ where: { communityId: c.id, code: { in: [...codes] } }, select: { code: true, name: true, rule: { select: { id: true, method: true } } } })
      method = {
        label: codes.size
          ? [...new Set(ets.map((e) => `${e.name}: ${e.rule.method}`))].join(' · ')
          : `${fundName.get(line.actualSource.fundCode) ?? line.actualSource.fundCode}: ${(funds.find((f) => f.code === line.actualSource.fundCode)?.allocation as any)?.method ?? ''}`,
        source: 'CHARGES', referencePeriod: ref,
        detail: 'Cota unității = suma repartizată unității în luna de referință ÷ totalul lunii (aceeași cheie pe care o aplică avizierul). Actualul pe unitate este suma reală facturată în lunile închise ale exercițiului.',
      }
    } else {
      const key = line.fundCode && line.fundCode !== 'EXPENSES' ? await this.fundKey(c.id, line.fundCode) : { weights: await this.sqmShares(c.id), referencePeriod: null, source: 'SQM' as const }
      weights = key.weights
      const alloc = funds.find((f) => f.code === line.fundCode)?.allocation as any
      method = {
        label: key.source === 'CHARGES' ? `${fundName.get(line.fundCode) ?? line.fundCode}: ${alloc?.method ?? ''}${alloc?.split ? ` (${alloc.split})` : ''}` : 'Cotă-parte indiviză (mp)',
        source: key.source, referencePeriod: key.referencePeriod,
        detail: key.source === 'CHARGES'
          ? 'Cota unității = contribuția unității la fond în luna de referință ÷ totalul lunii (cheia de repartizare a fondului). Suma pe unitate = valoarea liniei × cotă.'
          : 'Fondul nu are încă o repartizare reală; se folosește cota-parte indiviză (suprafața utilă / total). Suma pe unitate = valoarea liniei × cotă.',
      }
      // Payments from several funds: each payment follows its own fund's key.
      const byFund = metrics.paidByFund
      const fundKeys = new Map<string, Map<string, number>>()
      for (const fc of Object.keys(byFund)) if (fc !== '_' && fc !== line.fundCode) fundKeys.set(fc, (await this.fundKey(c.id, fc)).weights)
      const totalW = [...weights.values()].reduce((s, v) => s + v, 0)
      for (const u of units) {
        let a = 0
        for (const [fc, amt] of Object.entries(byFund)) {
          const w = fc === '_' || fc === line.fundCode ? weights : fundKeys.get(fc)!
          const tw = fc === '_' || fc === line.fundCode ? totalW : [...w.values()].reduce((s, v) => s + v, 0)
          if (tw > 0) a += amt * ((w.get(u.id) ?? 0) / tw)
        }
        actualByUnit.set(u.id, a)
      }
    }
    const totalWeight = [...weights.values()].reduce((s, v) => s + v, 0)
    const unitRows = units
      .map((u) => {
        const w = weights.get(u.id) ?? 0
        const share = totalWeight > 0 ? w / totalWeight : 0
        return {
          unitCode: u.code, unitName: u.name, unitType: u.type, weight: r2(w), sharePct: Math.round(share * 1e6) / 1e4,
          budget: r2(metrics.budget * share), actual: r2(actualByUnit.get(u.id) ?? 0), forecast: r2(metrics.forecast * share),
        }
      })
      .filter((r) => r.weight !== 0 || r.actual !== 0)
    const unitTotals = unitRows.reduce((a, r) => ({ budget: r2(a.budget + r.budget), actual: r2(a.actual + r.actual), forecast: r2(a.forecast + r.forecast), sharePct: r2(a.sharePct + r.sharePct) }), { budget: 0, actual: 0, forecast: 0, sharePct: 0 })

    return {
      meta: this.meta(),
      line: {
        id: line.id, code: line.code, name: line.name, dimension: line.dimension,
        dimensionLabel: labelOf(BUDGET_DIMENSION_META as any, line.dimension),
        maintenanceKind: line.maintenanceKind, maintenanceKindLabel: labelOf(BUDGET_MAINTENANCE_META, line.maintenanceKind),
        serviceCode: line.serviceCode, serviceLabel: defs.find((d) => d.code === line.serviceCode)?.name ?? labelOf(BUDGET_SERVICE_META, line.serviceCode), area: line.area,
        serviceSplit: this.splitOf(line).map((x) => ({ ...x, label: defs.find((d) => d.code === x.code)?.name ?? x.code })),
        project: line.project ? { code: line.project.code, name: line.project.name, program: line.project.program ? { code: line.project.program.code, name: line.project.program.name } : null } : null,
        fundCode: line.fundCode, fundName: line.fundCode ? fundName.get(line.fundCode) ?? line.fundCode : null,
        vendorName: line.vendorName, documentRef: line.documentRef, status: line.status, statusLabel: labelOf(BUDGET_LINE_STATUS_META, line.status),
        quantity: line.quantity != null ? Number(line.quantity) : null, unitOfMeasure: line.unitOfMeasure, unitRate: line.unitRate != null ? Number(line.unitRate) : null,
        assumption: line.assumption, basis: line.basis, actualSource: line.actualSource, fiscalYear: year,
      },
      metrics,
      months,
      entries: line.entries.map((e: any) => ({
        id: e.id, kind: e.kind, kindLabel: labelOf(BUDGET_ENTRY_KIND_META, e.kind), date: e.date, amount: r2(num(e.amount)),
        fundCode: e.fundCode, fundName: e.fundCode ? fundName.get(e.fundCode) ?? e.fundCode : null,
        documentRef: e.documentRef, description: e.description, note: e.note, inBaseline: e.inBaseline, source: e.source, sourceRow: e.sourceRow,
      })),
      units: { method, rows: unitRows, totals: unitTotals },
    }
  }
}
