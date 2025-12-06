// imports
import { PrismaClient, Prisma, SeriesScope, ExpenseTargetType } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Allocate a single existing expense by its ID.
 * - Assumes expense.targetType === 'GROUP'
 * - Uses ExpenseType.params.preset.weightSource (default 'RESIDENTS')
 * - Creates a per-expense WeightVector, WeightItems, and AllocationLines in ONE transaction
 * - Idempotent if you have:
 *     @@unique([expenseId, unitId]) on allocation_line
 *     @@unique([vectorId, unitId]) on weight_item
 *     @unique on weight_vector.expense_id
 */
export async function allocateExpenseWithRule(expenseId: string) {
  // 0) Load expense + essentials
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      communityId: true,
      periodId: true,
      targetType: true,
      targetId: true,
      expenseTypeId: true,
      allocatableAmount: true,
      currency: true,
    },
  })
  if (!expense) throw new Error(`Expense ${expenseId} not found`)
  if (expense.targetType !== ExpenseTargetType.GROUP)
    throw new Error(`Only GROUP targetType supported (got ${expense.targetType})`)

  // 1) Resolve period + rule + group
  const [period, group] = await Promise.all([
    prisma.period.findUnique({ where: { id: expense.periodId }, select: { id: true, seq: true, code: true } }),
    prisma.unitGroup.findUnique({ where: { id: expense.targetId }, select: { id: true } }),
  ])
  if (!period) throw new Error(`Period ${expense.periodId} not found`)
  if (!group) throw new Error(`Group ${expense.targetId} not found`)

  // 1b) Fetch expense type after guarding null
  if (!expense.expenseTypeId) throw new Error(`Expense ${expense.id} has no expenseTypeId`)
  const expType = await prisma.expenseType.findUnique({
    where: { id: expense.expenseTypeId },
    select: { id: true, ruleId: true, params: true },
  })
  if (!expType?.ruleId) throw new Error(`ExpenseType ${expense.expenseTypeId} has no ruleId`)

  const communityId = expense.communityId
  const weightSource = ((expType.params as any)?.preset?.weightSource ?? 'RESIDENTS') as
    | 'RESIDENTS'
    | 'SQM'
    | 'CONSUMPTION'
    | 'EQUAL'

  // 2) Resolve active members for this period
  const members = await prisma.unitGroupMember.findMany({
    where: {
      groupId: group.id,
      startSeq: { lte: period.seq },
      OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
    },
    select: { unitId: true },
  })
  const unitIds = members.map((m) => m.unitId)
  if (!unitIds.length) return { created: 0, reason: 'empty-group' }

  // 3) Compute weights
  let weights = new Map<string, number>()
  if (weightSource === 'EQUAL') {
    const w = 1 / unitIds.length
    unitIds.forEach((u) => weights.set(u, w))
  } else {
    const measures = await prisma.periodMeasure.findMany({
      where: {
        communityId,
        periodId: period.id,
        scopeType: SeriesScope.UNIT,
        typeCode: weightSource,
        scopeId: { in: unitIds },
      },
      select: { scopeId: true, value: true },
    })
    const byUnit = new Map(measures.map((m) => [m.scopeId, Number(m.value)]))
    const total = unitIds.reduce((s, u) => s + (byUnit.get(u) ?? 0), 0)
    if (total <= 0) throw new Error(`Total ${weightSource} is 0 for group ${group.id} @ ${period.code}`)
    unitIds.forEach((u) => weights.set(u, (byUnit.get(u) ?? 0) / total))
  }

  // 4) Fast-fail if already allocated (idempotency)
  const existingAlloc = await prisma.allocationLine.findFirst({
    where: { expenseId: expense.id },
    select: { id: true },
  })
  if (existingAlloc) return { created: 0, reason: 'already-allocated' }

  // 5) Atomic write
  await prisma.$transaction(async (tx) => {
    const vector = await tx.weightVector.create({
      data: {
        communityId,
        periodId: period.id,
        ruleId: expType.ruleId!,                   // use expType here
        scopeType: ExpenseTargetType.GROUP,
        scopeId: group.id,
        expenseId: expense.id,
      },
      select: { id: true },
    })

    // Decimal → number for arithmetic
    const baseAmount = new Prisma.Decimal(expense.allocatableAmount).toNumber()

    await tx.weightItem.createMany({
      data: unitIds.map(u => ({ vectorId: vector.id, unitId: u, rawValue: 0, weight: weights.get(u) ?? 0 })),
      skipDuplicates: true,
    })

    await tx.allocationLine.createMany({
      data: unitIds.map(u => ({
        communityId,
        periodId: period.id,
        expenseId: expense.id,
        unitId: u,
        amount: baseAmount * (weights.get(u) ?? 0),
      })),
      skipDuplicates: true,
    })
  }, { isolationLevel: 'Serializable' })

  return { created: unitIds.length }
}
