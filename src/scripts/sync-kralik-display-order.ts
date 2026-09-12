// Sync Unit.order and BillingEntity.order from data/Kralik/def.json's structure[].order, so the
// avizier's Unitate view (which sorts unit rows by Unit.order — see finance.service.ts) and its
// Proprietar view (which already sorted by BillingEntity.order) both match the row sequence used
// in the association's own official "Lista de plată" table. A multi-unit billing entity (e.g.
// Primărie TM UAT across SAD 4/A-C, Brînzeu Adina across SAD 1 + SAD 2/2) collapses to one row in
// Proprietar view, so its order is the minimum of its units' own order values — the position its
// first unit would occupy.
//   npx ts-node --transpile-only src/scripts/sync-kralik-display-order.ts
import fs from 'fs'
import path from 'path'
import { PrismaService } from '../modules/user/prisma.service'

const COMM = 'Kralik'

async function main() {
  const prisma = new PrismaService()
  await prisma.$connect()
  try {
    const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'def.json'), 'utf8'))
    const orderByCode = new Map<string, number>()
    for (const u of def.structure || []) {
      if (typeof u.order === 'number' && typeof u.code === 'string' && !orderByCode.has(u.code)) {
        orderByCode.set(u.code, u.order)
      }
    }

    const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true, order: true } })
    let unitsUpdated = 0
    const orderByUnitId = new Map<string, number>()
    for (const u of units) {
      const newOrder = orderByCode.get(u.code)
      if (newOrder == null) { console.log(`  ⚠ no def.json order for unit ${u.code}`); continue }
      orderByUnitId.set(u.id, newOrder)
      if (u.order !== newOrder) {
        await prisma.unit.update({ where: { id: u.id }, data: { order: newOrder } })
        unitsUpdated++
      }
    }

    const members = await prisma.billingEntityMember.findMany({
      where: { billingEntity: { communityId: COMM }, endSeq: null },
      select: { billingEntityId: true, unitId: true },
    })
    const unitIdsByBe = new Map<string, string[]>()
    for (const m of members) {
      const arr = unitIdsByBe.get(m.billingEntityId) ?? []
      arr.push(m.unitId)
      unitIdsByBe.set(m.billingEntityId, arr)
    }

    const bes = await prisma.billingEntity.findMany({ where: { communityId: COMM }, select: { id: true, code: true, order: true } })
    let besUpdated = 0
    for (const be of bes) {
      const unitIds = unitIdsByBe.get(be.id) ?? []
      const orders = unitIds.map((id) => orderByUnitId.get(id)).filter((o): o is number => o != null)
      if (!orders.length) { console.log(`  ⚠ no current units (or no order) for BE ${be.code}`); continue }
      const newOrder = Math.min(...orders)
      if (be.order !== newOrder) {
        await prisma.billingEntity.update({ where: { id: be.id }, data: { order: newOrder } })
        besUpdated++
      }
    }

    console.log(`✅ synced order: ${unitsUpdated} units, ${besUpdated} billing entities updated`)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
