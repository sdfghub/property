import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

type UpsertVendorInput = { vendorId?: string; vendorName?: string; taxId?: string; iban?: string }

@Injectable()
export class VendorInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.vendorInvoice.findMany({
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
        programInvoices: {
          select: {
            programId: true,
            amount: true,
            notes: true,
            program: { select: { id: true, code: true, name: true } },
          },
        },
      } as any,
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
        programInvoices: { select: { programId: true, amount: true, notes: true } },
      } as any,
    })
    if (!invoice) throw new NotFoundException('Invoice not found')
    return invoice
  }

  async createInvoice(communityId: string, body: any) {
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
    return this.prisma.vendorInvoice.create({ data })
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

  private async ensureCommunity(invoiceId: string, communityId: string) {
    const inv = await this.prisma.vendorInvoice.findFirst({ where: { id: invoiceId, communityId }, select: { id: true } })
    if (!inv) throw new NotFoundException('Invoice not found for community')
  }

  async linkProgram(communityId: string, invoiceId: string, body: { programId: string; amount?: number; portionKey?: string; notes?: any }) {
    await this.ensureCommunity(invoiceId, communityId)
    const program = await this.prisma.program.findFirst({ where: { id: body.programId, communityId }, select: { id: true } })
    if (!program) throw new NotFoundException('Program not found for community')
    const data = {
      programId: body.programId,
      invoiceId,
      portionKey: body.portionKey ?? null,
      amount: body.amount ?? null,
      notes: body.notes ?? null,
    }
    const res = await (this.prisma as any).programInvoice.upsert({
      where: {
        programId_invoiceId_portionKey: {
          programId: body.programId,
          invoiceId,
          portionKey: body.portionKey ?? null,
        },
      },
      update: { amount: data.amount, notes: data.notes },
      create: data,
    })
    await this.upsertProgramSpendLedger(communityId, data)
    return res
  }

  async unlinkProgram(communityId: string, invoiceId: string, programId: string, portionKey?: string | null) {
    await this.ensureCommunity(invoiceId, communityId)
    const res = await (this.prisma as any).programInvoice.deleteMany({
      where: {
        programId,
        invoiceId,
        portionKey: portionKey ?? null,
      },
    })
    await this.deleteProgramSpendLedger(communityId, { programId, invoiceId, portionKey: portionKey ?? null })
    return { deleted: res.count }
  }

  private async upsertProgramSpendLedger(
    communityId: string,
    data: { programId: string; invoiceId: string; portionKey: string | null; amount?: number | null },
  ) {
    const program = await this.prisma.program.findUnique({
      where: { id: data.programId },
      select: { id: true, code: true, name: true, defaultBucket: true },
    })
    const invoice = await this.prisma.vendorInvoice.findUnique({
      where: { id: data.invoiceId },
      select: { id: true, gross: true, currency: true },
    })
    if (!program || !invoice) return
    const bucket = program.defaultBucket || `PROGRAM:${program.id}`
    const amount = data.amount ?? (invoice.gross ? Number(invoice.gross) : 0)
    await this.prisma.beLedgerEntry.upsert({
      where: {
        communityId_periodId_billingEntityId_refType_refId_bucket: {
          communityId,
          periodId: 'PROGRAM', // dummy; not tied to member/period. keep unique via ref
          billingEntityId: 'PROGRAM',
          refType: 'PROGRAM_SPEND',
          refId: `${program.id}:${invoice.id}:${data.portionKey ?? 'default'}`,
          bucket,
        },
      },
      update: {
        amount,
        currency: invoice.currency || 'RON',
      },
      create: {
        communityId,
        periodId: 'PROGRAM',
        billingEntityId: 'PROGRAM',
        kind: 'PROGRAM_SPEND',
        amount,
        currency: invoice.currency || 'RON',
        refType: 'PROGRAM_SPEND',
        refId: `${program.id}:${invoice.id}:${data.portionKey ?? 'default'}`,
        bucket,
      },
    })
  }

  private async deleteProgramSpendLedger(
    communityId: string,
    data: { programId: string; invoiceId: string; portionKey: string | null },
  ) {
    await this.prisma.beLedgerEntry.deleteMany({
      where: {
        communityId,
        refType: 'PROGRAM_SPEND',
        refId: `${data.programId}:${data.invoiceId}:${data.portionKey ?? 'default'}`,
      },
    })
  }
}
