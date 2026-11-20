import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { anchorOffset, checkpointChecks, checkpointsOf, fxRatesOf, rateAt } from '../billing/cash-balance.util'

// Istoric încasări / plăți pe perioade: every cash movement (CashTx) grouped by the period it was
// registered for. The register imports stamp `meta.cycleCode` (the list whose collection window the
// movement belongs to); movements without it fall into the period whose window
// (previous afișare, afișare] contains them, else into their calendar month.
//   Încasări = money in from owners/third parties (PAYMENT/OTHER/ADJUSTMENT IN)
//   Plăți    = money out to vendors, fees (PAYMENT/OTHER/ADJUSTMENT OUT)
//   Transferuri between the association's own accounts are shown apart and do not count as either.
// RON and EUR are kept separate (no conversion); the chart and the cumulative flow use RON.
// Also: per-account balances per period (`accounts`) and receipts per unit / owner (`receipts`).

type Flow = { in: number; out: number }
type Row = {
  periodCode: string
  status: string | null
  from: string | null
  to: string | null
  in: number
  out: number
  net: number
  cumulative: number
  transfers: number
  countIn: number
  countOut: number
  eur: Flow
  byFund: Array<{ code: string; name: string } & Flow>
  byAccount: Array<{ code: string; name: string; currency: string } & Flow>
}

const r2 = (n: number) => Math.round(n * 100) / 100

@Injectable()
export class CashHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async cashHistory(communityId: string) {
    const [txs, periods, funds, accounts] = await Promise.all([
      this.prisma.cashTx.findMany({
        where: { communityId, status: { not: 'VOID' } },
        select: { ts: true, amount: true, currency: true, direction: true, kind: true, meta: true, fundId: true, accountId: true },
        orderBy: { ts: 'asc' },
      }),
      this.prisma.period.findMany({
        where: { communityId },
        select: { code: true, status: true, seq: true, afisareDate: true },
        orderBy: { seq: 'asc' },
      }),
      this.prisma.fund.findMany({ where: { communityId }, select: { id: true, code: true, name: true } }),
      this.prisma.cashAccount.findMany({ where: { communityId }, select: { id: true, code: true, name: true, currency: true, notes: true } }),
    ])
    const who = await this.attribution(communityId)
    const fundById = new Map(funds.map((f) => [f.id, f]))
    const accountById = new Map(accounts.map((a) => [a.id, a]))
    const statusOf = new Map(periods.map((p) => [p.code, p.status as string]))
    // collection windows from the afișare dates: (previous afișare, afișare]
    const windows = periods
      .filter((p) => p.afisareDate)
      .map((p, i, arr) => ({ code: p.code, from: i > 0 ? arr[i - 1].afisareDate!.getTime() : -Infinity, to: p.afisareDate!.getTime() + 86_400_000 }))
    const periodFor = (ts: Date, meta: any): string => {
      const c = meta && typeof meta === 'object' ? meta.cycleCode : null
      if (typeof c === 'string' && c) return c
      const t = ts.getTime()
      const w = windows.find((x) => t > x.from && t < x.to)
      return w ? w.code : ts.toISOString().slice(0, 7)
    }

    type Acc = {
      from: number; to: number; in: number; out: number; transfers: number; countIn: number; countOut: number; eur: Flow
      fund: Map<string, Flow>; account: Map<string, Flow>
      unit: Map<string, number>; owner: Map<string, number>
    }
    const groups = new Map<string, Acc>()
    for (const tx of txs) {
      const code = periodFor(tx.ts, tx.meta)
      let g = groups.get(code)
      if (!g) {
        g = { from: Infinity, to: -Infinity, in: 0, out: 0, transfers: 0, countIn: 0, countOut: 0, eur: { in: 0, out: 0 }, fund: new Map(), account: new Map(), unit: new Map(), owner: new Map() }
        groups.set(code, g)
      }
      const amt = Number(tx.amount)
      const t = tx.ts.getTime()
      g.from = Math.min(g.from, t)
      g.to = Math.max(g.to, t)
      const side: keyof Flow = tx.direction === 'IN' ? 'in' : 'out'
      const acc = g.account.get(tx.accountId) ?? { in: 0, out: 0 }
      acc[side] += amt
      g.account.set(tx.accountId, acc)
      if (tx.kind === 'TRANSFER') {
        if (side === 'in' && tx.currency === 'RON') g.transfers += amt
        continue
      }
      if (amt === 0) continue
      if (tx.currency !== 'RON') {
        g.eur[side] += amt
        continue
      }
      g[side] += amt
      if (side === 'in') {
        g.countIn++
        // whose money: the register payment's unit/owner (see attribution); third parties → ''
        if (tx.kind === 'PAYMENT') {
          const a = who.of(tx.meta, tx.fundId, code)
          g.unit.set(a.unitId, (g.unit.get(a.unitId) ?? 0) + amt)
          g.owner.set(a.beId, (g.owner.get(a.beId) ?? 0) + amt)
        }
      } else g.countOut++
      const f = g.fund.get(tx.fundId) ?? { in: 0, out: 0 }
      f[side] += amt
      g.fund.set(tx.fundId, f)
    }

    const day = (t: number) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null)
    let cumulative = 0
    const rows: Row[] = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, g]) => {
        const net = g.in - g.out
        cumulative += net
        return {
          periodCode: code,
          status: statusOf.get(code) ?? null,
          from: day(g.from),
          to: day(g.to),
          in: r2(g.in),
          out: r2(g.out),
          net: r2(net),
          cumulative: r2(cumulative),
          transfers: r2(g.transfers),
          countIn: g.countIn,
          countOut: g.countOut,
          eur: { in: r2(g.eur.in), out: r2(g.eur.out) },
          byFund: [...g.fund.entries()]
            .map(([id, f]) => ({ code: fundById.get(id)?.code ?? id, name: fundById.get(id)?.name ?? id, in: r2(f.in), out: r2(f.out) }))
            .sort((a, b) => b.in + b.out - (a.in + a.out)),
          byAccount: [...g.account.entries()]
            .map(([id, f]) => {
              const a = accountById.get(id)
              return { code: a?.code ?? id, name: a?.name ?? id, currency: a?.currency ?? 'RON', in: r2(f.in), out: r2(f.out) }
            })
            .sort((a, b) => a.code.localeCompare(b.code)),
        }
      })

    // Solduri pe conturi: opening / in / out / closing per period, in the account's own currency,
    // transfers included (they move money between accounts). Same basis as cash-accounts/balances.
    const periodCodes = rows.map((r) => r.periodCode)
    const accountsOut = accounts
      .map((a) => {
        // start from the statement-anchored opening (0 when the account has no checkpoints)
        const moves = txs.filter((x) => x.accountId === a.id).map((x) => ({ ts: x.ts, signed: x.direction === 'IN' ? Number(x.amount) : -Number(x.amount) }))
        const cps = checkpointsOf(a.notes)
        const offset = anchorOffset(cps, moves)
        let bal = offset
        // non-RON: the RON rate valid at the period's end (for the all-accounts total)
        const fx = a.currency === 'RON' ? [] : fxRatesOf(a.notes)
        const periods = rows.map((row) => {
          const code = row.periodCode
          const f = groups.get(code)!.account.get(a.id) ?? { in: 0, out: 0 }
          const opening = bal
          bal += f.in - f.out
          const r = row.to ? rateAt(fx, row.to) : null
          return {
            periodCode: code, opening: r2(opening), in: r2(f.in), out: r2(f.out), closing: r2(bal),
            ...(r ? { rate: r.rate, rateSell: r.sell, rateDate: r.date, rateEstimated: r.estimated } : {}),
          }
        })
        return {
          code: a.code, name: a.name, currency: a.currency, balance: r2(bal), periods, fxRates: fx,
          opening: r2(offset), anchored: cps.length > 0, checkpoints: checkpointChecks(cps, moves, offset),
        }
      })
      .filter((a) => a.periods.some((p) => p.in || p.out))

    // Încasări pe unitate / proprietar: one row per entity, amounts per period (RON)
    const matrix = (key: 'unit' | 'owner', meta: (id: string) => { label: string; sub?: string | null; order: number }) => {
      const ids = new Set<string>()
      for (const g of groups.values()) for (const id of g[key].keys()) ids.add(id)
      return [...ids]
        .map((id) => {
          const byPeriod: Record<string, number> = {}
          let total = 0
          for (const code of periodCodes) {
            const v = groups.get(code)![key].get(id)
            if (v) { byPeriod[code] = r2(v); total += v }
          }
          return { id, ...meta(id), byPeriod, total: r2(total) }
        })
        .sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : a.order - b.order))
    }
    const receipts = {
      units: matrix('unit', (id) => who.unitMeta(id)),
      owners: matrix('owner', (id) => who.ownerMeta(id)),
    }

    const sum = (k: 'in' | 'out' | 'transfers') => r2(rows.reduce((s, r) => s + r[k], 0))
    return {
      rows,
      accounts: accountsOut,
      receipts,
      totals: {
        in: sum('in'),
        out: sum('out'),
        net: r2(sum('in') - sum('out')),
        transfers: sum('transfers'),
        eur: { in: r2(rows.reduce((s, r) => s + r.eur.in, 0)), out: r2(rows.reduce((s, r) => s + r.eur.out, 0)) },
      },
    }
  }

  /**
   * Who a register receipt belongs to. The register import writes one Payment per register row
   * (refId `cash:<cycle>:<n>`, billingEntityId, allocationSpec with the unit per fund) and one
   * CashTx per fund (meta.n, meta.cycleCode). Rows without a Payment fall back to the register's
   * counterparty label matched against the unit labels; the owner is then the unit's billing
   * entity in that period. Anything still unknown is '' (Neatribuit).
   */
  private async attribution(communityId: string) {
    const [payments, units, bes, members, periods] = await Promise.all([
      this.prisma.payment.findMany({ where: { communityId, refId: { startsWith: 'cash:' } }, select: { refId: true, billingEntityId: true, allocationSpec: true } }),
      this.prisma.unit.findMany({ where: { communityId }, select: { id: true, code: true, name: true, order: true } }),
      this.prisma.billingEntity.findMany({ where: { communityId }, select: { id: true, name: true, displayName: true, order: true } }),
      this.prisma.billingEntityMember.findMany({ where: { billingEntity: { communityId } }, select: { billingEntityId: true, unitId: true, startSeq: true, endSeq: true } }),
      this.prisma.period.findMany({ where: { communityId }, select: { code: true, seq: true } }),
    ])
    const payByRef = new Map(payments.map((p) => [p.refId!, p]))
    const seqOf = new Map(periods.map((p) => [p.code, p.seq]))
    const label = (u: { code: string; name: string | null }) => u.name || u.code.split('-').slice(3).join('-') || u.code
    const norm = (x: string) => x.toUpperCase().replace(/^AP\s*/, '').replace(/[^A-Z0-9/]/g, '')
    const unitByLabel = new Map(units.map((u) => [norm(label(u)), u.id]))
    const unitById = new Map(units.map((u) => [u.id, u]))
    const beById = new Map(bes.map((b) => [b.id, b]))
    const beOfUnit = (unitId: string, seq: number | undefined) => {
      const ms = members.filter((m) => m.unitId === unitId)
      const m = seq == null ? ms[ms.length - 1] : ms.find((x) => x.startSeq <= seq && (x.endSeq == null || x.endSeq >= seq)) ?? ms[ms.length - 1]
      return m?.billingEntityId ?? ''
    }
    const unitsOfBe = new Map<string, Set<string>>()
    for (const m of members) {
      if (!unitsOfBe.has(m.billingEntityId)) unitsOfBe.set(m.billingEntityId, new Set())
      unitsOfBe.get(m.billingEntityId)!.add(m.unitId)
    }
    return {
      of: (meta: any, fundId: string, periodCode: string): { unitId: string; beId: string } => {
        const m = meta && typeof meta === 'object' ? meta : {}
        const pay = m.cycleCode && m.n != null ? payByRef.get(`cash:${m.cycleCode}:${m.n}`) : undefined
        const seq = seqOf.get(periodCode)
        let unitId = ''
        if (pay && Array.isArray(pay.allocationSpec)) {
          const lines = (pay.allocationSpec as any[]).filter((l) => l?.unitId)
          unitId = (lines.find((l) => l.fundId === fundId) ?? lines[0])?.unitId ?? ''
        }
        if (!unitId && typeof m.counterparty === 'string') unitId = unitByLabel.get(norm(m.counterparty)) ?? ''
        if (!unitId && pay) {
          const own = [...(unitsOfBe.get(pay.billingEntityId) ?? [])]
          if (own.length === 1) unitId = own[0]
        }
        const beId = pay?.billingEntityId ?? (unitId ? beOfUnit(unitId, seq) : '')
        return { unitId, beId }
      },
      unitMeta: (id: string) => {
        const u = unitById.get(id)
        if (!u) return { label: '', sub: null, order: Number.MAX_SAFE_INTEGER }
        const be = beById.get(beOfUnit(id, undefined))
        return { label: label(u), sub: be ? be.displayName || be.name : null, order: u.order }
      },
      ownerMeta: (id: string) => {
        const b = beById.get(id)
        if (!b) return { label: '', sub: null, order: Number.MAX_SAFE_INTEGER }
        const us = [...(unitsOfBe.get(id) ?? [])].map((u) => unitById.get(u)).filter(Boolean).map((u) => label(u!))
        return { label: b.displayName || b.name, sub: us.join(', ') || null, order: b.order }
      },
    }
  }
}
