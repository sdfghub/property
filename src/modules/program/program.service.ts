import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

@Injectable()
export class ProgramService {
  constructor(private readonly prisma: PrismaService) {}

  private programBucket(programId: string, defaultBucket?: string | null) {
    return defaultBucket || `PROGRAM:${programId}`
  }

  async listBalances(communityId: string) {
    const programs = await this.prisma.program.findMany({
      where: { communityId },
      select: { id: true, code: true, name: true, defaultBucket: true },
      orderBy: { code: 'asc' },
    })
    if (!programs.length) return []
    const buckets = programs.map((p) => this.programBucket(p.id, p.defaultBucket))
    const sums: Array<{ bucket: string; total: number }> = await this.prisma.$queryRawUnsafe(
      `
      SELECT bucket, COALESCE(SUM(CASE WHEN kind = 'PROGRAM_SPEND' THEN -amount ELSE amount END),0) AS total
      FROM be_ledger_entry
      WHERE community_id = $1 AND bucket = ANY($2)
      GROUP BY bucket
    `,
      communityId,
      buckets,
    )
    const byBucket = new Map(sums.map((s) => [s.bucket, Number(s.total)]))
    return programs.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      bucket: this.programBucket(p.id, p.defaultBucket),
      balance: byBucket.get(this.programBucket(p.id, p.defaultBucket)) ?? 0,
    }))
  }

  async listInvoices(communityId: string, programId: string) {
    const program = await this.prisma.program.findFirst({ where: { id: programId, communityId }, select: { id: true } })
    if (!program) throw new NotFoundException('Program not found')
    const links: any[] = await (this.prisma as any).programInvoice.findMany({
      where: { programId },
      select: {
        programId: true,
        invoiceId: true,
        amount: true,
        portionKey: true,
        notes: true,
        invoice: { select: { id: true, number: true, gross: true, currency: true, vendorId: true } },
      },
    })
    return links
  }

  async ledgerEntries(communityId: string, programId: string) {
    const program = await this.prisma.program.findFirst({
      where: { id: programId, communityId },
      select: { id: true, code: true, name: true, defaultBucket: true },
    })
    if (!program) throw new NotFoundException('Program not found')
    const bucket = this.programBucket(program.id, program.defaultBucket)
    const rows = await this.prisma.beLedgerEntry.findMany({
      where: { communityId, bucket },
      orderBy: { createdAt: 'desc' },
    })

    const summary = rows.reduce(
      (acc, r) => {
        const amt = Number(r.amount || 0)
        if (r.kind === 'PROGRAM_SPEND') acc.outflow += amt
        else acc.inflow += amt
        acc.firstAt = acc.firstAt ? acc.firstAt : r.createdAt
        acc.lastAt = acc.lastAt ? acc.lastAt : r.createdAt
        acc.currency = acc.currency || r.currency || null
        return acc
      },
      {
        inflow: 0,
        outflow: 0,
        net: 0,
        lineCount: rows.length,
        firstAt: null as Date | null,
        lastAt: null as Date | null,
        currency: null as string | null,
      },
    )
    summary.net = summary.inflow - summary.outflow

    const byKind: Array<{ kind: string; total: number; count: number }> = []
    const kindMap = new Map<string, { total: number; count: number }>()
    rows.forEach((r) => {
      const k = r.kind || 'ENTRY'
      const ref = kindMap.get(k) ?? { total: 0, count: 0 }
      ref.total += Number(r.amount || 0)
      ref.count += 1
      kindMap.set(k, ref)
    })
    kindMap.forEach((v, k) => byKind.push({ kind: k, total: v.total, count: v.count }))

    const byRefType: Array<{ refType: string; total: number; count: number }> = []
    const refMap = new Map<string, { total: number; count: number }>()
    rows.forEach((r) => {
      const k = r.refType || 'ENTRY'
      const ref = refMap.get(k) ?? { total: 0, count: 0 }
      ref.total += Number(r.amount || 0)
      ref.count += 1
      refMap.set(k, ref)
    })
    refMap.forEach((v, k) => byRefType.push({ refType: k, total: v.total, count: v.count }))

    const recent = rows.slice(0, 10).map((r) => ({
      id: r.id,
      kind: r.kind,
      refType: r.refType,
      refId: r.refId,
      amount: r.amount,
      currency: r.currency,
      createdAt: r.createdAt,
      meta: (r as any).meta ?? null,
    }))

    return {
      program: { id: program.id, code: program.code, name: program.name, bucket },
      summary,
      byKind,
      byRefType,
      recent,
    }
  }
}
