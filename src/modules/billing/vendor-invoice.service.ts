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
        paymentApplications: { select: { amount: true } },
      } as any,
    })
    return rows.map((r: any) => {
      const paid = Array.isArray(r.paymentApplications)
        ? r.paymentApplications.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
        : 0
      const gross = r.gross != null ? Number(r.gross) : 0
      return {
        ...r,
        paid,
        due: gross - paid,
      }
    })
  }

  async getInvoice(communityId: string, id: string) {
    const invoice = await this.prisma.vendorInvoice.findFirst({
      where: { id, communityId },
      select: {
        id: true,
        vendorId: true,
        number: true,
        issueDate: true,
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
}
