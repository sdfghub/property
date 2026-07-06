import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AllocationMethod } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

@Injectable()
export class ExpenseTypeService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureCommunityId(ref: string) {
    const c = await this.prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true } })
    if (!c) throw new NotFoundException('Community not found')
    return c.id
  }

  private ensureAdmin(_roles: RoleAssignment[], _communityId: string) {
    return
  }

  async upsertExpenseType(communityRef: string, roles: RoleAssignment[], input: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)

    const code = String(input?.code || '').trim()
    const name = String(input?.name || '').trim()
    if (!code || !name) throw new ForbiddenException('expense type requires code and name')

    const method = String(input?.method || '').trim()
    if (!method) throw new ForbiddenException('expense type requires allocation method')

    const ruleParams = input?.ruleParams ?? {}
    const rule = await this.prisma.allocationRule.findFirst({
      where: {
        communityId,
        method: method as AllocationMethod,
        params: { equals: ruleParams },
      },
      select: { id: true },
    })
    if (!rule?.id) throw new ForbiddenException(`Allocation rule ${method} missing`)

    const params: any = { ...(input?.params ?? {}) }
    if (input?.fundCode != null) params.fundCode = input.fundCode
    if (input?.splitTemplate != null) params.splitTemplate = input.splitTemplate

    const saved = await this.prisma.expenseType.upsert({
      where: { code_communityId: { code, communityId } },
      update: {
        name,
        ruleId: rule.id,
        params,
        currency: input?.currency ?? null,
      },
      create: {
        communityId,
        code,
        name,
        ruleId: rule.id,
        params,
        currency: input?.currency ?? null,
      },
      select: { id: true, code: true },
    })

    return { ok: true, expenseType: saved }
  }
}
