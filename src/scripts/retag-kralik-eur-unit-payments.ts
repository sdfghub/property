// Two of June's cash-register payments (cash-2026-06.json n=83 "Ap 11" and n=85 "Ap 11A",
// imported by seed-kralik-june-complete.ts) name a specific unit in the source register even
// though Macri Nicodemo/Francesco/Antonio's billing entity spans both units — the seed script's
// generic dominant-fund allocationSpec builder has no unit concept, so these land unattributed.
// Tags their allocationSpec lines with the real unitId so BeUnitStatement (per-unit
// payments/restanțe in Avizier's Unitate/Grup Unități modes) reflects the real split instead of
// falling back to the 0+🔗-badge default. Idempotent: no-op once a line already carries unitId.
//
// Must run after seed-kralik-june-complete.ts (so the Payment rows with their current ids exist)
// and before/alongside a June reopen→prepare (so PeriodService.computeUnitStatements picks it up).
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const COMM = 'Kralik'
const targets = [
  { refId: 'cash:2026-06:83', unitCode: '400191-C1-U32-AP 11' },
  { refId: 'cash:2026-06:85', unitCode: '400191-C1-U14-AP 11A' },
]

async function main() {
  for (const t of targets) {
    const payment = await prisma.payment.findUnique({ where: { refId: t.refId }, select: { id: true, allocationSpec: true } })
    if (!payment) { console.log(`  ⚠ payment not found: ${t.refId}`); continue }
    const spec = (payment.allocationSpec as any[]) || []
    if (spec.length && spec.every((l) => l.unitId)) { console.log(`  = already tagged: ${t.refId}`); continue }
    const unit = await prisma.unit.findFirst({ where: { communityId: COMM, code: t.unitCode }, select: { id: true } })
    if (!unit) { console.log(`  ⚠ unit not found: ${t.unitCode}`); continue }
    const newSpec = spec.map((l) => ({ ...l, unitId: unit.id }))
    await prisma.payment.update({ where: { id: payment.id }, data: { allocationSpec: newSpec } })
    console.log(`  tagged ${t.refId} → unit ${t.unitCode}`)
  }
  console.log('✅ done')
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
