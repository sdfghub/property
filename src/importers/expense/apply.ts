import { PrismaClient, ExpenseTargetType, SeriesScope } from '@prisma/client'
import { ExpenseImportPlan } from './types'
const prisma = new PrismaClient()

/**
 * Applies an expense import plan transactionally.
 * Assumes Prisma schema has:
 *  - weight_vector.expenseId (nullable) + @@unique([communityId, periodId, ruleId, scopeType, scopeId, expenseId])
 *  - @@unique([expenseId, unitId]) on allocation_line
 *  - @@unique([vectorId, unitId]) on weight_item (optional)
 */
export async function applyExpensePlan(plan: ExpenseImportPlan) {
  const { communityId, periodCode } = plan
  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
  if (!period) throw new Error(`Period ${periodCode} not found in ${communityId}`)

  for (const e of plan.items) {
    // If the expense uses split tree, let the service handle it; skip legacy path.
    if (e.splits && Array.isArray(e.splits) && e.splits.length) {
      continue
    }
    // Resolve type and defaults
    const type = await prisma.expenseType.findUnique({ where: { code_communityId: { code: e.expenseTypeCode, communityId } } })
    if (!type) throw new Error(`ExpenseType ${e.expenseTypeCode} not found`)
    if (!type.ruleId) throw new Error(`ExpenseType ${e.expenseTypeCode} has no ruleId`)

    const preset = (type.params as any)?.preset ?? {}
    const targetType = (e.targetType ?? preset.defaultTargetType ?? 'GROUP') as ExpenseTargetType
    const targetCode = e.targetCode ?? preset.defaultTargetCode
    const weightSource = (e.weightSource ?? preset.weightSource ?? 'RESIDENTS') as 'RESIDENTS'|'SQM'|'CONSUMPTION'|'EQUAL'

    if (targetType !== 'GROUP') throw new Error(`Only GROUP target supported now`)
    if (!targetCode) throw new Error(`Missing targetCode for "${e.description}"`)

    const group = await prisma.unitGroup.findUnique({ where: { code_communityId: { code: targetCode, communityId } } })
    if (!group) throw new Error(`Group ${targetCode} not found`)

    // Resolve active members for this period (outside TX to minimize lock time)
    const members = await prisma.unitGroupMember.findMany({
      where: { groupId: group.id, startSeq: { lte: period.seq }, OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }] },
      select: { unitId: true }
    })
    const unitIds = members.map(m => m.unitId)
    if (!unitIds.length) { console.warn(`Skip "${e.description}": empty group ${targetCode}`); continue }

    // Build weights
    let weights = new Map<string, number>()
    if (weightSource === 'EQUAL') {
      const w = 1 / unitIds.length; unitIds.forEach(u => weights.set(u, w))
    } else {
      const measures = await prisma.periodMeasure.findMany({
        where: { communityId, periodId: period.id, scopeType: SeriesScope.UNIT, typeCode: weightSource, scopeId: { in: unitIds } },
        select: { scopeId: true, value: true }
      })
      const byUnit = new Map(measures.map(m => [m.scopeId, Number(m.value)]))
      const total = unitIds.reduce((s,u)=>s+(byUnit.get(u) ?? 0), 0)
      if (total <= 0) throw new Error(`Total ${weightSource} is 0 for ${targetCode} @ ${period.code}`)
      unitIds.forEach(u => weights.set(u, (byUnit.get(u) ?? 0) / total))
    }

    // All writes in one serializable transaction
    await prisma.$transaction(async (tx) => {
      // 1) expense (idempotent: reuse existing expenseType per period)
      const existing = await tx.expense.findFirst({
        where: { communityId, periodId: period.id, expenseTypeId: type.id },
        select: { id: true },
      })
      let expenseId = existing?.id

      if (expenseId) {
        // Clean existing allocations/vectors for a full recompute
        await tx.allocationLine.deleteMany({ where: { expenseId } })
        const vectors = await tx.weightVector.findMany({ where: { expenseId }, select: { id: true } })
        if (vectors.length) {
          await tx.weightItem.deleteMany({ where: { vectorId: { in: vectors.map((v) => v.id) } } })
          await tx.weightVector.deleteMany({ where: { id: { in: vectors.map((v) => v.id) } } })
        }
        await tx.expense.update({
          where: { id: expenseId },
          data: { description: e.description, allocatableAmount: e.amount, currency: e.currency },
        })
      } else {
        const expense = await tx.expense.create({
          data: {
            communityId, periodId: period.id, description: e.description,
            allocatableAmount: e.amount, currency: e.currency,
            targetType: 'GROUP', targetId: group.id, expenseTypeId: type.id
          },
          select: { id: true }
        })
        expenseId = expense.id
      }

      // 2) per-expense vector
      const vector = await tx.weightVector.create({
        data: {
          communityId, periodId: period.id, ruleId: type.ruleId!,
          scopeType: 'GROUP', scopeId: group.id, expenseId
        }
      })

      // 3) items (idempotent if unique(vectorId,unitId))
      await tx.weightItem.createMany({
        data: unitIds.map(u => ({
          vectorId: vector.id, unitId: u, rawValue: 0, weight: weights.get(u) ?? 0
        })),
        skipDuplicates: true
      })

      // 4) allocation lines (idempotent if unique(expenseId,unitId))
      await tx.allocationLine.createMany({
        data: unitIds.map(u => ({
          communityId, periodId: period.id, expenseId, unitId: u,
          amount: e.amount * (weights.get(u) ?? 0)
        })),
        skipDuplicates: true
      })
    }, { isolationLevel: 'Serializable' })
  }
}
