import { PrismaClient, ExpenseTargetType } from '@prisma/client'
import { buildWeightsFromRule } from './weights.js'
const prisma = new PrismaClient()
export async function allocateExpenseWithRule(expenseId: string) {
  const e = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { expenseType: { include: { rule: true } } } })
  const rule = e.expenseType?.rule ?? await prisma.allocationRule.findFirstOrThrow({ where: { communityId: e.communityId }})
  const unitIds = await getUnitsInScope(e.communityId, e.periodId, e.targetType as ExpenseTargetType, e.targetId)
  const weights = await buildWeightsFromRule(e.periodId, unitIds, rule)
  const vector = await prisma.weightVector.upsert({
    where: { communityId_periodId_ruleId_scopeType_scopeId: { communityId: e.communityId, periodId: e.periodId, ruleId: rule.id, scopeType: e.targetType as any, scopeId: e.targetId } },
    create: { communityId: e.communityId, periodId: e.periodId, ruleId: rule.id, scopeType: e.targetType as any, scopeId: e.targetId },
    update: {}
  })
  await prisma.weightItem.deleteMany({ where: { vectorId: vector.id } })
  await prisma.weightItem.createMany({ data: weights.map(w => ({ vectorId: vector.id, unitId: w.unitId, rawValue: w.raw, weight: w.weight })) })
  const total = Number(e.allocatableAmount)
  const unrounded = weights.map(w => ({ unitId: w.unitId, val: total * w.weight }))
  const rounded = unrounded.map(x => ({ unitId: x.unitId, amount: round2(x.val) }))
  const diff = round2(total - rounded.reduce((a,b)=>a+b.amount,0))
  if (Math.abs(diff) >= 0.01 - 1e-9) {
    const iMax = weights.reduce((best, w, i) => (w.weight > weights[best].weight ? i : best), 0)
    rounded[iMax].amount = round2(rounded[iMax].amount + diff)
  }
  await prisma.$transaction([
    prisma.allocationLine.deleteMany({ where: { expenseId: e.id } }),
    prisma.expense.update({ where: { id: e.id }, data: { weightVectorId: vector.id } }),
    prisma.allocationLine.createMany({ data: rounded.map(r => ({ communityId: e.communityId, periodId: e.periodId, expenseId: e.id, unitId: r.unitId, amount: r.amount })) })
  ])
  return { expenseId: e.id, lines: rounded }
}
async function getUnitsInScope(communityId: string, periodId: string, type: ExpenseTargetType, id: string) {
  switch (type) {
    case 'COMMUNITY': {
      const units = await prisma.unit.findMany({ where: { communityId }, select: { id: true } })
      return units.map(u => u.id)
    }
    case 'UNIT': return [id]
    case 'EXPLICIT_SET': {
      const members = await prisma.expenseTargetMember.findMany({ where: { setId: id }, select: { unitId: true } })
      return members.map(m => m.unitId)
    }
    case 'GROUP': {
      const p = await prisma.period.findUniqueOrThrow({ where: { id: periodId } })
      const rows = await prisma.unitGroupMember.findMany({
        where: { groupId: id, OR: [{ endSeq: null }, { endSeq: { gt: p.seq } }], startSeq: { lte: p.seq } },
        select: { unitId: true }
      })
      return [...new Set(rows.map(r => r.unitId))]
    }
    default: throw new Error('Unsupported targetType')
  }
}
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100
