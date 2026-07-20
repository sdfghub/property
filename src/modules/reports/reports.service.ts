import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { FUND_DOMAIN_META } from '../../common/enums-meta'

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
 *     rate%       = paid / owed × 100             ≡ (1 − outstanding/owed) × 100
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
  constructor(private readonly prisma: PrismaService) {}

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
   */
  private async cpiByBe(communityId: string, seq: number): Promise<Map<string, number>> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `with latest as (
         select distinct on (pm.scope_id) pm.scope_id as unit_id, pm.value
           from period_measure pm
           join period p on p.id = pm.period_id
          where pm.community_id = $1 and pm.type_code = 'SQM'
            and pm.scope_type = 'UNIT' and p.seq <= $2
          order by pm.scope_id, p.seq desc
       )
       select bem.billing_entity_id as be_id, sum(latest.value)::float8 as cpi
         from latest
         join billing_entity_member bem
           on bem.unit_id = latest.unit_id
          and bem.start_seq <= $2
          and (bem.end_seq is null or bem.end_seq >= $2)
        group by bem.billing_entity_id`,
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
      return { owed, paid, outstanding: c.dueEnd }
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
    let owedCum = 0, paidCum = 0, prevOwed = 0, prevPaid = 0
    const history = [...perPeriod.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, e]) => {
        owedCum += (openingAtSeq.get(seq) ?? 0) + e.charges + e.adjustments
        paidCum += e.payments
        const point = {
          periodCode: e.code,
          status: e.status,
          ...shape({ owed: owedCum, paid: paidCum, outstanding: e.dueEnd }),
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
}

type Acc = { owed: number; paid: number; outstanding: number }
const newAcc = (): Acc => ({ owed: 0, paid: 0, outstanding: 0 })
const add = (a: Acc, b: Acc) => { a.owed += b.owed; a.paid += b.paid; a.outstanding += b.outstanding }

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
  return { owed, paid, outstanding: round2(a.outstanding), ratePct: owed > 0 ? round2((paid / owed) * 100) : null }
}

const sumCpi = (bes: Set<string>, cpi: Map<string, number>) =>
  [...bes].reduce((s, b) => s + (cpi.get(b) ?? 0), 0)

function emptyReport(period: any, domain: string | null = null) {
  return {
    period: period
      ? { code: period.code, seq: Number(period.seq), status: period.status, afisareDate: period.afisare_date ?? null, dueDate: period.due_date ?? null }
      : null,
    domain,
    totals: { owed: 0, paid: 0, outstanding: 0, ratePct: null, cpi: 0 },
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
