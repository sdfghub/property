// Brînzeu Adina's billing entity spans two units (SAD 1 + SAD 2/2) — every one of her June cash-
// register payments already names the real unit in providerMeta.unitLabel (the source register
// genuinely distinguishes them), but seed-kralik-june-complete.ts's generic dominant-fund
// allocationSpec builder has no unit concept, so none of it reached BeUnitStatement. This tags
// every June-cycle payment's allocationSpec lines with the real unitId, resolved from that same
// unitLabel — no estimation, the source already says which unit each payment is for.
//
// Idempotent: skips a payment once every one of its allocationSpec lines already carries unitId.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const COMM = 'Kralik'
const BE_NAME_CONTAINS = 'rînzeu' // matches "Brînzeu Adina" regardless of diacritics variance in stored data
const unitCodeByLabel: Record<string, string> = {
  'SAD 1': '400191-C1-U5-SAD 1',
  'SAD 2/2': '400191-C1-U17-SAD 2/2',
}

async function main() {
  const be = await prisma.billingEntity.findFirst({ where: { communityId: COMM, name: { contains: BE_NAME_CONTAINS } }, select: { id: true, name: true } })
  if (!be) { console.log(`  ⚠ BE not found (contains "${BE_NAME_CONTAINS}")`); await prisma.$disconnect(); return }
  console.log(`  BE: ${be.name}`)

  const unitIdByCode = new Map<string, string>()
  for (const code of Object.values(unitCodeByLabel)) {
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
    console.log(`  tagged payment ${p.id} → unit ${label}`)
    tagged++
  }
  console.log(`✅ done — tagged ${tagged}, already-tagged ${skipped}, total scanned ${payments.length}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
