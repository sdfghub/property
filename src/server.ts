import express from 'express'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const app = express()
app.use(express.json())
app.get('/healthz', (_req, res) => res.json({ ok: true }))
app.get('/bills/:periodId', async (req, res) => {
  const periodId = req.params.periodId
  const allocations = await prisma.allocationLine.findMany({ where: { periodId }, select: { communityId: true }, distinct: ['communityId'] })
  if (!allocations.length) return res.json({ ok: true, created: 0 })
  const communityId = allocations[0].communityId
  const period = await prisma.period.findUniqueOrThrow({ where: { id: periodId } })
  const memberships = await prisma.billingEntityMember.findMany({
    where: { OR: [{ endSeq: null }, { endSeq: { gt: period.seq } }], startSeq: { lte: period.seq } },
    select: { billingEntityId: true, unitId: true }
  })
  const unitToBE = new Map(memberships.map(m => [m.unitId, m.billingEntityId]))
  const lines = await prisma.allocationLine.findMany({ where: { periodId, communityId }, select: { expenseId:true, unitId:true, amount:true } })
  const byBE = new Map()
  for (const l of lines) {
    const be = unitToBE.get(l.unitId); if (!be) continue
    const entry = byBE.get(be) ?? { total: 0, items: [] }
    entry.total += Number(l.amount); entry.items.push({ expenseId: l.expenseId, amount: Number(l.amount) })
    byBE.set(be, entry)
  }
  let created = 0
  for (const [beId, agg] of byBE.entries()) {
    const bill = await prisma.bill.upsert({
      where: { communityId_periodId_billingEntityId: { communityId, periodId, billingEntityId: beId } },
      create: { communityId, periodId, billingEntityId: beId, totalAmount: agg.total },
      update: { totalAmount: agg.total }
    })
    await prisma.billLine.deleteMany({ where: { billId: bill.id } })
    await prisma.billLine.createMany({ data: agg.items.map((i:any) => ({ billId: bill.id, expenseId: i.expenseId, amount: i.amount })) })
    created++
  }
  res.json({ ok: true, created })
})
const port = Number(process.env.PORT || 3000)
app.listen(port, () => console.log(`API on :${port}`))
