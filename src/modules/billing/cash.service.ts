import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureCommunityId(ref: string) {
    const c = await this.prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true } })
    if (!c) throw new NotFoundException('Community not found')
    return c.id
  }

  async listAccounts(communityRef: string) {
    const communityId = await this.ensureCommunityId(communityRef)
    return this.prisma.cashAccount.findMany({
      where: { communityId },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    })
  }

  /** CashAccount carries no stored balance — it's sum(IN) − sum(OUT) over POSTED transactions.
   *  Used by the "Sold Bancă / Sold Numerar" dashboard widgets, bucketed by account type+currency
   *  since a community can hold e.g. both a RON and a EUR bank account. */
  async getBalances(communityRef: string) {
    const communityId = await this.ensureCommunityId(communityRef)
    const accounts = await this.prisma.cashAccount.findMany({
      where: { communityId, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, type: true, currency: true },
    })
    const sums = await (this.prisma as any).cashTx.groupBy({
      by: ['accountId', 'direction'],
      where: { communityId, status: 'POSTED' },
      _sum: { amount: true },
    })
    const byAccount = new Map<string, number>()
    for (const s of sums as any[]) {
      const cur = byAccount.get(s.accountId) ?? 0
      const amt = Number(s._sum.amount || 0)
      byAccount.set(s.accountId, cur + (s.direction === 'IN' ? amt : -amt))
    }
    const withBalance = accounts.map((a) => ({ ...a, balance: round2(byAccount.get(a.id) ?? 0) }))

    // Non-RON accounts get a best-effort RON conversion for the combined-total card: the average
    // `meta.fxRateEstimate` recorded on that account's own transactions (set during reconciliation
    // — see reconcile-kralik-cash-balances.ts), never a hardcoded frontend rate. No estimate on
    // file => no conversion offered (ronEquivalent stays null and doesn't enter totalRon).
    const nonRonIds = withBalance.filter((a) => a.currency !== 'RON').map((a) => a.id)
    const fxRows = nonRonIds.length
      ? await (this.prisma as any).cashTx.findMany({ where: { communityId, accountId: { in: nonRonIds } }, select: { accountId: true, meta: true } })
      : []
    const rateByAccount = new Map<string, number>()
    for (const id of nonRonIds) {
      const rates = (fxRows as any[])
        .filter((r) => r.accountId === id)
        .map((r) => Number(r.meta?.fxRateEstimate))
        .filter((n) => Number.isFinite(n) && n > 0)
      if (rates.length) rateByAccount.set(id, rates.reduce((s, n) => s + n, 0) / rates.length)
    }
    // Per-account last activity date — RON bank, EUR bank, and petty cash each keep their own
    // register, so they don't necessarily update on the same day.
    const lastTxByAccount = await (this.prisma as any).cashTx.groupBy({
      by: ['accountId'],
      where: { communityId, status: 'POSTED' },
      _max: { ts: true },
    })
    const lastActivityByAccount = new Map<string, Date>((lastTxByAccount as any[]).map((r) => [r.accountId, r._max.ts]))

    const withFx = withBalance.map((a) => {
      const lastActivityDate = lastActivityByAccount.get(a.id) ?? null
      if (a.currency === 'RON') return { ...a, fxRateEstimate: null, ronEquivalent: a.balance, lastActivityDate }
      const rate = rateByAccount.get(a.id) ?? null
      return { ...a, fxRateEstimate: rate, ronEquivalent: rate != null ? round2(a.balance * rate) : null, lastActivityDate }
    })

    const byTypeCurrency = new Map<string, number>()
    for (const a of withFx) {
      const key = `${a.type}::${a.currency}`
      byTypeCurrency.set(key, (byTypeCurrency.get(key) ?? 0) + a.balance)
    }
    const totals = Array.from(byTypeCurrency.entries()).map(([key, balance]) => {
      const [type, currency] = key.split('::')
      return { type, currency, balance: round2(balance) }
    })
    const totalRon = round2(withFx.reduce((s, a) => s + (a.ronEquivalent ?? (a.currency === 'RON' ? a.balance : 0)), 0))

    // Most recent transaction date across every cash account (bank + petty cash, any currency) —
    // "when was our register last updated," shown as a freshness stamp under Încasări on the
    // Dashboard (cashflow, not accrual — deliberately not scoped to the selected period).
    const lastTx = await this.prisma.cashTx.findFirst({
      where: { communityId, status: 'POSTED' },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    })

    return { accounts: withFx, totals, totalRon, lastActivityDate: lastTx?.ts ?? null }
  }

  async createAccount(communityRef: string, body: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    if (!body.code || !body.name) throw new BadRequestException('code and name are required')
    const type = body.type || 'BANK'
    return this.prisma.cashAccount.create({
      data: {
        communityId,
        code: body.code,
        name: body.name,
        type,
        currency: body.currency || 'RON',
        status: body.status || 'ACTIVE',
        notes: body.notes ?? null,
      },
    })
  }

  /**
   * The cash/bank register — same data the "Sold Bancă / Sold Numerar" and "Încasări" dashboard
   * cards summarize, browsable in full. `accountIds` (comma-separated) scopes to several accounts
   * at once (e.g. the "Sold total" drilldown: Bancă RON + Bancă EUR + Casă). `period` resolves that
   * period's own `afisareDate` and filters to `ts > afisareDate` — the same rule
   * `FinanceService.collection` uses for "this period's real receipts" — so the "Încasări" card's
   * drilldown shows exactly the transactions behind that number, never a frontend-side date guess.
   */
  async listTx(communityRef: string, query: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    const where: any = { communityId }
    if (query?.accountId) where.accountId = query.accountId
    if (query?.accountIds) {
      const ids = String(query.accountIds).split(',').map((s: string) => s.trim()).filter(Boolean)
      if (ids.length) where.accountId = { in: ids }
    }
    if (query?.direction) where.direction = query.direction
    if (query?.fundId) where.fundId = query.fundId
    if (query?.from || query?.to) {
      where.ts = { ...(where.ts ?? {}) }
      if (query.from) where.ts.gte = new Date(query.from)
      if (query.to) where.ts.lte = new Date(query.to)
    }
    if (query?.period) {
      const period = await this.prisma.period.findFirst({ where: { communityId, code: query.period }, select: { afisareDate: true } })
      if ((period as any)?.afisareDate) where.ts = { ...(where.ts ?? {}), gt: (period as any).afisareDate }
    }
    const rows = await this.prisma.cashTx.findMany({
      where,
      orderBy: { ts: 'desc' },
      include: {
        account: { select: { id: true, code: true, name: true, type: true, currency: true } },
        fund: { select: { id: true, code: true, name: true } },
      },
    })

    // Rows created through the real payment flow (createVendorPayment → upsertCashTxForVendorPayment)
    // carry refType='VENDOR_PAYMENT', refId=VendorPayment.id — join those to their real invoice for
    // an authoritative vendor name + invoice number. Older register-import rows have no such link;
    // for those we fall back to whatever the import captured in `meta` (payer for receipts,
    // counterparty for payments) — real data transcribed from the actual bank/cash registers, just
    // not linked to a formal VendorPayment record.
    const vpIds = rows.filter((r) => r.refType === 'VENDOR_PAYMENT' && r.refId).map((r) => r.refId as string)
    const vps = vpIds.length
      ? await (this.prisma as any).vendorPayment.findMany({
          where: { id: { in: vpIds } },
          select: { id: true, invoice: { select: { number: true, vendor: { select: { name: true } } } } },
        })
      : []
    const vpById = new Map((vps as any[]).map((v) => [v.id, v]))

    return rows.map((r) => {
      const meta = (r.meta as any) ?? {}
      const vp = r.refType === 'VENDOR_PAYMENT' && r.refId ? vpById.get(r.refId) : null
      const counterpartyName =
        r.direction === 'IN' ? (meta.payer ?? null) : (vp?.invoice?.vendor?.name ?? meta.counterparty ?? null)
      // For receipts, the register import recorded the paying unit's apartment code in
      // `meta.counterparty` (payer's name is a separate field, `meta.payer`).
      const unit = r.direction === 'IN' ? (meta.counterparty ?? null) : null
      return { ...r, counterpartyName, unit, invoiceNumber: vp?.invoice?.number ?? null }
    })
  }

  /**
   * Opening balance of a cash account at the migration cutover: one ADJUSTMENT row per (account, fund),
   * refType OPENING_BALANCE, replaced on every call (idempotent). The book starts at zero otherwise, so
   * a bank account that only received post-cutover movements shows a nonsense (often negative) balance.
   */
  async setOpening(communityRef: string, accountId: string, body: { fundId?: string | null; fundCode?: string | null; amount: number; date?: string | null; memo?: string | null }) {
    const communityId = await this.ensureCommunityId(communityRef)
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, communityId }, select: { id: true, code: true, currency: true } })
    if (!account) throw new NotFoundException('Cash account not found')
    const fund = body.fundId
      ? await this.prisma.fund.findFirst({ where: { id: body.fundId, communityId }, select: { id: true, code: true } })
      : await this.prisma.fund.findFirst({ where: { communityId, code: body.fundCode ?? 'EXPENSES' }, select: { id: true, code: true } })
    if (!fund) throw new BadRequestException('Fund not found for the opening balance')
    const amount = Number(body.amount)
    if (!Number.isFinite(amount)) throw new BadRequestException('amount must be a number')
    const ts = body.date ? new Date(body.date) : new Date()
    const refId = `opening:${account.id}:${fund.id}`
    await this.prisma.cashTx.deleteMany({ where: { communityId, refType: 'OPENING_BALANCE', refId } })
    if (Math.abs(amount) < 0.005) return { removed: true, accountCode: account.code, fundCode: fund.code }
    return this.prisma.cashTx.create({
      data: {
        communityId, accountId: account.id, fundId: fund.id,
        amount: Math.abs(amount), currency: account.currency, ts,
        direction: amount >= 0 ? 'IN' : 'OUT', kind: 'ADJUSTMENT', status: 'POSTED',
        memo: body.memo ?? `Sold inițial ${account.code} / ${fund.code} la ${ts.toISOString().slice(0, 10)}`,
        refType: 'OPENING_BALANCE', refId, meta: { opening: true, fundCode: fund.code },
      },
    })
  }

  /** Opening rows currently on file, per account/fund (for the settings UI). */
  async listOpenings(communityRef: string) {
    const communityId = await this.ensureCommunityId(communityRef)
    const rows = await this.prisma.cashTx.findMany({ where: { communityId, refType: 'OPENING_BALANCE' }, select: { id: true, accountId: true, fundId: true, amount: true, direction: true, ts: true, fund: { select: { code: true } }, account: { select: { code: true } } }, orderBy: { ts: 'asc' } })
    return rows.map((r) => ({ id: r.id, accountId: r.accountId, accountCode: r.account.code, fundId: r.fundId, fundCode: r.fund.code, amount: Number(r.amount) * (r.direction === 'IN' ? 1 : -1), date: r.ts.toISOString().slice(0, 10) }))
  }

  async createTx(communityRef: string, body: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    if (!body.accountId) throw new BadRequestException('accountId is required')
    const account = await this.prisma.cashAccount.findFirst({ where: { id: body.accountId, communityId } })
    if (!account) throw new NotFoundException('Cash account not found')
    if (!body.fundId) throw new BadRequestException('fundId is required')
    const fund = await this.prisma.fund.findFirst({ where: { id: body.fundId, communityId }, select: { id: true } })
    if (!fund) throw new NotFoundException('Fund not found')
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be positive')
    if (!body.direction) throw new BadRequestException('direction is required')
    const kind = body.kind || 'OTHER'
    return this.prisma.cashTx.create({
      data: {
        communityId,
        accountId: body.accountId,
        fundId: fund.id,
        ts: body.ts ? new Date(body.ts) : undefined,
        amount,
        currency: body.currency || account.currency || 'RON',
        direction: body.direction,
        kind,
        status: body.status || 'POSTED',
        refType: body.refType ?? null,
        refId: body.refId ?? null,
        memo: body.memo ?? null,
        meta: body.meta ?? null,
      },
    })
  }
}
