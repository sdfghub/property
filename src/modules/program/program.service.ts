import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }
type ProgramDef = {
  code: string
  name: string
  description?: string
  status?: string
  currency?: string
  totalTarget?: number
  startPeriodCode?: string
  targets?: Array<{ offset: number; amount: number }>
  targetPlan?: { periodCount: number; perPeriodAmount: number }
  defaultBucket?: string
  allocation?: any
}

@Injectable()
export class ProgramService {
  constructor(private readonly prisma: PrismaService) {}

  private programBucket(programId: string, defaultBucket?: string | null) {
    return defaultBucket || `PROGRAM:${programId}`
  }

  private ensureCommunityAdmin(roles: RoleAssignment[], community: { id: string; code: string }, rawId: string) {
    const ok = roles.some(
      (r) =>
        r.role === 'COMMUNITY_ADMIN' &&
        r.scopeType === 'COMMUNITY' &&
        !!r.scopeId &&
        (r.scopeId === community.id || r.scopeId === community.code || r.scopeId === rawId),
    )
    if (!ok) throw new ForbiddenException('Community admin required')
  }

  private async resolveCommunity(idOrCode: string) {
    return this.prisma.community.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
      select: { id: true, code: true },
    })
  }

  private parseTargets(raw: any, code: string) {
    if (!Array.isArray(raw)) {
      throw new BadRequestException(`Program ${code}: targets must be an array`)
    }
    return raw.map((t: any, idx: number) => {
      const offset = Number(t?.offset)
      const amount = Number(t?.amount)
      if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
        throw new BadRequestException(`Program ${code}: target[${idx}].offset must be a non-negative integer`)
      }
      if (!Number.isFinite(amount) || amount < 0) {
        throw new BadRequestException(`Program ${code}: target[${idx}].amount must be a non-negative number`)
      }
      return { offset, amount }
    })
  }

  private parseTargetPlan(raw: any, code: string) {
    if (!raw) return null
    const periodCount = Number(raw?.periodCount)
    const perPeriodAmount = Number(raw?.perPeriodAmount)
    if (!Number.isFinite(periodCount) || periodCount <= 0 || !Number.isInteger(periodCount)) {
      throw new BadRequestException(`Program ${code}: targetPlan.periodCount must be a positive integer`)
    }
    if (!Number.isFinite(perPeriodAmount) || perPeriodAmount <= 0) {
      throw new BadRequestException(`Program ${code}: targetPlan.perPeriodAmount must be a positive number`)
    }
    return { periodCount, perPeriodAmount }
  }

  private validateTotalTarget(code: string, totalTarget: number | null | undefined, targets?: Array<{ offset: number; amount: number }>) {
    if (totalTarget == null || !targets?.length) return
    const sum = targets.reduce((s, t) => s + Number(t.amount ?? 0), 0)
    const delta = Math.abs(sum - Number(totalTarget))
    if (delta > 0.01) {
      throw new BadRequestException(
        `Program ${code}: sum of targets (${sum}) differs from totalTarget (${totalTarget})`,
      )
    }
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

  async importPrograms(communityId: string, roles: RoleAssignment[], body: ProgramDef[]) {
    const community = await this.resolveCommunity(communityId)
    if (!community) throw new NotFoundException('Community not found')
    this.ensureCommunityAdmin(roles, community, communityId)
    if (!Array.isArray(body)) throw new BadRequestException('Programs payload must be an array')

    const imported: string[] = []
    const normalized: ProgramDef[] = []
    const seenCodes = new Set<string>()

    for (const proj of body) {
      const code = typeof proj?.code === 'string' ? proj.code.trim() : ''
      const name = typeof proj?.name === 'string' ? proj.name.trim() : ''
      if (!code || !name) throw new BadRequestException('Program code and name are required')
      if (seenCodes.has(code)) throw new BadRequestException(`Duplicate program code in payload: ${code}`)
      seenCodes.add(code)

      let targets: Array<{ offset: number; amount: number }> | undefined
      if (proj.targets != null) {
        targets = this.parseTargets(proj.targets, code)
      } else if (proj.targetPlan) {
        const plan = this.parseTargetPlan(proj.targetPlan, code)
        if (plan) {
          targets = Array.from({ length: plan.periodCount }, (_, idx) => ({ offset: idx, amount: plan.perPeriodAmount }))
        }
      }

      const totalTarget = proj.totalTarget != null ? Number(proj.totalTarget) : null
      if (totalTarget != null && !Number.isFinite(totalTarget)) {
        throw new BadRequestException(`Program ${code}: totalTarget must be a number`)
      }
      this.validateTotalTarget(code, totalTarget, targets)

      normalized.push({
        code,
        name,
        description: proj.description,
        status: proj.status,
        currency: proj.currency,
        totalTarget: totalTarget ?? undefined,
        startPeriodCode: proj.startPeriodCode,
        targetPlan: proj.targetPlan,
        targets,
        defaultBucket: proj.defaultBucket,
        allocation: proj.allocation,
      })
    }

    await this.prisma.$transaction(async (tx) => {
      for (const proj of normalized) {
        await tx.program.upsert({
          where: { communityId_code: { communityId: community.id, code: proj.code } },
          update: {
            name: proj.name,
            description: proj.description ?? null,
            status: proj.status ?? 'PLANNED',
            currency: proj.currency ?? 'RON',
            totalTarget: proj.totalTarget ?? null,
            startPeriodCode: proj.startPeriodCode ?? null,
            targetPlan: proj.targetPlan ?? undefined,
            targets: proj.targets ?? undefined,
            defaultBucket: proj.defaultBucket ?? null,
            allocation: proj.allocation ?? null,
          },
          create: {
            communityId: community.id,
            code: proj.code,
            name: proj.name,
            description: proj.description ?? null,
            status: proj.status ?? 'PLANNED',
            currency: proj.currency ?? 'RON',
            totalTarget: proj.totalTarget ?? null,
            startPeriodCode: proj.startPeriodCode ?? null,
            targetPlan: proj.targetPlan ?? undefined,
            targets: proj.targets ?? undefined,
            defaultBucket: proj.defaultBucket ?? null,
            allocation: proj.allocation ?? null,
          },
        })
        imported.push(proj.code)
      }
    })

    return { count: imported.length, codes: imported }
  }
}
