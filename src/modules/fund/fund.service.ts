import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }
type FundDef = {
  code: string
  name: string
  description?: string
  status?: string
  currency?: string
  totalTarget?: number
  startPeriodCode?: string
  targets?: Array<{ offset: number; amount: number }>
  targetPlan?: { periodCount: number; perPeriodAmount: number }
  allocation?: any
}

@Injectable()
export class FundService {
  constructor(private readonly prisma: PrismaService) {}

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
      throw new BadRequestException(`Fund ${code}: targets must be an array`)
    }
    return raw.map((t: any, idx: number) => {
      const offset = Number(t?.offset)
      const amount = Number(t?.amount)
      if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
        throw new BadRequestException(`Fund ${code}: target[${idx}].offset must be a non-negative integer`)
      }
      if (!Number.isFinite(amount) || amount < 0) {
        throw new BadRequestException(`Fund ${code}: target[${idx}].amount must be a non-negative number`)
      }
      return { offset, amount }
    })
  }

  private parseTargetPlan(raw: any, code: string) {
    if (!raw) return null
    const periodCount = Number(raw?.periodCount)
    const perPeriodAmount = Number(raw?.perPeriodAmount)
    if (!Number.isFinite(periodCount) || periodCount <= 0 || !Number.isInteger(periodCount)) {
      throw new BadRequestException(`Fund ${code}: targetPlan.periodCount must be a positive integer`)
    }
    if (!Number.isFinite(perPeriodAmount) || perPeriodAmount <= 0) {
      throw new BadRequestException(`Fund ${code}: targetPlan.perPeriodAmount must be a positive number`)
    }
    return { periodCount, perPeriodAmount }
  }

  private validateTotalTarget(code: string, totalTarget: number | null | undefined, targets?: Array<{ offset: number; amount: number }>) {
    if (totalTarget == null || !targets?.length) return
    const sum = targets.reduce((s, t) => s + Number(t.amount ?? 0), 0)
    const delta = Math.abs(sum - Number(totalTarget))
    if (delta > 0.01) {
      throw new BadRequestException(
        `Fund ${code}: sum of targets (${sum}) differs from totalTarget (${totalTarget})`,
      )
    }
  }

  async listBalances(communityId: string) {
    const funds = await this.prisma.fund.findMany({
      where: { communityId },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    })
    if (!funds.length) return []
    const fundIds = funds.map((p) => p.id)
    const sums: Array<{ fund_id: string; total: number }> = await this.prisma.$queryRawUnsafe(
      `
      SELECT fund_id, COALESCE(SUM(CASE WHEN kind = 'FUND_SPEND' THEN -amount ELSE amount END),0) AS total
      FROM be_ledger_entry
      WHERE community_id = $1 AND fund_id = ANY($2)
      GROUP BY fund_id
    `,
      communityId,
      fundIds,
    )
    const byFund = new Map(sums.map((s) => [s.fund_id, Number(s.total)]))
    return funds.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      balance: byFund.get(p.id) ?? 0,
    }))
  }

  async listInvoices(communityId: string, fundId: string) {
    const fund = await this.prisma.fund.findFirst({ where: { id: fundId, communityId }, select: { id: true } })
    if (!fund) throw new NotFoundException('Fund not found')
    const links: any[] = await (this.prisma as any).fundInvoice.findMany({
      where: { fundId },
      select: {
        fundId: true,
        invoiceId: true,
        amount: true,
        portionKey: true,
        notes: true,
        invoice: { select: { id: true, number: true, gross: true, currency: true, vendorId: true } },
      },
    })
    return links
  }

  async ledgerEntries(communityId: string, fundId: string) {
    const fund = await this.prisma.fund.findFirst({
      where: { id: fundId, communityId },
      select: { id: true, code: true, name: true },
    })
    if (!fund) throw new NotFoundException('Fund not found')
    const rows = await this.prisma.beLedgerEntry.findMany({
      where: { communityId, fundId: fund.id },
      orderBy: { createdAt: 'desc' },
    })

    const summary = rows.reduce(
      (acc, r) => {
        const amt = Number(r.amount || 0)
        if (r.kind === 'FUND_SPEND') acc.outflow += amt
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
      fund: { id: fund.id, code: fund.code, name: fund.name },
      summary,
      byKind,
      byRefType,
      recent,
    }
  }

  async importFunds(communityId: string, roles: RoleAssignment[], body: FundDef[]) {
    const community = await this.resolveCommunity(communityId)
    if (!community) throw new NotFoundException('Community not found')
    this.ensureCommunityAdmin(roles, community, communityId)
    if (!Array.isArray(body)) throw new BadRequestException('Funds payload must be an array')

    const imported: string[] = []
    const normalized: FundDef[] = []
    const seenCodes = new Set<string>()

    for (const proj of body) {
      const code = typeof proj?.code === 'string' ? proj.code.trim() : ''
      const name = typeof proj?.name === 'string' ? proj.name.trim() : ''
      if (!code || !name) throw new BadRequestException('Fund code and name are required')
      if (seenCodes.has(code)) throw new BadRequestException(`Duplicate fund code in payload: ${code}`)
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
        throw new BadRequestException(`Fund ${code}: totalTarget must be a number`)
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
        allocation: proj.allocation,
      })
    }

    await this.prisma.$transaction(async (tx) => {
      for (const proj of normalized) {
        await tx.fund.upsert({
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
            allocation: proj.allocation ?? null,
          },
        })
        imported.push(proj.code)
      }
    })

    return { count: imported.length, codes: imported }
  }

  async createFund(communityId: string, roles: RoleAssignment[], body: FundDef) {
    const community = await this.resolveCommunity(communityId)
    if (!community) throw new NotFoundException('Community not found')
    this.ensureCommunityAdmin(roles, community, communityId)

    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!code || !name) throw new BadRequestException('Fund code and name are required')

    const existing = await this.prisma.fund.findUnique({
      where: { communityId_code: { communityId: community.id, code } },
    })
    if (existing) return { ok: true, created: false, fund: existing }

    const totalTarget = body?.totalTarget != null ? Number(body.totalTarget) : null
    if (totalTarget != null && (!Number.isFinite(totalTarget) || totalTarget < 0)) {
      throw new BadRequestException(`Fund ${code}: totalTarget must be a non-negative number`)
    }
    const targets = body?.targets ? this.parseTargets(body.targets, code) : null
    const targetPlan = body?.targetPlan ? this.parseTargetPlan(body.targetPlan, code) : null
    this.validateTotalTarget(code, totalTarget ?? null, targets ?? undefined)

    const fund = await this.prisma.fund.create({
      data: {
        communityId: community.id,
        code,
        name,
        description: body?.description ?? null,
        status: body?.status ?? 'PLANNED',
        currency: body?.currency ?? 'RON',
        totalTarget: totalTarget ?? null,
        startPeriodCode: body?.startPeriodCode ?? null,
        ...(targetPlan !== null ? { targetPlan } : {}),
        ...(targets !== null ? { targets } : {}),
        allocation: (body as any)?.allocation ?? null,
      },
    })
    return { ok: true, created: true, fund }
  }

  async updateFund(communityId: string, fundIdOrCode: string, roles: RoleAssignment[], body: Partial<FundDef>) {
    const community = await this.resolveCommunity(communityId)
    if (!community) throw new NotFoundException('Community not found')
    this.ensureCommunityAdmin(roles, community, communityId)

    const fund = await this.prisma.fund.findFirst({
      where: {
        communityId: community.id,
        OR: [{ id: fundIdOrCode }, { code: fundIdOrCode }],
      },
    })
    if (!fund) throw new NotFoundException('Fund not found')

    const totalTarget = body?.totalTarget != null ? Number(body.totalTarget) : null
    if (totalTarget != null && (!Number.isFinite(totalTarget) || totalTarget < 0)) {
      throw new BadRequestException(`Fund ${fund.code}: totalTarget must be a non-negative number`)
    }
    const targets = body?.targets ? this.parseTargets(body.targets, fund.code) : undefined
    const targetPlan = body?.targetPlan ? this.parseTargetPlan(body.targetPlan, fund.code) : undefined
    this.validateTotalTarget(fund.code, totalTarget ?? null, targets ?? (fund.targets as any))

    const updateData: any = {
      name: body?.name ?? fund.name,
      description: body?.description ?? fund.description,
      status: body?.status ?? fund.status,
      currency: body?.currency ?? fund.currency,
      totalTarget: totalTarget ?? fund.totalTarget,
      startPeriodCode: body?.startPeriodCode ?? fund.startPeriodCode,
      allocation: (body as any)?.allocation ?? (fund as any).allocation ?? null,
    }
    if (targets !== undefined) updateData.targets = targets
    if (targetPlan !== undefined) updateData.targetPlan = targetPlan

    const updated = await this.prisma.fund.update({
      where: { id: fund.id },
      data: updateData,
    })
    return { ok: true, fund: updated }
  }
}
