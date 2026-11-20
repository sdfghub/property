// Import HomeFile "Fișă calcul penalizări" sheets as declared aging snapshots: one penalty_bucket per
// (unit, origin month) with status 'SNAPSHOT' and origin_key 'fisa:<asOfPeriodCode>:<YYYY-MM|opening>'.
// PenaltyReconciliationService.reconcileUnitFund then ages the unit's restanță from these months
// instead of its FIFO reconstruction (risk report, Restanțe, and the penalty posted at prepare).
// SNAPSHOT rows are invisible to the bucket engine (it only reads status OPEN).
// Idempotent: replaces the file's own snapshot rows for each listed unit.
//   npx ts-node --transpile-only src/scripts/import-kralik-penalty-sheets.ts [data/Kralik/penalty-sheets-2026-08.json]
import fs from 'fs'
import path from 'path'
import { PrismaService } from '../modules/user/prisma.service'

const COMM = 'Kralik'
const PRE_TRACKING_DUE_DATE = new Date('2021-04-18') // same catch-all anchor as PenaltyReconciliationService

async function main() {
  const file = process.argv[2] || path.join(process.cwd(), 'data', COMM, 'penalty-sheets-2026-08.json')
  const sheet = JSON.parse(fs.readFileSync(file, 'utf8'))
  const prisma = new PrismaService()
  await prisma.$connect()
  try {
    const fund = await prisma.fund.findFirst({ where: { communityId: COMM, code: sheet.fundCode }, select: { id: true, allocation: true } })
    if (!fund) throw new Error(`fund ${sheet.fundCode} not found`)
    const targetCode = (fund.allocation as any)?.penaltyFundCode || 'PENALIZARI'
    const target = await prisma.fund.findFirst({ where: { communityId: COMM, code: targetCode }, select: { id: true } })
    if (!target) throw new Error(`target fund ${targetCode} not found`)
    const asOf = await prisma.period.findFirst({ where: { communityId: COMM, code: sheet.asOfPeriodCode }, select: { seq: true } })
    if (!asOf) throw new Error(`period ${sheet.asOfPeriodCode} not found`)
    const community = await prisma.community.findUnique({ where: { id: COMM }, select: { penaltyGraceDays: true } })
    const graceDays = Number((community as any)?.penaltyGraceDays ?? 30)
    const DAY = 24 * 60 * 60 * 1000

    for (const u of sheet.units) {
      const unit = await prisma.unit.findFirst({ where: { communityId: COMM, code: u.unitCode }, select: { id: true } })
      if (!unit) throw new Error(`unit ${u.unitCode} not found`)
      const member = await prisma.billingEntityMember.findFirst({
        where: { unitId: unit.id, startSeq: { lte: asOf.seq }, OR: [{ endSeq: null }, { endSeq: { gte: asOf.seq } }] },
        select: { billingEntityId: true },
      })
      if (!member) throw new Error(`no billing entity for ${u.unitCode}`)
      const prefix = `fisa:${sheet.asOfPeriodCode}:`
      await prisma.penaltyBucket.deleteMany({ where: { communityId: COMM, unitId: unit.id, fundId: fund.id, status: 'SNAPSHOT', originKey: { startsWith: prefix } } })
      let total = 0
      for (const [month, amount] of Object.entries(u.months as Record<string, number>)) {
        let due = PRE_TRACKING_DUE_DATE
        if (month !== 'opening') {
          const p = await prisma.period.findFirst({ where: { communityId: COMM, code: month }, select: { dueDate: true } })
          if (!p?.dueDate) throw new Error(`period ${month} has no due date`)
          due = new Date(p.dueDate)
        }
        await prisma.penaltyBucket.create({ data: {
          communityId: COMM, billingEntityId: member.billingEntityId, unitId: unit.id, fundId: fund.id, targetFundId: target.id,
          originKey: `${prefix}${month}`, dueDate: due, firstPenalDay: new Date(due.getTime() + (graceDays + 1) * DAY),
          principalOriginal: amount, status: 'SNAPSHOT',
        } })
        total += amount
      }
      console.log(`${u.label}: ${Object.keys(u.months).length} luni, total ${total.toFixed(2)} (fișă ${u.sheetTotal})`)
    }
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
