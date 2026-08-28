import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { ensureLedgerEntryDetail } from './ledger-detail.util'
import { ensureCommunityLedgerEntryDetail } from './community-ledger-detail.util'
import { ensureFundLedgerEntryDetail } from './fund-ledger-detail.util'

type UpsertVendorInput = { vendorId?: string; vendorName?: string; taxId?: string; iban?: string }

@Injectable()
export class VendorInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveFundSpendPeriodId(
    communityId: string,
    invoice: { serviceStartPeriodId?: string | null; serviceEndPeriodId?: string | null; issueDate?: Date | null },
  ) {
    let period: { id: string; status: string } | null = null
    const byStart = invoice.serviceStartPeriodId
      ? await this.prisma.period.findFirst({
          where: { id: invoice.serviceStartPeriodId, communityId },
          select: { id: true, status: true },
        })
      : null
    const byEnd = invoice.serviceEndPeriodId
      ? await this.prisma.period.findFirst({
          where: { id: invoice.serviceEndPeriodId, communityId },
          select: { id: true, status: true },
        })
      : null
    period = byStart || byEnd
    if (!period && invoice.issueDate) {
      period = await this.prisma.period.findFirst({
        where: {
          communityId,
          startDate: { lte: invoice.issueDate },
          endDate: { gte: invoice.issueDate },
        },
        orderBy: { seq: 'desc' },
        select: { id: true, status: true },
      })
    }
    if (!period) {
      throw new BadRequestException(
        'Cannot resolve period for fund spend. Set serviceStartPeriodId/serviceEndPeriodId or issueDate.',
      )
    }
    if (period.status === 'CLOSED') {
      throw new BadRequestException('Target period is CLOSED. Reopen the period or choose another.')
    }
    return period.id
  }

  private async resolveCashPeriodId(communityId: string) {
    // Prefer the current OPEN period; fall back to the latest not-yet-CLOSED period
    // (e.g. a PREPARED current month) so cash can still be posted.
    const period =
      (await this.prisma.period.findFirst({
        where: { communityId, status: 'OPEN' },
        orderBy: { seq: 'desc' },
        select: { id: true },
      })) ||
      (await this.prisma.period.findFirst({
        where: { communityId, status: { not: 'CLOSED' } },
        orderBy: { seq: 'desc' },
        select: { id: true },
      }))
    if (!period) {
      throw new BadRequestException('No open period found for payment')
    }
    return period.id
  }

  private async resolveVendor(communityId: string, input: UpsertVendorInput) {
    if (input.vendorId) {
      const vendor = await this.prisma.vendor.findUnique({ where: { id: input.vendorId, communityId } })
      if (!vendor) throw new NotFoundException('Vendor not found')
      return vendor.id
    }
    if (!input.vendorName) return null
    const existing = await this.prisma.vendor.findFirst({
      where: { communityId, name: input.vendorName },
      select: { id: true },
    })
    if (existing) return existing.id
    const created = await this.prisma.vendor.create({
      data: {
        communityId,
        name: input.vendorName,
        taxId: input.taxId ?? null,
        iban: input.iban ?? null,
      },
      select: { id: true },
    })
    return created.id
  }

  async listInvoices(communityId: string) {
    const rows = await this.prisma.vendorInvoice.findMany({
      where: { communityId },
      orderBy: [{ issueDate: 'desc' }],
      select: {
        id: true,
        vendorId: true,
        number: true,
        issueDate: true,
        dueDate: true,
        serviceStartPeriodId: true,
        serviceEndPeriodId: true,
        currency: true,
        net: true,
        vat: true,
        gross: true,
        source: true,
        provenance: true,
        vendor: { select: { id: true, name: true, taxId: true } },
        fundInvoices: {
          select: {
            fundId: true,
            amount: true,
            notes: true,
            fund: { select: { id: true, code: true, name: true } },
          },
        },
        paymentApplications: { select: { amount: true, payment: { select: { id: true, ts: true } } } },
      } as any,
    })

    const computed = rows.map((r: any) => {
      const apps: any[] = Array.isArray(r.paymentApplications) ? r.paymentApplications : []
      const paid = apps.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
      // "Data plată" — the most recent payment applied to this invoice (there can be several,
      // e.g. partial payments over time).
      const paidAt = apps.reduce((latest: Date | null, p: any) => {
        const ts = p.payment?.ts ? new Date(p.payment.ts) : null
        if (!ts) return latest
        return !latest || ts > latest ? ts : latest
      }, null as Date | null)
      const gross = r.gross != null ? Number(r.gross) : 0
      // Editing the paid amount only makes sense when there's exactly one payment behind it —
      // with several partial payments, which one a UI edit should adjust is ambiguous.
      const paymentId = apps.length === 1 ? apps[0].payment?.id ?? null : null
      return {
        ...r,
        paid,
        due: gross - paid,
        paidAt,
        paymentId,
      }
    })

    // Bill-template submissions create one VendorInvoice per template instance, so a single real
    // invoice split across services (e.g. an Aquatim bill covering Apă Rece + Canalizare +
    // Penalități via one template and Apă Meteo via another) lands as multiple DB rows sharing the
    // same vendor + invoice number. Those per-template rows are exactly what "Cheltuieli" needs
    // (each keeps its own CommunityCharge/FundInvoice) — but AS AN INVOICE it must appear once,
    // with the combined total. Group here, at read time, rather than merging the underlying rows.
    const groups = new Map<string, typeof computed>()
    for (const r of computed) {
      const key = r.number ? `${r.vendorId}::${r.number}` : `__single__${r.id}`
      const arr = groups.get(key) ?? []
      arr.push(r)
      groups.set(key, arr)
    }

    return Array.from(groups.values()).map((group) => {
      if (group.length === 1) return group[0]
      const byIssueDateAsc = group.slice().sort((a, b) => {
        const ta = a.issueDate ? new Date(a.issueDate).getTime() : Infinity
        const tb = b.issueDate ? new Date(b.issueDate).getTime() : Infinity
        return ta - tb
      })
      const primary = byIssueDateAsc[0]
      const sum = (key: 'net' | 'vat' | 'gross' | 'paid') => group.reduce((s, g) => s + Number(g[key] || 0), 0)
      const earliest = <T extends 'issueDate'>(key: T) =>
        group.reduce((min: Date | null, g) => {
          const v = g[key] ? new Date(g[key]) : null
          if (!v) return min
          return !min || v < min ? v : min
        }, null as Date | null)
      const gross = sum('gross')
      const paid = sum('paid')
      const paidAt = group.reduce((latest: Date | null, g) => {
        if (!g.paidAt) return latest
        return !latest || g.paidAt > latest ? g.paidAt : latest
      }, null as Date | null)
      const dueDate = group.reduce((d: Date | null, g) => d ?? (g.dueDate ? new Date(g.dueDate) : null), null as Date | null)
      return {
        ...primary,
        net: sum('net'),
        vat: sum('vat'),
        gross,
        paid,
        due: gross - paid,
        paidAt,
        issueDate: earliest('issueDate'),
        dueDate,
        fundInvoices: group.flatMap((g) => g.fundInvoices || []),
        mergedIds: group.map((g) => g.id),
        // A merged row spans several underlying invoices/payments — editing "the" paid amount is
        // ambiguous here, so this is only ever set for single, unmerged invoices.
        paymentId: null,
      }
    })
  }

  /**
   * Vendor-invoice ("De plată") summary for the Dashboard's payables card, mirroring the
   * resident-side "De încasat" split:
   * - currentGross: invoices assigned to the selected period, paid or not.
   * - overdueOutstanding: invoices assigned to an EARLIER period (by seq) than the selected one
   *   — real arrears, not "any other period" (so a future-period invoice doesn't count) and not
   *   double-counted against currentGross — that were still outstanding AS OF the selected
   *   period's own afisareDate (when its avizier was actually posted, not its calendar start):
   *   either unpaid today, or paid on/after that posting date (so an invoice settled between the
   *   period's start and its own posting still counts as overdue, since it was outstanding
   *   through the whole period, but one paid before the posting date is already settled by the
   *   time this period's numbers went out and shouldn't count, even though it's an earlier period).
   * - paidThisMonth: invoices actually paid within the selected period's own billing window
   *   (afisareDate → dueDate) — a cash-flow figure decoupled from which service period the
   *   invoice itself belongs to (unlike currentGross/overdueOutstanding, which are both
   *   assignment-based).
   */
  async invoiceSummaryForPeriod(communityId: string, periodCode?: string) {
    const period = periodCode
      ? await this.prisma.period.findFirst({ where: { communityId, code: periodCode }, select: { id: true, code: true, seq: true, startDate: true, afisareDate: true, dueDate: true } })
      : null
    const periodSeqById = new Map(
      (await this.prisma.period.findMany({ where: { communityId }, select: { id: true, seq: true } })).map((p) => [p.id, p.seq]),
    )

    const invoices = await this.listInvoices(communityId)
    const isCurrent = (inv: any) => !!period && (inv.serviceStartPeriodId === period.id || inv.serviceEndPeriodId === period.id)
    const isPaid = (inv: any) => Number(inv.due ?? 0) <= 0.005
    const isBeforeCurrent = (inv: any) => {
      if (!period) return false
      const seq = inv.serviceStartPeriodId ? periodSeqById.get(inv.serviceStartPeriodId) : null
      return seq != null && seq < period.seq
    }
    const wasOutstandingAtPeriodStart = (inv: any) => {
      if (!isPaid(inv)) return true
      // Anchored to the period's own afisareDate (when its avizier was actually posted), not
      // startDate (the calendar month) — this association posts well after the period starts, so
      // an invoice paid between the two would wrongly count as "still overdue" if compared to
      // startDate: it was already settled by the time this period's own numbers went out.
      return !!period?.afisareDate && !!inv.paidAt && new Date(inv.paidAt) >= period.afisareDate
    }
    const wasPaidInPeriodWindow = (inv: any) => {
      if (!isPaid(inv) || !inv.paidAt || !period?.afisareDate || !period?.dueDate) return false
      const paidAt = new Date(inv.paidAt)
      // This association posts its avizier well after the nominal due date (afisareDate often
      // lands after dueDate), so "the interval between the two" isn't chronologically ordered —
      // take the range spanning both, not assume afisareDate <= dueDate.
      const lo = period.afisareDate < period.dueDate ? period.afisareDate : period.dueDate
      const hi = period.afisareDate < period.dueDate ? period.dueDate : period.afisareDate
      return paidAt >= lo && paidAt <= hi
    }

    const currentRows = invoices.filter(isCurrent)
    const overdueRows = invoices.filter((inv: any) => isBeforeCurrent(inv) && wasOutstandingAtPeriodStart(inv))
    const paidRows = invoices.filter(wasPaidInPeriodWindow)

    const sumGross = (rows: any[]) => rows.reduce((s: number, inv: any) => s + Number(inv.gross ?? 0), 0)
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
    // Every "De plată" breakdown (Curente/Restanțe/Plăți) groups by vendor, not fund — a payment
    // settles a whole invoice with one vendor, so vendor is the natural "who" behind these figures
    // (unlike the resident side, where a charge really is per-fund).
    const byVendor = (rows: any[]) => {
      const map = new Map<string, { vendorId: string; vendorName?: string | null; amount: number }>()
      for (const inv of rows) {
        const vid = inv.vendorId
        if (!vid) continue
        const cur = map.get(vid) ?? { vendorId: vid, vendorName: inv.vendor?.name, amount: 0 }
        cur.amount += Number(inv.gross ?? 0)
        map.set(vid, cur)
      }
      return Array.from(map.values()).map((x) => ({ ...x, amount: round2(x.amount) })).sort((a, b) => b.amount - a.amount)
    }
    const currentByVendor = byVendor(currentRows)
    const overdueByVendor = byVendor(overdueRows)
    const paidByVendor = byVendor(paidRows)

    // "Plăți" also picks up real payments made straight from the bank/cash register that never
    // went through the invoicing flow (kind='PAYMENT', not linked to a VendorPayment) — e.g. a
    // reabilitare-project vendor paid directly from the bank statement. Matched to a registered
    // Vendor by name where possible so its spend rolls up with any invoiced amount for the same
    // vendor; an unmatched counterparty still gets its own row rather than being silently dropped.
    let unlinkedTotal = 0
    if (period?.afisareDate && period?.dueDate) {
      const lo = period.afisareDate < period.dueDate ? period.afisareDate : period.dueDate
      const hi = period.afisareDate < period.dueDate ? period.dueDate : period.afisareDate
      const unlinkedTx = await (this.prisma as any).cashTx.findMany({
        where: { communityId, direction: 'OUT', kind: 'PAYMENT', NOT: { refType: 'VENDOR_PAYMENT' }, ts: { gte: lo, lte: hi } },
        select: { amount: true, meta: true },
      })
      if (unlinkedTx.length) {
        const vendors = await this.prisma.vendor.findMany({ where: { communityId }, select: { id: true, name: true } })
        const byId = new Map(paidByVendor.map((v) => [v.vendorId, v]))
        for (const tx of unlinkedTx as any[]) {
          const counterparty = tx.meta?.counterparty
          if (!counterparty || typeof counterparty !== 'string') continue
          const amount = Number(tx.amount || 0)
          const match = VendorInvoiceService.resolveVendorByName(counterparty, vendors)
          const key = match?.id ?? counterparty
          const cur = byId.get(key) ?? { vendorId: key, vendorName: match?.name ?? counterparty, amount: 0 }
          cur.amount += amount
          byId.set(key, cur)
          unlinkedTotal += amount
        }
        paidByVendor.length = 0
        paidByVendor.push(...Array.from(byId.values()).map((x) => ({ ...x, amount: round2(x.amount) })).sort((a, b) => b.amount - a.amount))
      }
    }

    return {
      periodCode: period?.code ?? null,
      currentGross: round2(sumGross(currentRows)),
      currentCount: currentRows.length,
      currentVendorCount: currentByVendor.length,
      currentByVendor,
      overdueOutstanding: round2(sumGross(overdueRows)),
      overdueCount: overdueRows.length,
      overdueVendorCount: overdueByVendor.length,
      overdueByVendor,
      paidThisMonth: round2(sumGross(paidRows) + unlinkedTotal),
      paidCount: paidRows.length,
      paidVendorCount: paidByVendor.length,
      paidByVendor,
    }
  }

  /** Loose match for reconciling a free-text bank-register counterparty (e.g. "SC AQUATIM SA")
   *  against a registered Vendor name ("Aquatim") — lowercased, diacritics and common Romanian
   *  legal-entity tokens stripped, then compared as a substring in either direction. */
  private static normalizeVendorName(raw: string): string {
    return raw
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\b(sc|srl|sa|s\.r\.l\.?|s\.a\.?|sm|co)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  private static resolveVendorByName(counterparty: string, vendors: Array<{ id: string; name: string }>) {
    const normCp = VendorInvoiceService.normalizeVendorName(counterparty)
    if (!normCp) return null
    for (const v of vendors) {
      const normV = VendorInvoiceService.normalizeVendorName(v.name)
      if (normV && (normCp === normV || normCp.includes(normV) || normV.includes(normCp))) return v
    }
    return null
  }

  async getInvoice(communityId: string, id: string) {
    const invoice = await this.prisma.vendorInvoice.findFirst({
      where: { id, communityId },
      select: {
        id: true,
        vendorId: true,
        number: true,
        issueDate: true,
        dueDate: true,
        serviceStartPeriodId: true,
        serviceEndPeriodId: true,
        currency: true,
        net: true,
        vat: true,
        gross: true,
        source: true,
        hash: true,
        provenance: true,
        vendor: { select: { id: true, name: true, taxId: true, iban: true } },
        fundInvoices: { select: { fundId: true, amount: true, notes: true } },
      } as any,
    })
    if (!invoice) throw new NotFoundException('Invoice not found')
    return invoice
  }

  async createInvoice(communityId: string, body: any) {
    const fundId =
      body.fundId ||
      (body.fundCode ? await this.resolveFundIdByCode(communityId, body.fundCode) : null)
    if (!fundId) {
      throw new BadRequestException('fundId or fundCode required when creating an invoice')
    }
    const vendorId = await this.resolveVendor(communityId, {
      vendorId: body.vendorId,
      vendorName: body.vendorName,
      taxId: body.vendorTaxId,
      iban: body.vendorIban,
    })
    const data: any = {
      communityId,
      vendorId,
      number: body.number ?? null,
      issueDate: body.issueDate ? new Date(body.issueDate) : null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      serviceStartPeriodId: body.serviceStartPeriodId ?? null,
      serviceEndPeriodId: body.serviceEndPeriodId ?? null,
      currency: body.currency || 'RON',
      net: body.net ?? null,
      vat: body.vat ?? null,
      gross: body.gross ?? null,
      source: body.source || 'MANUAL',
      hash: body.hash ?? null,
      provenance: body.provenance ?? null,
    }
    const invoice = await this.prisma.vendorInvoice.create({ data })
    await this.linkFund(communityId, invoice.id, {
      fundId,
      amount: body.fundAmount ?? null,
      portionKey: body.fundPortionKey ?? null,
      notes: body.fundNotes ?? null,
    })
    if (invoice.source === 'INTERNAL') {
      await this.createVendorPayment(communityId, invoice.id, { ts: new Date() })
    }
    return invoice
  }

  async updateInvoice(communityId: string, id: string, body: any) {
    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id, communityId }, select: { id: true } })
    if (!invoice) throw new NotFoundException('Invoice not found')
    const vendorId = await this.resolveVendor(communityId, {
      vendorId: body.vendorId,
      vendorName: body.vendorName,
      taxId: body.vendorTaxId,
      iban: body.vendorIban,
    })
    const data: any = {
      vendorId,
      number: body.number ?? null,
      issueDate: body.issueDate ? new Date(body.issueDate) : null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      serviceStartPeriodId: body.serviceStartPeriodId ?? null,
      serviceEndPeriodId: body.serviceEndPeriodId ?? null,
      currency: body.currency || undefined,
      net: body.net ?? undefined,
      vat: body.vat ?? undefined,
      gross: body.gross ?? undefined,
      source: body.source || undefined,
      hash: body.hash ?? undefined,
      provenance: body.provenance ?? undefined,
    }
    return this.prisma.vendorInvoice.update({ where: { id }, data })
  }

  async createVendorPayment(communityId: string, invoiceId: string, body: any) {
    const invoice = await this.prisma.vendorInvoice.findFirst({
      where: { id: invoiceId, communityId },
      select: { id: true, communityId: true, vendorId: true, gross: true, currency: true },
    })
    if (!invoice) throw new NotFoundException('Invoice not found')
    const amount = Number(body.amount ?? invoice.gross ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be positive')
    }
    const accountId = body.accountId ? await this.ensureCashAccount(communityId, body.accountId) : null
    // Operator may choose which fund the money leaves from (any community fund).
    let payFundId: string | null = null
    if (body.fundId) {
      const fund = await this.prisma.fund.findFirst({ where: { id: body.fundId, communityId }, select: { id: true } })
      if (!fund) throw new BadRequestException('Invalid fundId for payment')
      payFundId = fund.id
    }
    const { payment } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vendorPayment.create({
        data: {
          communityId,
          vendorId: invoice.vendorId ?? null,
          invoiceId: invoice.id,
          accountId,
          amount,
          currency: body.currency || invoice.currency || 'RON',
          ts: body.ts ? new Date(body.ts) : new Date(),
          method: body.method ?? null,
          refId: body.refId ?? null,
          status: 'POSTED',
        },
      })
      await tx.vendorPaymentApplication.create({
        data: {
          paymentId: created.id,
          invoiceId: invoice.id,
          amount,
          spec: { source: 'INVOICE', invoiceId: invoice.id },
        },
      })
      return { payment: created }
    })
    await this.postVendorPaymentLedger(invoice, payment, payFundId)
    await this.upsertCashTxForVendorPayment(communityId, payment as any, payFundId)
    return payment
  }

  /** Corrects an existing payment's amount and/or date in place — updates the payment, its
   * application, the ledger entries already posted for it (by refId), and re-derives its cash
   * register rows, rather than requiring a delete-and-recreate. */
  async updateVendorPayment(communityId: string, paymentId: string, body: any) {
    const payment = await this.prisma.vendorPayment.findFirst({
      where: { id: paymentId, communityId },
      select: { id: true, invoiceId: true, amount: true, currency: true, ts: true, accountId: true, method: true },
    })
    if (!payment) throw new NotFoundException('Payment not found')

    const amount = body.amount != null ? Number(body.amount) : Number(payment.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be positive')
    }
    const ts = body.ts ? new Date(body.ts) : payment.ts

    await this.prisma.$transaction(async (tx) => {
      await tx.vendorPayment.update({ where: { id: paymentId }, data: { amount, ts } })
      await tx.vendorPaymentApplication.updateMany({ where: { paymentId }, data: { amount } })

      const communityEntry = await tx.communityLedgerEntry.findFirst({ where: { refType: 'VENDOR_PAYMENT', refId: paymentId } })
      if (communityEntry) {
        await tx.communityLedgerEntry.update({ where: { id: communityEntry.id }, data: { amount } })
        await tx.communityLedgerEntryDetail.updateMany({ where: { ledgerEntryId: communityEntry.id }, data: { amount } })
      }
      const fundEntry = await tx.fundLedgerEntry.findFirst({ where: { refType: 'VENDOR_PAYMENT', refId: paymentId } })
      if (fundEntry) {
        await tx.fundLedgerEntry.update({ where: { id: fundEntry.id }, data: { amount } })
        await tx.fundLedgerEntryDetail.updateMany({ where: { ledgerEntryId: fundEntry.id }, data: { amount } })
      }
    })

    await this.upsertCashTxForVendorPayment(communityId, {
      id: paymentId, accountId: payment.accountId, amount, currency: payment.currency, ts, method: payment.method, invoiceId: payment.invoiceId,
    })

    return this.prisma.vendorPayment.findUnique({ where: { id: paymentId } })
  }

  /** Reverts an invoice to unpaid — removes the payment and every side effect it posted (the
   * ledger entries + their details, and its cash-register rows), the mirror image of
   * createVendorPayment. */
  async deleteVendorPayment(communityId: string, paymentId: string) {
    const payment = await this.prisma.vendorPayment.findFirst({ where: { id: paymentId, communityId }, select: { id: true } })
    if (!payment) throw new NotFoundException('Payment not found')

    await this.prisma.$transaction(async (tx) => {
      const communityEntry = await tx.communityLedgerEntry.findFirst({ where: { refType: 'VENDOR_PAYMENT', refId: paymentId }, select: { id: true } })
      if (communityEntry) {
        await tx.communityLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: communityEntry.id } })
        await tx.communityLedgerEntry.delete({ where: { id: communityEntry.id } })
      }
      const fundEntry = await tx.fundLedgerEntry.findFirst({ where: { refType: 'VENDOR_PAYMENT', refId: paymentId }, select: { id: true } })
      if (fundEntry) {
        await tx.fundLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: fundEntry.id } })
        await tx.fundLedgerEntry.delete({ where: { id: fundEntry.id } })
      }
      await tx.cashTx.deleteMany({ where: { refType: 'VENDOR_PAYMENT', refId: paymentId } })
      await tx.vendorPaymentApplication.deleteMany({ where: { paymentId } })
      await tx.vendorPayment.delete({ where: { id: paymentId } })
    })

    return { ok: true }
  }

  private async ensureCashAccount(communityId: string, accountId: string) {
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, communityId }, select: { id: true } })
    if (!account) throw new NotFoundException('Cash account not found')
    return account.id
  }

  private async upsertCashTxForVendorPayment(
    communityId: string,
    payment: {
      id: string
      accountId?: string | null
      amount: any
      currency: string
      ts?: Date | null
      method?: string | null
      invoiceId?: string | null
    },
    forceFundId?: string | null,
  ) {
    if (!payment.accountId) return
    await this.prisma.cashTx.deleteMany({
      where: { communityId, refType: 'VENDOR_PAYMENT', refId: payment.id, direction: 'OUT' },
    })
    let rows: Array<{ fundId: string | null; amount: number }> = []
    if (forceFundId) {
      rows = [{ fundId: forceFundId, amount: Number(payment.amount) }]
    } else if (payment.invoiceId) {
      const fundRows = await this.prisma.fundInvoice.findMany({
        where: { invoiceId: payment.invoiceId },
        select: { fundId: true, amount: true },
      })
      const total = fundRows.reduce((s, r) => s + Number(r.amount ?? 0), 0)
      if (fundRows.length && total > 0) {
        let allocated = 0
        for (let i = 0; i < fundRows.length; i += 1) {
          const r = fundRows[i]
          const share = i === fundRows.length - 1 ? Number(payment.amount) - allocated : (Number(payment.amount) * Number(r.amount ?? 0)) / total
          const amt = Number(share.toFixed(4))
          allocated += amt
          rows.push({ fundId: r.fundId, amount: amt })
        }
      } else if (fundRows.length) {
        // fund links carry no explicit portion amounts: split the payment equally
        let allocated = 0
        for (let i = 0; i < fundRows.length; i += 1) {
          const r = fundRows[i]
          const share = i === fundRows.length - 1 ? Number(payment.amount) - allocated : Number((Number(payment.amount) / fundRows.length).toFixed(4))
          allocated += share
          rows.push({ fundId: r.fundId, amount: share })
        }
      }
    }
    if (!rows.length) {
      throw new BadRequestException('Vendor payment requires fund allocation')
    }
    const data = rows.map((r) => {
      if (!r.fundId) throw new BadRequestException('Vendor payment requires fundId')
      return {
      communityId,
      accountId: payment.accountId as string,
      fundId: r.fundId,
      amount: r.amount,
      currency: payment.currency || 'RON',
      ts: payment.ts ?? new Date(),
      direction: 'OUT' as const,
      kind: 'PAYMENT' as const,
      status: 'POSTED' as const,
      refType: 'VENDOR_PAYMENT',
      refId: payment.id,
      memo: payment.method ?? null,
      }
    })
    await this.prisma.cashTx.createMany({ data })
  }

  private async ensureCommunity(invoiceId: string, communityId: string) {
    const inv = await this.prisma.vendorInvoice.findFirst({ where: { id: invoiceId, communityId }, select: { id: true } })
    if (!inv) throw new NotFoundException('Invoice not found for community')
  }

  private async resolveFundIdByCode(communityId: string, fundCode: string) {
    const fund = await this.prisma.fund.findUnique({
      where: { communityId_code: { communityId, code: fundCode } },
      select: { id: true },
    })
    if (!fund) throw new NotFoundException(`Fund ${fundCode} not found`)
    return fund.id
  }

  async linkFund(communityId: string, invoiceId: string, body: { fundId: string; amount?: number; portionKey?: string; notes?: any }) {
    await this.ensureCommunity(invoiceId, communityId)
    const fund = await this.prisma.fund.findFirst({ where: { id: body.fundId, communityId }, select: { id: true } })
    if (!fund) throw new NotFoundException('Fund not found for community')
    const portionKey = body.portionKey ?? 'default'
    const data = {
      fundId: body.fundId,
      invoiceId,
      portionKey,
      amount: body.amount ?? null,
      notes: body.notes ?? null,
    }
    const res = await (this.prisma as any).fundInvoice.upsert({
      where: {
        fundId_invoiceId_portionKey: {
          fundId: body.fundId,
          invoiceId,
          portionKey,
        },
      },
      update: { amount: data.amount, notes: data.notes },
      create: data,
    })
    await this.upsertFundSpendLedger(communityId, data)
    return res
  }

  async unlinkFund(communityId: string, invoiceId: string, fundId: string, portionKey?: string | null) {
    await this.ensureCommunity(invoiceId, communityId)
    const key = portionKey ?? 'default'
    const res = await (this.prisma as any).fundInvoice.deleteMany({
      where: {
        fundId,
        invoiceId,
        portionKey: key,
      },
    })
    await this.deleteFundSpendLedger(communityId, { fundId, invoiceId, portionKey: key })
    return { deleted: res.count }
  }

  private async upsertFundSpendLedger(
    communityId: string,
    data: { fundId: string; invoiceId: string; portionKey: string | null; amount?: number | null },
  ) {
    const portionKey = data.portionKey ?? 'default'
    const fund = await this.prisma.fund.findUnique({
      where: { id: data.fundId },
      select: { id: true, code: true, name: true },
    })
    const invoice = await this.prisma.vendorInvoice.findUnique({
      where: { id: data.invoiceId },
      select: { id: true, gross: true, currency: true, issueDate: true, serviceStartPeriodId: true, serviceEndPeriodId: true },
    })
    if (!fund || !invoice) return
    const amount = data.amount ?? (invoice.gross ? Number(invoice.gross) : 0)
    const periodId = await this.resolveFundSpendPeriodId(communityId, invoice)
    const entry = await this.prisma.beLedgerEntry.upsert({
      where: {
        communityId_periodId_billingEntityId_refType_refId_fundId: {
          communityId,
          periodId,
          billingEntityId: 'FUND',
          refType: 'FUND_SPEND',
          refId: `${fund.id}:${invoice.id}:${portionKey}`,
          fundId: fund.id,
        },
      },
      update: {
        amount,
        currency: invoice.currency || 'RON',
      },
      create: {
        communityId,
        periodId,
        billingEntityId: 'FUND',
        kind: 'FUND_SPEND',
        lane: 'ACCRUAL',
        amount,
        currency: invoice.currency || 'RON',
        refType: 'FUND_SPEND',
        refId: `${fund.id}:${invoice.id}:${portionKey}`,
        fundId: fund.id,
      },
    })
    await ensureLedgerEntryDetail(this.prisma, entry, amount, {
      synthetic: true,
      reason: 'fund-spend',
      fundId: fund.id,
      invoiceId: invoice.id,
      portionKey,
    })
    const communityEntry = await this.prisma.communityLedgerEntry.upsert({
      where: {
        communityId_periodId_refType_refId_fundId_kind: {
          communityId,
          periodId,
          refType: 'FUND_SPEND',
          refId: `${fund.id}:${invoice.id}:${portionKey}`,
          fundId: fund.id,
          kind: 'FUND_SPEND',
        },
      },
      update: {
        amount,
        currency: invoice.currency || 'RON',
      },
      create: {
        communityId,
        periodId,
        kind: 'FUND_SPEND',
        lane: 'ACCRUAL',
        amount,
        currency: invoice.currency || 'RON',
        refType: 'FUND_SPEND',
        refId: `${fund.id}:${invoice.id}:${portionKey}`,
        fundId: fund.id,
      },
    })
    await ensureCommunityLedgerEntryDetail(this.prisma, communityEntry, amount, {
      synthetic: true,
      reason: 'fund-spend',
      fundId: fund.id,
      invoiceId: invoice.id,
      portionKey,
    })
    const fundEntry = await this.prisma.fundLedgerEntry.upsert({
      where: {
        communityId_fundId_periodId_refType_refId_kind: {
          communityId,
          fundId: fund.id,
          periodId,
          refType: 'FUND_SPEND',
          refId: `${fund.id}:${invoice.id}:${portionKey}`,
          kind: 'EXPENSE',
        },
      },
      update: {
        amount,
        currency: invoice.currency || 'RON',
      },
      create: {
        communityId,
        fundId: fund.id,
        periodId,
        kind: 'EXPENSE',
        lane: 'ACCRUAL',
        amount,
        currency: invoice.currency || 'RON',
        refType: 'FUND_SPEND',
        refId: `${fund.id}:${invoice.id}:${portionKey}`,
      },
    })
    await ensureFundLedgerEntryDetail(this.prisma, fundEntry, amount, {
      synthetic: true,
      reason: 'fund-spend',
      fundId: fund.id,
      invoiceId: invoice.id,
      portionKey,
    })
  }

  private async postVendorPaymentLedger(
    invoice: { id: string; communityId: string; vendorId: string | null },
    payment: { id: string; amount: any; currency: string | null; ts: Date },
    forceFundId?: string | null,
  ) {
    const periodId = await this.resolveCashPeriodId(invoice.communityId)
    let spendFundId: string | null = forceFundId ?? null
    if (!spendFundId) {
      const fundLinks = await this.prisma.fundInvoice.findMany({
        where: { invoiceId: invoice.id },
        select: { fundId: true },
      })
      if (fundLinks.length > 1) {
        throw new BadRequestException('Invoice linked to multiple funds; choose the paying fund')
      }
      spendFundId = fundLinks.length === 1 ? fundLinks[0].fundId : null
    }
    if (spendFundId) {
      const fund = await this.prisma.fund.findUnique({
        where: { id: spendFundId },
        select: { id: true, code: true },
      })
      if (!fund) {
        throw new BadRequestException('Fund not found for invoice payment')
      }
      const ple = await this.prisma.fundLedgerEntry.create({
        data: {
          communityId: invoice.communityId,
          fundId: fund.id,
          periodId,
          kind: 'PAYMENT_OUT',
          lane: 'CASH',
          amount: payment.amount,
          currency: payment.currency || 'RON',
          refType: 'VENDOR_PAYMENT',
          refId: payment.id,
        },
      })
      await ensureFundLedgerEntryDetail(this.prisma, ple, Number(payment.amount), {
        synthetic: true,
        reason: 'vendor-payment',
        paymentId: payment.id,
        invoiceId: invoice.id,
      })
    }

    const cle = await this.prisma.communityLedgerEntry.create({
      data: {
        communityId: invoice.communityId,
        periodId,
        kind: 'PAYMENT_OUT',
        lane: 'CASH',
        amount: payment.amount,
        currency: payment.currency || 'RON',
        refType: 'VENDOR_PAYMENT',
        refId: payment.id,
        fundId: spendFundId,
      },
    })
    await ensureCommunityLedgerEntryDetail(this.prisma, cle, Number(payment.amount), {
      synthetic: true,
      reason: 'vendor-payment',
      paymentId: payment.id,
      invoiceId: invoice.id,
    })
  }

  private async deleteFundSpendLedger(
    communityId: string,
    data: { fundId: string; invoiceId: string; portionKey: string | null },
  ) {
    await this.prisma.beLedgerEntry.deleteMany({
      where: {
        communityId,
        refType: 'FUND_SPEND',
        refId: `${data.fundId}:${data.invoiceId}:${data.portionKey ?? 'default'}`,
      },
    })
    const communityEntries = await this.prisma.communityLedgerEntry.findMany({
      where: {
        communityId,
        refType: 'FUND_SPEND',
        refId: `${data.fundId}:${data.invoiceId}:${data.portionKey ?? 'default'}`,
      },
      select: { id: true },
    })
    if (communityEntries.length) {
      await this.prisma.communityLedgerEntryDetail.deleteMany({
        where: { ledgerEntryId: { in: communityEntries.map((e) => e.id) } },
      })
      await this.prisma.communityLedgerEntry.deleteMany({ where: { id: { in: communityEntries.map((e) => e.id) } } })
    }
    const fundEntries = await this.prisma.fundLedgerEntry.findMany({
      where: {
        communityId,
        fundId: data.fundId,
        refType: 'FUND_SPEND',
        refId: `${data.fundId}:${data.invoiceId}:${data.portionKey ?? 'default'}`,
      },
      select: { id: true },
    })
    if (fundEntries.length) {
      await this.prisma.fundLedgerEntryDetail.deleteMany({
        where: { ledgerEntryId: { in: fundEntries.map((e) => e.id) } },
      })
      await this.prisma.fundLedgerEntry.deleteMany({ where: { id: { in: fundEntries.map((e) => e.id) } } })
    }
  }

  /** #18 "Configurare furnizori" — the vendor list behind every VendorInvoice, editable for name
   *  and contract reference. invoiceCount is read-only context (how many invoices reference this
   *  vendor), not something this panel edits. */
  async listVendors(communityId: string) {
    const vendors = await this.prisma.vendor.findMany({
      where: { communityId },
      select: {
        id: true, name: true, contract: true, taxId: true, iban: true,
        _count: { select: { VendorInvoice: true } },
      },
      orderBy: { name: 'asc' },
    })
    return vendors.map((v) => ({
      id: v.id, name: v.name, contract: v.contract, taxId: v.taxId, iban: v.iban,
      invoiceCount: v._count.VendorInvoice,
    }))
  }

  /** Registers a vendor with no invoice yet — e.g. one already paid straight from the bank
   *  register (see CashTx.meta.counterparty) but never entered through the invoicing flow. */
  async createVendor(communityId: string, body: any) {
    const name = String(body?.name ?? '').trim()
    if (!name) throw new BadRequestException('name is required')
    const existing = await this.prisma.vendor.findFirst({ where: { communityId, name } })
    if (existing) throw new BadRequestException('A vendor with this name already exists')
    const created = await this.prisma.vendor.create({
      data: {
        communityId,
        name,
        contract: body?.contract || null,
        taxId: body?.taxId || null,
        iban: body?.iban || null,
      },
    })
    return this.listVendors(communityId).then((rows) => rows.find((r) => r.id === created.id))
  }

  async updateVendor(communityId: string, vendorId: string, body: any) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, communityId } })
    if (!vendor) throw new NotFoundException('Vendor not found')
    const data: any = {}
    if (body?.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) throw new BadRequestException('name is required')
      data.name = name
    }
    if (body?.contract !== undefined) data.contract = body.contract || null
    if (body?.taxId !== undefined) data.taxId = body.taxId || null
    if (body?.iban !== undefined) data.iban = body.iban || null
    if (Object.keys(data).length === 0) throw new BadRequestException('No fields provided')
    await this.prisma.vendor.update({ where: { id: vendorId }, data })
    return this.listVendors(communityId).then((rows) => rows.find((r) => r.id === vendorId))
  }
}
