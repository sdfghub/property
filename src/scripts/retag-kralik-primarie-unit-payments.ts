// Primărie TM UAT's billing entity spans three units (Ap 12 SAD 4/A, 4/B, 4/C). Its one real
// June-cycle cash-register payment (52.00 RON, ref FT26194ZM9LK, providerMeta.unitLabel
// "12 (SAD4/C)") had no unitId on its allocationSpec line — so applyPaymentWithSpec's charge
// matching wasn't unit-restricted and settled whichever of the three units' EXPENSES charge it
// found first (SAD 4/A's, not SAD 4/C's, the one the payment source actually names). This tags
// it (and any other future June-cycle payment for this BE) with the real unitId, resolved from
// the same unitLabel — no estimation, the source already says which unit.
//
// Idempotent: skips a payment once every one of its allocationSpec lines already carries unitId.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const COMM = 'Kralik'
const BE_CODE = 'BE_PRIMARIE_TM_UAT'
const unitCodeByLabel: Record<string, string> = {
  '12 (SAD4/A)': '400191-C1-U34-AP 12 (SAD 4/A)',
  '12 (SAD 4/A)': '400191-C1-U34-AP 12 (SAD 4/A)',
  '12 (SAD4/B)': '400191-C1-U34-AP 12 (SAD 4/B)',
  '12 (SAD 4/B)': '400191-C1-U34-AP 12 (SAD 4/B)',
  '12 (SAD4/C)': '400191-C1-U34-AP 12 (SAD 4/C)',
  '12 (SAD 4/C)': '400191-C1-U34-AP 12 (SAD 4/C)',
}

async function main() {
  const be = await prisma.billingEntity.findFirst({ where: { communityId: COMM, code: BE_CODE }, select: { id: true, name: true } })
  if (!be) { console.log(`  ⚠ BE not found: ${BE_CODE}`); await prisma.$disconnect(); return }

  const unitIdByCode = new Map<string, string>()
  for (const code of new Set(Object.values(unitCodeByLabel))) {
    const u = await prisma.unit.findFirst({ where: { communityId: COMM, code }, select: { id: true } })
    if (u) unitIdByCode.set(code, u.id)
  }

  const payments = await prisma.payment.findMany({
    where: { communityId: COMM, billingEntityId: be.id, providerMeta: { path: ['cycleCode'], equals: '2026-06' } },
    select: { id: true, allocationSpec: true, providerMeta: true },
  })
  let tagged = 0, skipped = 0
  for (const p of payments) {
    const meta = (p.providerMeta as any) || {}
    const label = meta.unitLabel as string | undefined
    const unitCode = label ? unitCodeByLabel[label] : undefined
    const unitId = unitCode ? unitIdByCode.get(unitCode) : undefined
    if (!unitId) { console.log(`  ⚠ no unit resolved for label "${label}" (payment ${p.id})`); continue }
    const spec = (p.allocationSpec as any[]) || []
    if (!spec.length) { console.log(`  ⚠ no allocationSpec on payment ${p.id} (unit ${label}) — skipping`); continue }
    if (spec.every((l) => l.unitId === unitId)) { skipped++; continue }
    const newSpec = spec.map((l) => ({ ...l, unitId }))
    await prisma.payment.update({ where: { id: p.id }, data: { allocationSpec: newSpec } })
    console.log(`  tagged payment ${p.id} (${meta.amount ?? ''}) → unit ${label}`)
    tagged++
  }
  console.log(`✅ done — tagged ${tagged}, already-tagged ${skipped}, total scanned ${payments.length}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
