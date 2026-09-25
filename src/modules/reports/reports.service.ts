import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { resolveBeName } from '../../common/billing-entity-name.util'
import { AVIZIER_FUND_GROUP_META, FUND_DOMAIN_META, RISK_TIER_META } from '../../common/enums-meta'
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
 *
 * That is `basis: 'end'` (used by the forecast). The report itself defaults to `basis: 'due'`, so
 * its "Restant" is the SAME figure the avizier / restanțieri / risc de expunere show —
 * `due_start(P) − payments(P)`, i.e. arrears actually due, without P's own freshly-issued
 * charges (not due yet): P's charges/adjustments are left out of owed/charges, P's payments
 * are kept, and the identity `owed − paid == outstanding` still holds exactly.
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
  /** CPI per UNIT at period P — same "latest SQM measure at or before P" rule as `cpiByBe`. */
  private async cpiByUnitId(communityId: string, seq: number): Promise<Map<string, number>> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select distinct on (pm.scope_id) pm.scope_id as unit_id, pm.value::float8 as value
         from period_measure pm
         join period p on p.id = pm.period_id
        where pm.community_id = $1 and pm.type_code = 'SQM' and pm.scope_type = 'UNIT'
        order by pm.scope_id,
                 (p.seq <= $2) desc,
                 case when p.seq <= $2 then -p.seq else p.seq end asc`,
      communityId, seq,
    )
    return new Map(rows.map((r) => [r.unit_id, Number(r.value ?? 0)]))
  }

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

  async collectionRate(communityId: string, periodCode?: string, domain?: string, opts: { basis?: 'due' | 'end'; groupBy?: 'be' | 'unit' } = {}) {
    const dueBasis = (opts.basis ?? 'due') === 'due'
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
      opening: number; charges: number; payments: number; adjustments: number; dueEnd: number; dueAtLast: number
    }
    // Shared by the BE-grain rows (be_statement) and the unit-grain rows (be_unit_statement).
    const accumulate = (cells: Map<string, Cell>, key: string, ownerId: string, r: any) => {
      let c = cells.get(key)
      if (!c) {
        c = {
          beId: ownerId, fundCode: r.fund_code,
          firstSeq: r.seq, lastSeq: r.seq,
          opening: Number(r.due_start), charges: 0, payments: 0, adjustments: 0, dueEnd: Number(r.due_end), dueAtLast: 0,
        }
        cells.set(key, c)
      }
      // Rows arrive in ascending seq, so the first row seen carries the opening balance and the
      // last one the closing balance. A (be, fund) pair that stops before P keeps its final
      // due_end rather than silently reporting 0 outstanding.
      if (r.seq < c.firstSeq) { c.firstSeq = r.seq; c.opening = Number(r.due_start) }
      if (r.seq >= c.lastSeq) { c.lastSeq = r.seq; c.dueEnd = Number(r.due_end); c.dueAtLast = Number(r.due_start) - Number(r.payments) }
      // 'due' basis: P's own charges/adjustments aren't due yet — leave them out (see class doc).
      if (!(dueBasis && r.seq === pSeq)) {
        c.charges += Number(r.charges)
        c.adjustments += Number(r.adjustments)
      }
      c.payments += Number(r.payments)
    }
    const cells = new Map<string, Cell>()
    for (const r of scoped) accumulate(cells, `${r.be_id}::${r.fund_code}`, r.be_id, r)

    const metricOf = (c: Cell) => {
      const owed = c.opening + c.charges + c.adjustments
      const paid = c.payments
      // opening/charges/adjustments are surfaced so every level can show what makes up `owed`
      // (owed = opening + charges + adjustments) — charges is the actual billing, distinct from
      // balance re-basings/reconciliations that land in adjustments.
      const outstanding = dueBasis && c.lastSeq === pSeq ? c.dueAtLast : c.dueEnd
      return { owed, paid, outstanding, opening: c.opening, charges: c.charges, adjustments: c.adjustments }
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

    // Billing-entity rows. Name/displayName resolved as of P (same as the avizier), plus the BE's
    // active unit codes at P — the frontend labels rows exactly like the avizier (beLabel).
    const beInfo = new Map<string, any>()
    for (const r of scoped) if (!beInfo.has(r.be_id)) beInfo.set(r.be_id, r)
    const beIds = [...byBe.keys()]
    const nameHist = await this.prisma.billingEntityNameHistory.findMany({
      where: { billingEntityId: { in: beIds } },
      select: { billingEntityId: true, name: true, displayName: true, startSeq: true, endSeq: true },
    })
    const nameHistByBe = new Map<string, { name: string; displayName: string | null; startSeq: number; endSeq: number | null }[]>()
    for (const h of nameHist) nameHistByBe.set(h.billingEntityId, [...(nameHistByBe.get(h.billingEntityId) ?? []), h])
    const members = await this.prisma.billingEntityMember.findMany({
      where: { billingEntityId: { in: beIds }, startSeq: { lte: pSeq }, OR: [{ endSeq: null }, { endSeq: { gte: pSeq } }] },
      select: { billingEntityId: true, unit: { select: { code: true } } },
    })
    const unitCodesByBe = new Map<string, string[]>()
    for (const m of members) if (m.unit) unitCodesByBe.set(m.billingEntityId, [...(unitCodesByBe.get(m.billingEntityId) ?? []), m.unit.code])
    const rows = [...byBe.values()]
      .map((a) => {
        const info = beInfo.get(a.beId)
        const resolved = resolveBeName({ id: a.beId, name: info?.be_name ?? '', displayName: info?.be_display_name ?? null }, pSeq, nameHistByBe)
        return {
          beId: a.beId,
          code: info?.be_code ?? null,
          beName: resolved.name || null,
          beDisplayName: resolved.displayName ?? null,
          unitCodes: unitCodesByBe.get(a.beId) ?? [],
          displayName: resolved.displayName || resolved.name || info?.be_code || a.beId,
          order: Number(info?.be_order ?? 0),
          cpi: round2(cpi.get(a.beId) ?? 0),
          ...shape(a),
          byFund: Object.fromEntries(
            Object.entries(byBeFund.get(a.beId) ?? {}).map(([code, m]) => [code, shape(m)]),
          ),
        }
      })
      .sort((x, y) => x.order - y.order || String(x.displayName).localeCompare(String(y.displayName)))

    // Unit-grain rows ("Pe unitate"). be_unit_statement is NOT a reliable per-unit ledger on its own:
    // payments are only recorded at billing-entity grain, so its payments column misses most of
    // them (Ap 5 (I-A), 2026-07: 29.112,92 paid at BE level, 154,17 on the unit row). Same rule the
    // restanțieri / risc de expunere / avizier unit views already apply:
    //   - single-unit entity  → the unit IS the entity: its row carries the BE's own figures;
    //   - multi-unit entity   → the per-unit split from be_unit_statement, but only when it sums
    //     back to the BE's own restant (isUnitSplitTrusted); otherwise the BE's figures are split
    //     by each unit's CPI share and the row is flagged `estimated`.
    // So unit rows always add up to the entity rows, and to the totals. For a multi-unit entity
    // only the RESTANT is meaningful per unit (`restantOnly`): per-unit tracking starts later than
    // the entity's own history and carries no payments, so Facturat/Plătit/Grad per unit would be
    // wrong — the UI shows just Restant for those rows.
    let unitRows: any[] = []
    if (opts.groupBy === 'unit') {
      const memberUnits = await this.prisma.billingEntityMember.findMany({
        where: { billingEntityId: { in: beIds }, startSeq: { lte: pSeq }, OR: [{ endSeq: null }, { endSeq: { gte: pSeq } }] },
        select: { billingEntityId: true, unit: { select: { id: true, code: true, order: true } } },
      })
      const unitsOfBe = new Map<string, { id: string; code: string; order: number }[]>()
      for (const m of memberUnits) if (m.unit) unitsOfBe.set(m.billingEntityId, [...(unitsOfBe.get(m.billingEntityId) ?? []), m.unit])
      const multiUnitIds = [...unitsOfBe.values()].filter((us) => us.length > 1).flat().map((u) => u.id)
      const ucells = new Map<string, Cell>()
      if (multiUnitIds.length) {
        const ustmts: any[] = await (this.prisma as any).$queryRawUnsafe(
          `select bus.unit_id as unit_id, f.code as fund_code, p.seq as seq,
                  bus.due_start::float8 as due_start, bus.charges::float8 as charges,
                  bus.payments::float8 as payments, bus.adjustments::float8 as adjustments, bus.due_end::float8 as due_end
             from be_unit_statement bus
             join period p on p.id = bus.period_id
             join fund f on f.id = bus.fund_id
            where bus.community_id = $1 and p.seq <= $2 and bus.unit_id = any($3::text[])
            order by p.seq asc`,
          communityId, pSeq, multiUnitIds,
        )
        for (const r of ustmts) if (inScope(r.fund_code)) accumulate(ucells, `${r.unit_id}::${r.fund_code}`, r.unit_id, r)
      }
      const unitCpi = multiUnitIds.length ? await this.cpiByUnitId(communityId, pSeq) : new Map<string, number>()
      const scaled = (m: any, k: number) => ({ owed: m.owed * k, paid: m.paid * k, outstanding: m.outstanding * k, opening: m.opening * k, charges: m.charges * k, adjustments: m.adjustments * k })
      for (const beRow of rows) {
        const units = (unitsOfBe.get(beRow.beId) ?? []).slice().sort((a, b) => a.order - b.order)
        if (!units.length) continue
        const base = { beCode: beRow.code, beName: beRow.beName }
        if (units.length === 1) {
          const u = units[0]
          unitRows.push({ unitId: u.id, unitCode: u.code, order: u.order, ...base, estimated: false, restantOnly: false, ...pickMetric(beRow), byFund: beRow.byFund })
          continue
        }
        const perUnit = units.map((u) => {
          const byFund: Record<string, any> = {}
          const acc = newAcc()
          for (const [key, c] of ucells) {
            if (!key.startsWith(`${u.id}::`)) continue
            const m = metricOf(c)
            add(acc, m)
            byFund[c.fundCode] = shape({ ...newAcc(), ...m } as Acc)
          }
          return { u, acc, byFund }
        })
        const trusted = isUnitSplitTrusted(perUnit.reduce((s2, x) => s2 + x.acc.outstanding, 0), beRow.outstanding)
        const cpiSum = units.reduce((s2, u) => s2 + (unitCpi.get(u.id) ?? 0), 0)
        for (const x of perUnit) {
          if (trusted) {
            unitRows.push({ unitId: x.u.id, unitCode: x.u.code, order: x.u.order, ...base, estimated: false, restantOnly: true, ...shape(x.acc), byFund: x.byFund })
          } else {
            const k = cpiSum > 0 ? (unitCpi.get(x.u.id) ?? 0) / cpiSum : 1 / units.length
            unitRows.push({
              unitId: x.u.id, unitCode: x.u.code, order: x.u.order, ...base, estimated: true, restantOnly: true,
              ...shape(scaled(beRow, k) as Acc),
              byFund: Object.fromEntries(Object.entries<any>(beRow.byFund).map(([code, m]) => [code, shape(scaled(m, k) as Acc)])),
            })
          }
        }
      }
      unitRows.sort((a, b) => a.order - b.order || String(a.unitCode).localeCompare(String(b.unitCode)))
    }

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

    const perPeriod = new Map<number, { code: string; status: string; charges: number; payments: number; adjustments: number; dueEnd: number; due: number }>()
    for (const r of scoped) {
      const e = getOr(perPeriod, r.seq, () => ({ code: r.period_code, status: r.period_status, charges: 0, payments: 0, adjustments: 0, dueEnd: 0, due: 0 }))
      e.charges += Number(r.charges)
      e.payments += Number(r.payments)
      e.adjustments += Number(r.adjustments)
      e.dueEnd += Number(r.due_end)
      e.due += Number(r.due_start) - Number(r.payments)
    }
    // 'due' basis: at each period s, charges/adjustments count only through s−1 (s's own aren't due
    // yet) and the point's outstanding is Σ(due_start − payments) at s — same rule as the detail.
    let owedCum = 0, paidCum = 0, openCum = 0, chargesCum = 0, adjCum = 0, prevOwed = 0, prevPaid = 0
    const history = [...perPeriod.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, e]) => {
        const openThis = openingAtSeq.get(seq) ?? 0
        openCum += openThis
        paidCum += e.payments
        if (!dueBasis) { chargesCum += e.charges; adjCum += e.adjustments }
        owedCum = openCum + chargesCum + adjCum
        const point = {
          periodCode: e.code,
          status: e.status,
          ...shape({ owed: owedCum, paid: paidCum, outstanding: dueBasis ? e.due : e.dueEnd, opening: openCum, charges: chargesCum, adjustments: adjCum }),
          deltaOwed: round2(owedCum - prevOwed),
          deltaPaid: round2(paidCum - prevPaid),
        }
        prevOwed = owedCum; prevPaid = paidCum
        if (dueBasis) { chargesCum += e.charges; adjCum += e.adjustments }
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
      unitRows,
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
    const beMeta = await this.prisma.billingEntity.findMany({ where: { id: { in: Array.from(unitsByBe.keys()) } }, select: { id: true, code: true, name: true, displayName: true, order: true } })
    // displayName as of this period (same resolution as the avizier) — the owner row's label, e.g.
    // "AP 12" for a 3-unit entity, so this report names entities exactly like the avizier does.
    const beNameHistory = await this.prisma.billingEntityNameHistory.findMany({
      where: { billingEntityId: { in: Array.from(unitsByBe.keys()) } },
      select: { billingEntityId: true, name: true, displayName: true, startSeq: true, endSeq: true },
    })
    const beNameHistoryByBe = new Map<string, { name: string; displayName: string | null; startSeq: number; endSeq: number | null }[]>()
    for (const h of beNameHistory) beNameHistoryByBe.set(h.billingEntityId, [...(beNameHistoryByBe.get(h.billingEntityId) ?? []), h])
    const beMetaById = new Map(beMeta.map((b) => [b.id, { ...b, ...resolveBeName(b, per?.seq ?? 0, beNameHistoryByBe) }]))
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
          beId: o.beId, beCode: o.beCode, beName: beMetaById.get(o.beId)?.name ?? null, displayName: beMetaById.get(o.beId)?.displayName ?? null,
          unitCodes: unitCodesMap.get(o.beId) ?? [],
          byFund: o.byFund, outstanding, weightedAgeDays: weightedAge(allSlices),
          order: beMetaById.get(o.beId)?.order ?? 0,
        }
      })
    for (const beId of unitsByBe.keys()) {
      if (byOwner.has(beId)) continue
      const meta = beMetaById.get(beId)
      owners.push({
        beId, beCode: meta?.code ?? '', beName: meta?.name ?? null, displayName: meta?.displayName ?? null,
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

  /** The newest CLOSED period — `forecastReport`'s base: a PREPARED period is still a draft. */
  private async latestClosedPeriod(communityId: string) {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select id, code, seq, status, afisare_date as "afisareDate", due_date as "dueDate"
         from period where community_id = $1 and status = 'CLOSED' order by seq desc limit 1`,
      communityId,
    )
    return rows?.[0] ?? null
  }

  /** The newest period row, whatever its status — unlike `latestStatementPeriod` (which prefers
   *  CLOSED), `forecastReport` wants the period that's still ABOUT to become due. */
  private async latestPeriod(communityId: string) {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select id, code, seq, status, afisare_date as "afisareDate", due_date as "dueDate"
         from period where community_id = $1 order by seq desc limit 1`,
      communityId,
    )
    return rows?.[0] ?? null
  }

  /**
   * Unit-grain counterpart to `collectionRate`'s own (billing entity, fund) accumulation — same
   * owed/paid/outstanding formula (opening of the first tracked period + Σcharges + Σadjustments,
   * Σpayments, due_end of the last tracked period), just walked over `be_unit_statement` instead of
   * `be_statement`. Used only for `forecastReport`'s "Unitate" mode, where collectionRate itself has
   * no per-unit breakdown (BE-grain only). `be_unit_statement` is "populated only where real
   * per-unit data exists" (see its schema comment) — a unit with no rows simply yields no metric for
   * that fund, same as `collectionRate` would for a fund a BE never touched.
   */
  private async unitCollectionMetrics(
    communityId: string, unitId: string, uptoSeq: number, fundIds: string[], fundCodeById: Map<string, string>,
  ): Promise<Map<string, { owed: number; paid: number; outstanding: number }>> {
    const periods = await this.prisma.period.findMany({
      where: { communityId, seq: { lte: uptoSeq } }, select: { id: true, seq: true },
    })
    const seqByPeriodId = new Map(periods.map((p) => [p.id, p.seq]))
    const rows = await this.prisma.beUnitStatement.findMany({
      where: { communityId, unitId, fundId: { in: fundIds }, periodId: { in: periods.map((p) => p.id) } },
      select: { fundId: true, periodId: true, dueStart: true, charges: true, payments: true, adjustments: true, dueEnd: true },
    })
    type Cell = { firstSeq: number; lastSeq: number; opening: number; charges: number; payments: number; adjustments: number; dueEnd: number }
    const cells = new Map<string, Cell>()
    for (const r of rows) {
      const seq = seqByPeriodId.get(r.periodId)
      if (seq == null) continue
      let c = cells.get(r.fundId)
      if (!c) { c = { firstSeq: seq, lastSeq: seq, opening: Number(r.dueStart), charges: 0, payments: 0, adjustments: 0, dueEnd: Number(r.dueEnd) }; cells.set(r.fundId, c) }
      if (seq < c.firstSeq) { c.firstSeq = seq; c.opening = Number(r.dueStart) }
      if (seq >= c.lastSeq) { c.lastSeq = seq; c.dueEnd = Number(r.dueEnd) }
      c.charges += Number(r.charges)
      c.payments += Number(r.payments)
      c.adjustments += Number(r.adjustments)
    }
    const out = new Map<string, { owed: number; paid: number; outstanding: number }>()
    for (const [fundId, c] of cells) {
      const code = fundCodeById.get(fundId)
      if (code) out.set(code, { owed: round2(c.opening + c.charges + c.adjustments), paid: round2(c.payments), outstanding: round2(c.dueEnd) })
    }
    return out
  }

  /**
   * Restanță + N-month cost forecast for one unit or one owner (billing entity) — a bill preview,
   * not a debt-collection report. Row 0 is the CURRENT period — the newest CLOSED one, i.e. the last
   * bill actually issued (a PREPARED period is still a draft) — and folds in every prior restanță
   * via `reconcileCommunity`, which already excludes that period's own charge (see its own doc) — so
   * adding that period's own charge on top double-counts nothing. Rows 1..months-1 carry no restanță
   * component, since row 0 already carries all of it: a PREPARED (draft) period among them shows its
   * own generated charges, flagged `draft` and unconfirmed; the rest are pure projections.
   *
   * Fund columns (Rulment/Reparații/Reabilitare 1/2/3) are projected from the LAST actual charge
   * line this target had on that fund. These are configurator-driven quotas (`Fund.targetPlan`
   * split by cotă) that don't change month to month in practice (verified against Kralik's own
   * charge history: Rulment/Reparații/Reabilitare 3 are identical to the cent across periods for
   * a stable unit), so "last real invoice" already reflects the configurator's own output, without
   * reimplementing the cotă split here. `EXPENSES` ("Cheltuieli Întreținere") is the one column
   * genuinely called out as an ESTIMATE — a trailing average of `EXPENSES_AVG_WINDOW` periods —
   * since utilities/services vary month to month by design (Kralik: 27–316 lei swings).
   */
  async forecastReport(communityId: string, opts: { months?: number; unitCode?: string; beCode?: string }) {
    const months = Math.max(1, Math.min(24, Math.round(opts.months ?? 3)))
    if (!opts.unitCode && !opts.beCode) throw new BadRequestException('unitCode or beCode is required')

    // Row 0 is the newest CLOSED period — the last bill actually issued. A PREPARED (or OPEN) period
    // after it is still a draft: it shows up further down as a draft row, never as the base.
    const current = (await this.latestClosedPeriod(communityId)) ?? (await this.latestPeriod(communityId))
    if (!current) return { months, target: null, current: null, expensesLabel: null, penaltiesLabel: null, fundColumns: [], fundsInfo: [], groupTotals: [], grandTotalCollected: 0, rows: [], assumptions: [] }

    let unitIds: string[]
    let target: { type: 'unit' | 'be'; code: string; name: string | null }
    let targetBeId: string | null = null // set only in 'be' mode — used to read BeStatement.dueEnd directly
    if (opts.unitCode) {
      const unit = await this.prisma.unit.findFirst({ where: { communityId, code: opts.unitCode }, select: { id: true, code: true, name: true } })
      if (!unit) throw new NotFoundException('Unit not found')
      unitIds = [unit.id]
      target = { type: 'unit', code: unit.code, name: unit.name }
    } else {
      const be = await this.prisma.billingEntity.findFirst({ where: { communityId, code: opts.beCode }, select: { id: true, code: true, name: true } })
      if (!be) throw new NotFoundException('Billing entity not found')
      const members = await this.prisma.billingEntityMember.findMany({
        where: { billingEntityId: be.id, startSeq: { lte: current.seq }, OR: [{ endSeq: null }, { endSeq: { gte: current.seq } }] },
        select: { unitId: true },
      })
      unitIds = members.map((m) => m.unitId)
      target = { type: 'be', code: be.code, name: be.name }
      targetBeId = be.id
    }

    const FUND_COLUMNS = ['RULMENT', 'REPARATII', 'REABILITARE_1', 'REABILITARE_2', 'REABILITARE_3']
    const EXPENSES_AVG_WINDOW = 3
    const HISTORY_LOOKBACK = 6 // periods examined for "last actual" / trailing average

    const funds = await this.prisma.fund.findMany({
      where: { communityId },
      select: { id: true, code: true, name: true, targetPlan: true, startPeriodCode: true, totalTarget: true, allocation: true },
    })
    const fundCodeById = new Map(funds.map((f) => [f.id, f.code]))
    const fundIdByCode = new Map(funds.map((f) => [f.code, f.id]))
    const fundNameByCode = new Map(funds.map((f) => [f.code, f.name]))
    // Names, not hardcoded labels — the frontend renders whatever the community's own fund
    // configurator calls these (CLAUDE.md rule: no domain knowledge baked into the UI).
    const fundColumns = FUND_COLUMNS.map((code) => ({ code, name: fundNameByCode.get(code) ?? code }))
    const expensesLabel = fundNameByCode.get('EXPENSES') ?? 'EXPENSES'
    const penaltiesLabel = fundNameByCode.get('PENALIZARI') ?? 'PENALIZARI'

    const periodOrdinal = (code: string): number | null => {
      const m = /^(\d{4})-(\d{2})$/.exec(code)
      return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null
    }
    const ordinalToPeriodCode = (n: number): string => {
      const y = Math.floor(n / 12)
      const mo = ((n % 12) + 12) % 12
      return `${y}-${String(mo + 1).padStart(2, '0')}`
    }
    const currentOrd = periodOrdinal(current.code)!

    // Same coarse bucket the avizier itself uses (finance.service.ts's superGroupKeyOf): a fund's
    // domain (Fund.allocation.type — Operational/Tactic/Strategic) drives Întreținere vs Fond
    // Operațional vs Fond Reabilitare, with the community's own admin overrides (avizierConfig)
    // winning when set — so this forecast's grouping never disagrees with what the avizier shows.
    const community = await this.prisma.community.findUnique({ where: { id: communityId }, select: { features: true } })
    const avizierCfg = ((community?.features as any)?.avizierConfig ?? {}) as any
    const fundGroupOverrides = avizierCfg.fundGroupOverrides && typeof avizierCfg.fundGroupOverrides === 'object' ? avizierCfg.fundGroupOverrides : {}
    const fundGroupLabels = avizierCfg.fundGroupLabels && typeof avizierCfg.fundGroupLabels === 'object' ? avizierCfg.fundGroupLabels : {}
    const superGroupMetaByKey = new Map(AVIZIER_FUND_GROUP_META.map((g) => [g.key, g]))
    const fundDomainByCode = new Map(funds.map((f) => [f.code, String((f.allocation as any)?.type ?? '').trim().toLowerCase()]))
    const groupOf = (code: string): { key: string; label: string } => {
      const key = fundGroupOverrides[code]
        ?? (code === 'EXPENSES' ? 'intretinere'
          : code === 'PENALIZARI' ? 'intretinere'
            : fundDomainByCode.get(code) === 'strategic' ? 'reabilitare'
              : 'operational')
      return { key, label: fundGroupLabels[key] ?? superGroupMetaByKey.get(key)?.label ?? key }
    }

    // Community-wide, all-time charge history per fund — powers both the window/closed detection
    // below and the "total colectat" figure. Unlike the per-target lookback further down, this is
    // NOT scoped to `unitIds`: "has this fund finished collecting" is a fact about the fund, not
    // about whichever unit/owner this forecast happens to be for.
    const fundColumnIds = FUND_COLUMNS.map((c) => fundIdByCode.get(c)).filter((x): x is string => !!x)
    const allTimeFundLines = await this.prisma.communityChargeLine.findMany({
      where: { communityId, charge: { fundId: { in: fundColumnIds } } },
      select: { amount: true, charge: { select: { fundId: true } }, period: { select: { code: true, seq: true } } },
    })
    const fundHistory = new Map<string, Map<string, number>>() // fundCode -> periodCode -> amount
    for (const l of allTimeFundLines) {
      const code = l.charge.fundId ? fundCodeById.get(l.charge.fundId) : null
      if (!code) continue
      const m = fundHistory.get(code) ?? new Map<string, number>()
      m.set(l.period.code, (m.get(l.period.code) ?? 0) + Number(l.amount))
      fundHistory.set(code, m)
    }

    type FundWindow = { startPeriodCode: string; endPeriodCode: string; periodCount: number; derived: boolean; closed: boolean }
    const fundWindowByCode = new Map<string, FundWindow>()
    const fundTotalCollected = new Map<string, number>()
    for (const code of FUND_COLUMNS) {
      const hist = [...(fundHistory.get(code)?.entries() ?? [])]
        .map(([periodCode, amount]) => ({ periodCode, amount: round2(amount), ord: periodOrdinal(periodCode) }))
        .filter((h) => h.ord != null && h.amount > 0.005)
        .sort((a, b) => a.ord! - b.ord!)
      fundTotalCollected.set(code, round2(hist.reduce((s, h) => s + h.amount, 0)))

      const fund = funds.find((f) => f.code === code)
      const plan = fund?.targetPlan as any
      const formalStartOrd = fund?.startPeriodCode ? periodOrdinal(fund.startPeriodCode) : null
      if (fund?.startPeriodCode && plan && typeof plan.periodCount === 'number' && formalStartOrd != null) {
        // Formal configurator plan — trust it even if the ledger tells a slightly different story.
        const endOrd = formalStartOrd + plan.periodCount - 1
        fundWindowByCode.set(code, {
          startPeriodCode: fund.startPeriodCode, endPeriodCode: ordinalToPeriodCode(endOrd),
          periodCount: plan.periodCount, derived: false, closed: endOrd < currentOrd,
        })
      } else if (hist.length) {
        // No formal start/duration configured (e.g. Reabilitare 2 here) — derive the window from
        // the real charge history instead of guessing "always active", which was wrong: a fund
        // that stopped being charged periods ago is finished, not indefinitely ongoing.
        const startOrd = hist[0].ord!, endOrd = hist[hist.length - 1].ord!
        fundWindowByCode.set(code, {
          startPeriodCode: hist[0].periodCode, endPeriodCode: hist[hist.length - 1].periodCode,
          periodCount: hist.length, derived: true, closed: endOrd < currentOrd,
        })
      }
      // Never charged at all, ever — no window to report; `fundActiveAt` treats this as active
      // (harmless: with no history, `lastActual`/`projectFund` already project 0 regardless).
    }
    const fundActiveAt = (fundCode: string, periodCode: string): boolean => {
      const win = fundWindowByCode.get(fundCode)
      if (!win) return true
      const ord = periodOrdinal(periodCode)
      const startOrd = periodOrdinal(win.startPeriodCode)
      const endOrd = periodOrdinal(win.endPeriodCode)
      if (ord == null || startOrd == null || endOrd == null) return true
      return ord >= startOrd && ord <= endOrd
    }

    // Încasat/Restanță/Colectat/Țintă per fund, at two scopes (association-wide and the currently
    // selected unit/owner). Reuses `collectionRate`'s own owed/paid/outstanding accumulation
    // (owed = opening + Σcharges + Σadjustments, paid = Σpayments, outstanding = due_end(P)) rather
    // than deriving Încasat from `totalCollected` (community_charge_line only): a unit/BE can carry
    // pre-system migrated arrears in its opening balance that never appears as a charge line, and
    // subtracting a due_end-based restanță from a charge-line-only "colectat" produced a nonsensical
    // negative Încasat for exactly those units (found against Kralik's real data, e.g. AP 1/B
    // RULMENT). `collectionRate` already carries that opening anchor in `owed`, so Colectat := owed
    // here, and `Încasat + Restanță = Colectat` holds as an observed fact (like the report's own
    // `checks.identityOk`), not merely by construction.
    const rate: any = await this.collectionRate(communityId, current.code, undefined, { basis: 'end' })
    const assocMetricByFund = new Map<string, { owed: number; paid: number; outstanding: number }>()
    for (const d of rate.domains ?? []) for (const f of d.funds ?? []) assocMetricByFund.set(f.code, f)
    let targetMetricByFund = new Map<string, { owed: number; paid: number; outstanding: number }>()
    if (target.type === 'be' && targetBeId) {
      const row = (rate.rows ?? []).find((r: any) => r.beId === targetBeId)
      if (row) for (const [code, m] of Object.entries<any>(row.byFund ?? {})) targetMetricByFund.set(code, m)
    } else if (target.type === 'unit') {
      targetMetricByFund = await this.unitCollectionMetrics(communityId, unitIds[0], current.seq, fundColumnIds, fundCodeById)
    }
    const collectionStats = (m: { owed: number; paid: number; outstanding: number } | undefined, totalTarget: number | null) => {
      const colectat = round2(m?.owed ?? 0)
      const incasat = round2(m?.paid ?? 0)
      const restanta = round2(m?.outstanding ?? 0)
      return {
        colectat, restanta, incasat,
        gradIncasarePct: colectat > 0.005 ? round2((incasat / colectat) * 100) : null,
        gradColectarePct: totalTarget != null && totalTarget > 0.005 ? round2((colectat / totalTarget) * 100) : null,
      }
    }

    // Surfaced alongside the assumptions: WHY a fund column goes to 0 for some future month (its
    // window ended or hasn't started), how much of it has actually been collected community-wide
    // so far, and — for a closed fund — its real collection history, since a plateaued total is
    // the clearest evidence a fund is finished (see `collectionChart` below).
    const fundsInfo = ['EXPENSES', 'PENALIZARI', ...FUND_COLUMNS].map((code) => {
      const win = fundWindowByCode.get(code)
      const fund = funds.find((f) => f.code === code)
      const totalTarget = fund?.totalTarget != null ? Number(fund.totalTarget) : null
      const totalCollected = fundTotalCollected.get(code) ?? null
      const penaltyRatePct = (fund?.allocation as any)?.penaltyPerDayPct ?? null
      const hist = [...(fundHistory.get(code)?.entries() ?? [])].sort((a, b) => (periodOrdinal(a[0])! - periodOrdinal(b[0])!))
      const isRealFund = FUND_COLUMNS.includes(code)
      return {
        code, name: fundNameByCode.get(code) ?? code, group: groupOf(code),
        perPeriodAmount: isRealFund ? (totalTarget != null && win ? round2(totalTarget / win.periodCount) : null) : null,
        startPeriodCode: win?.startPeriodCode ?? null,
        periodCount: win?.periodCount ?? null,
        endPeriodCode: win?.endPeriodCode ?? null,
        windowDerived: win?.derived ?? false,
        closed: win?.closed ?? false,
        totalTarget, totalCollected, penaltyRatePct,
        // Only for a closed fund — an active fund's story is the forecast table itself, not a
        // look-back chart; this keeps the payload lean for the common (still-collecting) case.
        collectionChart: win?.closed ? hist.map(([periodCode, amount]) => ({ periodCode, amount: round2(amount) })) : null,
        association: isRealFund ? collectionStats(assocMetricByFund.get(code), totalTarget) : null,
        selected: isRealFund ? collectionStats(targetMetricByFund.get(code), totalTarget) : null,
      }
    })
    // Category subtotals ("Întreținere" / "Fond Operațional" / "Fond Reabilitare") over what's
    // been collected so far — the plain answer to "how much has actually been raised, in total."
    const groupTotalsMap = new Map<string, { key: string; label: string; totalCollected: number }>()
    for (const f of fundsInfo) {
      if (f.totalCollected == null) continue
      const g = groupTotalsMap.get(f.group.key) ?? { key: f.group.key, label: f.group.label, totalCollected: 0 }
      g.totalCollected = round2(g.totalCollected + f.totalCollected)
      groupTotalsMap.set(f.group.key, g)
    }
    const groupTotals = [...groupTotalsMap.values()].sort(
      (a, b) => (superGroupMetaByKey.get(a.key)?.sortOrder ?? 9) - (superGroupMetaByKey.get(b.key)?.sortOrder ?? 9),
    )
    const grandTotalCollected = round2(fundsInfo.reduce((s, f) => s + (f.totalCollected ?? 0), 0))
    // Same Încasat/Restanță/Colectat/Țintă/grade summed across every real fund (RULMENT/REPARAȚII/
    // REABILITARE 1-3) — the "per Asociație" / "per Ap selectat" section headers in the UI.
    const realFundsInfo = fundsInfo.filter((f) => f.association && f.selected)
    const sumTarget = round2(realFundsInfo.reduce((s, f) => s + (f.totalTarget ?? 0), 0)) || null
    const sumScope = (scope: 'association' | 'selected') => {
      const colectat = round2(realFundsInfo.reduce((s, f) => s + f[scope]!.colectat, 0))
      const restanta = round2(realFundsInfo.reduce((s, f) => s + f[scope]!.restanta, 0))
      const incasat = round2(realFundsInfo.reduce((s, f) => s + f[scope]!.incasat, 0))
      return collectionStats({ owed: colectat, paid: incasat, outstanding: restanta }, sumTarget)
    }
    const fundsSummary = { association: sumScope('association'), selected: sumScope('selected') }

    // 1) Restanță as of `current` — reconcileCommunity's own contract excludes current's own
    // charge (see that method's doc), so this is purely "everything owed from before this month".
    const restante: Record<string, number> = {}
    for (const unitId of unitIds) {
      const rows = await this.reconciliation.reconcileCommunity(communityId, current.id, { unitId })
      for (const r of rows) restante[r.fundCode] = round2((restante[r.fundCode] ?? 0) + r.liveTotal)
    }

    // 2) History for projection: `current`'s own charge if it's already been generated (a
    // PREPARED period already has its CommunityChargeLine rows), plus a lookback window of prior
    // periods for "last actual" / the trailing average.
    const priorPeriods = await this.prisma.period.findMany({
      where: { communityId, seq: { lt: current.seq } },
      orderBy: { seq: 'desc' },
      take: HISTORY_LOOKBACK,
      select: { id: true, code: true, seq: true },
    })
    // Periods after `current` that already have their own generated charges (PREPARED) — drafts:
    // their rows show those real draft amounts instead of a projection, still marked unconfirmed.
    const draftPeriods = await this.prisma.period.findMany({
      where: { communityId, seq: { gt: current.seq }, status: 'PREPARED' },
      select: { id: true, code: true, seq: true, status: true, afisareDate: true, dueDate: true },
    })
    const draftByCode = new Map(draftPeriods.map((p) => [p.code, p]))
    const periodsForHistory = [{ id: current.id, code: current.code, seq: current.seq }, ...priorPeriods, ...draftPeriods.map((p) => ({ id: p.id, code: p.code, seq: p.seq }))]
    const lines = await this.prisma.communityChargeLine.findMany({
      where: { unitId: { in: unitIds }, periodId: { in: periodsForHistory.map((p) => p.id) } },
      select: { amount: true, periodId: true, charge: { select: { fundId: true } } },
    })
    // periodCode -> fundCode -> summed amount, across every selected unit
    const byPeriodFund = new Map<string, Map<string, number>>()
    for (const l of lines) {
      const fundCode = l.charge.fundId ? fundCodeById.get(l.charge.fundId) : null
      if (!fundCode) continue
      const per = periodsForHistory.find((p) => p.id === l.periodId)
      if (!per) continue
      const m = byPeriodFund.get(per.code) ?? new Map<string, number>()
      m.set(fundCode, (m.get(fundCode) ?? 0) + Number(l.amount))
      byPeriodFund.set(per.code, m)
    }
    const priorCodesDesc = priorPeriods.map((p) => p.code)
    const lastActual = (fundCode: string): number => {
      for (const code of priorCodesDesc) {
        const v = byPeriodFund.get(code)?.get(fundCode)
        if (v != null) return round2(v)
      }
      return 0
    }
    const trailingAverage = (fundCode: string, window: number): number => {
      const vals: number[] = []
      for (const code of priorCodesDesc) {
        const v = byPeriodFund.get(code)?.get(fundCode)
        if (v != null) vals.push(v)
        if (vals.length >= window) break
      }
      return vals.length ? round2(vals.reduce((s, x) => s + x, 0) / vals.length) : 0
    }
    const currentActual = (fundCode: string): number | null => byPeriodFund.get(current.code)?.get(fundCode) ?? null
    // A fund not applicable to this target this period is a genuine 0, not an unknown, once the
    // period's own charges have actually been generated (PREPARED/CLOSED) — only fall back to a
    // projection when the period hasn't been computed yet at all.
    const currentGenerated = current.status === 'PREPARED' || current.status === 'CLOSED'
    const projectFund = (fundCode: string, periodCode: string): number => (fundActiveAt(fundCode, periodCode) ? lastActual(fundCode) : 0)

    const addMonthsToCode = (code: string, n: number) => {
      const m = /^(\d{4})-(\d{2})$/.exec(code)
      if (!m) return code
      const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n
      const y = Math.floor(total / 12)
      const mo = ((total % 12) + 12) % 12
      return `${y}-${String(mo + 1).padStart(2, '0')}`
    }
    // Emitere/scadență don't repeat monthly on a fixed day — the association issues the next
    // month's notice the day after the previous one's due date, and gives 30 days to pay (verified
    // against Kralik's own last 3 periods: due = emitere + 30 days exactly). Row 0 uses the
    // period's own real dates; each later row chains off the previous row's own scadență.
    const DUE_AFTER_ISSUE_DAYS = 30
    const addDays = (iso: string, days: number): string => {
      const d = new Date(iso)
      d.setUTCDate(d.getUTCDate() + days)
      return d.toISOString()
    }
    let emitereChain: string | null = current.afisareDate ? new Date(current.afisareDate).toISOString() : null
    let scadentaChain: string | null = current.dueDate
      ? new Date(current.dueDate).toISOString()
      : (emitereChain ? addDays(emitereChain, DUE_AFTER_ISSUE_DAYS) : null)

    const rows: any[] = []
    for (let i = 0; i < months; i++) {
      const isCurrent = i === 0
      const periodCode = addMonthsToCode(current.code, i)
      const draft = i > 0 ? draftByCode.get(periodCode) ?? null : null
      if (i > 0) {
        // a draft period already carries its own dates when the admin set them
        emitereChain = draft?.afisareDate ? new Date(draft.afisareDate).toISOString() : (scadentaChain ? addDays(scadentaChain, 1) : null)
        scadentaChain = draft?.dueDate ? new Date(draft.dueDate).toISOString() : (emitereChain ? addDays(emitereChain, DUE_AFTER_ISSUE_DAYS) : null)
      }
      const emitere = emitereChain
      const scadenta = scadentaChain
      // a draft's own generated charge (0 when it has none on that fund) — real numbers, not final
      const draftActual = (fundCode: string): number => round2(byPeriodFund.get(periodCode)?.get(fundCode) ?? 0)

      const expenses = isCurrent
        ? round2((restante['EXPENSES'] ?? 0) + (currentGenerated ? (currentActual('EXPENSES') ?? 0) : trailingAverage('EXPENSES', EXPENSES_AVG_WINDOW)))
        : draft ? draftActual('EXPENSES') : trailingAverage('EXPENSES', EXPENSES_AVG_WINDOW)
      const penalties = isCurrent
        ? round2((restante['PENALIZARI'] ?? 0) + (currentGenerated ? (currentActual('PENALIZARI') ?? 0) : lastActual('PENALIZARI')))
        : draft ? draftActual('PENALIZARI') : lastActual('PENALIZARI')

      const fundsOut: Record<string, number> = {}
      const confirmedFunds: Record<string, boolean> = {}
      for (const code of FUND_COLUMNS) {
        fundsOut[code] = isCurrent
          ? round2((restante[code] ?? 0) + (currentGenerated ? (currentActual(code) ?? 0) : projectFund(code, periodCode)))
          : draft ? draftActual(code) : projectFund(code, periodCode)
        confirmedFunds[code] = isCurrent && currentGenerated
      }

      const total = round2(expenses + penalties + Object.values(fundsOut).reduce((s, v) => s + v, 0))
      rows.push({
        periodCode, isCurrent, draft: !!draft, emitere, scadenta, expenses, penalties, funds: fundsOut, total,
        // Confirmed = read from the ledger/an already-generated charge; false = a projection/estimate.
        // Row 0's restanță is always a ledger fact, so its cells are confirmed once `current` itself
        // has generated charges — everything from row 1 on is, by construction, a projection.
        confirmed: { expenses: isCurrent && currentGenerated, penalties: isCurrent && currentGenerated, funds: confirmedFunds },
      })
    }

    const targetDemonstrative = target.type === 'unit' ? 'această unitate' : 'acest proprietar'
    // Kept intentionally short (one line each) — this list sits right above the funds/assumptions
    // panel and the whole report is meant to fit on one printed page.
    const assumptions = [
      `Luna curentă (${current.code}) e ultima lună închisă: include restanța acumulată plus taxa lunii, ${currentGenerated ? 'deja generată' : 'estimată'}.`,
      ...(draftPeriods.length ? [`Lunile pregătite (${draftPeriods.map((p) => p.code).join(', ')}) sunt draft: sumele lor generate apar gri, neconfirmate, până la închidere.`] : []),
      `Rulment/Reparații/Reabilitare 1-3: proiectate la ultima sumă facturată, cât timp fondul e activ.`,
      `Cheltuieli Întreținere: ESTIMATE ca medie pe ultimele ${EXPENSES_AVG_WINDOW} luni facturate.`,
      `Penalități: proiectate la ultima sumă facturată; nu se simulează acumulare nouă.`,
      `Scadența = emiterea + 30 zile; emiterea lunii următoare = scadența precedentă + 1 zi.`,
      `Sumele gri sunt proiecții; doar restanța și taxa curentă generată sunt confirmate din ledger.`,
      `Fereastra de colectare și coloana Total colectat/Țintă din tabelul de fonduri sunt la nivelul asociației; secțiunile Încasat/Restanță/Colectat/Țintă arată separat asociația și ${targetDemonstrative}.`,
    ]

    return {
      months, target, current: { code: current.code, status: current.status },
      expensesLabel, penaltiesLabel, fundColumns, fundsInfo, groupTotals, grandTotalCollected, fundsSummary,
      rows, assumptions,
    }
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

function pickMetric(r: any) {
  return { owed: r.owed, paid: r.paid, outstanding: r.outstanding, opening: r.opening, charges: r.charges, adjustments: r.adjustments, ratePct: r.ratePct }
}

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
