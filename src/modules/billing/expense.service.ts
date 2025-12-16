import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma, AllocationMethod } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'
import { BillingPeriodLookupService } from './period-lookup.service'
import { AllocationService } from './allocation.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periodLookup: BillingPeriodLookupService,
    private readonly allocator: AllocationService,
  ) {}

  private ensureCommunityAdmin(_roles: RoleAssignment[], _communityId: string) {
    return
  }

  async listExpenseTypes(communityRef: string, periodCode: string, roles: RoleAssignment[]) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    this.ensureCommunityAdmin(roles, communityId)
    const period = await this.periodLookup.getPeriod(communityId, periodCode)
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; code: string; name: string; currency: string | null; hasExpense: boolean }>
    >`
      SELECT
        et.id,
        et.code,
        et.name,
        et.currency,
        EXISTS (
          SELECT 1 FROM expense e
          WHERE e.expense_type_id = et.id
            AND e.period_id = ${period.id}
        ) AS "hasExpense"
      FROM expense_type et
      WHERE et.community_id = ${communityId}
      ORDER BY et.code
    `
    return { period, types: rows }
  }

  async listExpenses(communityRef: string, periodCode: string, roles: RoleAssignment[]) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    this.ensureCommunityAdmin(roles, communityId)
    const period = await this.periodLookup.getPeriod(communityId, periodCode)
    const expenses = await this.prisma.expense.findMany({
      where: { communityId, periodId: period.id },
      select: {
        id: true,
        description: true,
        allocatableAmount: true,
        currency: true,
        expenseType: { select: { code: true, name: true } },
      },
      orderBy: { description: 'asc' },
    })
    return { period, items: expenses }
  }

  async expenseStatus(communityRef: string, periodCode: string, roles: RoleAssignment[]) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    this.ensureCommunityAdmin(roles, communityId)
    const period = await this.periodLookup.getPeriod(communityId, periodCode)
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; code: string; name: string; currency: string | null; expense_id: string | null; amount: number | null }>
    >(
      `
      SELECT
        et.id,
        et.code,
        et.name,
        et.currency,
        e.id     AS expense_id,
        e.allocatable_amount AS amount
      FROM expense_type et
      LEFT JOIN LATERAL (
        SELECT ex.id, ex.allocatable_amount
        FROM expense ex
        WHERE ex.expense_type_id = et.id
          AND ex.period_id = $1
        ORDER BY ex.id ASC
        LIMIT 1
      ) e ON TRUE
      WHERE et.community_id = $2
      ORDER BY et.code
    `,
      period.id,
      communityId,
    )

    const types = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      currency: r.currency,
      hasExpense: !!r.expense_id,
      amount: r.amount,
      expenseId: r.expense_id,
    }))
    const complete = types.every((t) => t.hasExpense)
    return { period, types, complete }
  }

  async createExpenseType(
    communityRef: string,
    roles: RoleAssignment[],
    input: { code: string; name: string; method: string; params?: any; currency?: string | null },
  ) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    this.ensureCommunityAdmin(roles, communityId)
    if (!input.code || !input.name || !input.method) {
      throw new ForbiddenException('Code, name and method are required')
    }
    const method = input.method as AllocationMethod
    const rule = await this.prisma.allocationRule.create({
      data: {
        communityId,
        method,
        params: input.params ?? null,
      },
      select: { id: true },
    })
    const expType = await this.prisma.expenseType.create({
      data: {
        communityId,
        code: input.code,
        name: input.name,
        ruleId: rule.id,
        currency: input.currency ?? null,
      },
      select: { id: true },
    })
    return { id: expType.id }
  }

  async createExpense(
    communityRef: string,
    periodCode: string,
    roles: RoleAssignment[],
    input: {
      description: string
      amount: number
      currency?: string
      expenseTypeId?: string
      allocationMethod?: string
      allocationParams?: any
      splits?: any[]
    },
  ) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    this.ensureCommunityAdmin(roles, communityId)
    const period = await this.periodLookup.getPeriod(communityId, periodCode)
    return this.allocator.createExpense(communityId, period, input)
  }
}
